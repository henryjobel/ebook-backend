import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import multer from "multer";

import { connectDb, getDbStatus } from "./db.js";
import { getSettings } from "./models/Settings.js";
import { Product } from "./models/Product.js";
import { Order } from "./models/Order.js";
import { mergeContent } from "./defaultContent.js";
import { uploadImage, uploadPrivateFile, uploadVideo, getSignedFileUrl } from "./lib/cloudinary.js";
import { sendEbookDeliveryEmail } from "./lib/email.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 5000);
const jwtSecret = process.env.JWT_SECRET || "dev-secret";
const isProduction = process.env.NODE_ENV === "production";
const backendUrl = process.env.BACKEND_URL || (isProduction ? "https://learnaiwithsadhin.xyz" : `http://localhost:${port}`);
const configuredAllowedOrigins = String(process.env.CLIENT_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = [...new Set([
  ...configuredAllowedOrigins,
  "https://learnaiwithsadhin.xyz",
  "https://www.learnaiwithsadhin.xyz",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000"
])];
const frontendUrl = process.env.FRONTEND_URL || "https://learnaiwithsadhin.xyz";
const uddoktaPayBaseUrl = String(process.env.UDDOKTAPAY_BASE_URL || "").replace(/\/+$/, "");
const uddoktaPayApiKey = process.env.UDDOKTAPAY_API_KEY || "";

function isLocalDevOrigin(origin) {
  try {
    return origin && ["localhost", "127.0.0.1"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || isLocalDevOrigin(origin) || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Not allowed by CORS"));
  }
}));
app.use(express.json({ limit: "2mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 }
});

function publicEbook(ebook) {
  return {
    title: ebook.title,
    subtitle: ebook.subtitle,
    description: ebook.description,
    price: ebook.price,
    originalPrice: ebook.originalPrice,
    coverUrl: ebook.coverUrl,
    hasFile: Boolean(ebook.filePublicId)
  };
}

function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ message: "লগইন প্রয়োজন" });

  try {
    req.admin = jwt.verify(token, jwtSecret);
    next();
  } catch {
    res.status(401).json({ message: "সেশন শেষ হয়েছে, আবার লগইন করুন" });
  }
}

function createDownloadToken(orderId) {
  return jwt.sign({ orderId, purpose: "download" }, jwtSecret, {
    expiresIn: "7d"
  });
}

function invoiceIdFromPaymentUrl(paymentUrl) {
  try {
    const url = new URL(paymentUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[0] === "checkout" ? parts[1] || "" : "";
  } catch {
    const match = String(paymentUrl || "").match(/\/checkout\/([^/?#]+)/);
    return match?.[1] || "";
  }
}

function uddoktaPayHeaders() {
  return {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "RT-UDDOKTAPAY-API-KEY": uddoktaPayApiKey
  };
}

async function callUddoktaPay(path, payload) {
  if (!uddoktaPayBaseUrl || !uddoktaPayApiKey) {
    throw new Error("UddoktaPay credentials are not configured");
  }

  const response = await fetch(`${uddoktaPayBaseUrl}${path}`, {
    method: "POST",
    headers: uddoktaPayHeaders(),
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === "ERROR") {
    throw new Error(data.message || "UddoktaPay request failed");
  }
  return data;
}

async function sendDeliveryForApprovedOrder(order, settings) {
  if (!order.email) return;
  const downloadUrl = `${backendUrl}/api/download/${order.downloadToken}`;
  sendEbookDeliveryEmail({
    to: order.email,
    customerName: order.name,
    ebookTitle: settings.ebook.title || "ebook",
    downloadUrl
  }).catch((err) => console.error("Email send failed:", err));
}

async function approveUddoktaPayOrder(order, paymentData) {
  const wasAlreadyApproved = order.status === "approved";
  order.status = "approved";
  order.method = "uddoktapay";
  order.paymentGateway = "uddoktapay";
  order.paymentInvoiceId = paymentData.invoice_id || order.paymentInvoiceId;
  order.transactionId = paymentData.transaction_id || order.transactionId || order.paymentInvoiceId;
  order.paymentPayload = paymentData;
  order.downloadToken = order.downloadToken || createDownloadToken(order.id);
  await order.save();

  if (!wasAlreadyApproved) {
    const settings = await getSettings();
    await sendDeliveryForApprovedOrder(order, settings);
  }

  return order;
}

async function refreshUddoktaPayOrder(order) {
  if (!order.paymentInvoiceId) return order;
  const paymentData = await callUddoktaPay("/api/verify-payment", { invoice_id: order.paymentInvoiceId });

  if (paymentData.status === "COMPLETED") {
    return approveUddoktaPayOrder(order, paymentData);
  }

  if (["ERROR", "CANCELED", "CANCELLED"].includes(paymentData.status)) {
    order.status = "rejected";
  }

  order.paymentPayload = paymentData;
  await order.save();
  return order;
}

function inferFileFormat(source) {
  if (source.fileFormat) return source.fileFormat;
  const name = source.originalFileName || source.filePublicId || "";
  const match = String(name).match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}

function downloadFileName(source) {
  const fallback = `${source.title || "ebook"}.pdf`;
  const name = source.originalFileName || fallback;
  return String(name)
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim() || "ebook.pdf";
}

async function getDownloadFileSource(settings) {
  if (settings.ebook.filePublicId) {
    return {
      title: settings.ebook.title,
      filePublicId: settings.ebook.filePublicId,
      fileFormat: inferFileFormat(settings.ebook),
      fileResourceType: settings.ebook.fileResourceType,
      originalFileName: settings.ebook.originalFileName
    };
  }

  const ebookProduct = await Product.findOne({
    type: "ebook",
    status: "active",
    filePublicId: { $ne: "" }
  }).sort({ createdAt: -1 });

  if (!ebookProduct) return null;
  return {
    title: ebookProduct.title,
    filePublicId: ebookProduct.filePublicId,
    fileFormat: inferFileFormat(ebookProduct),
    fileResourceType: ebookProduct.fileResourceType,
    originalFileName: ebookProduct.originalFileName
  };
}

async function uploadIfPresent(req, fieldName) {
  const file = req.files?.[fieldName]?.[0];
  if (!file) return null;
  return uploadImage(file.buffer, "ebook-store");
}

function readBoolean(value) {
  const finalValue = Array.isArray(value) ? value[value.length - 1] : value;
  return finalValue === "true" || finalValue === true;
}

app.get("/api/health", (_req, res) => {
  const db = getDbStatus();
  res.json({ ok: true, db: db.label, dbConnected: db.connected, time: new Date().toISOString() });
});

app.get("/", (_req, res) => {
  const db = getDbStatus();
  const statusDot = (ok) => `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${ok ? "#22c55e" : "#ef4444"};margin-right:8px"></span>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Ebook Backend Status</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 40px 20px; }
  .card { max-width: 560px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 28px 32px; box-shadow: 0 4px 20px rgba(0,0,0,.3); }
  h1 { font-size: 20px; margin: 0 0 20px; }
  .row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #334155; }
  .row:last-child { border-bottom: none; }
  .label { color: #94a3b8; font-size: 14px; }
  .value { font-size: 14px; font-weight: 600; }
  code { background: #0f172a; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
  ul { padding-left: 18px; margin: 8px 0 0; font-size: 13px; color: #94a3b8; }
</style>
</head>
<body>
  <div class="card">
    <h1>📦 Ebook Backend Status</h1>
    <div class="row">
      <span class="label">API</span>
      <span class="value">${statusDot(true)}Live</span>
    </div>
    <div class="row">
      <span class="label">Database (MongoDB)</span>
      <span class="value">${statusDot(db.connected)}${db.label}</span>
    </div>
    <div class="row">
      <span class="label">Server time</span>
      <span class="value">${new Date().toLocaleString()}</span>
    </div>
    <div class="row" style="border-bottom:none; flex-direction: column; align-items: flex-start;">
      <span class="label" style="margin-bottom:6px">Quick check</span>
      <ul>
        <li><code>/api/health</code> — JSON status (api + db)</li>
        <li><code>/api/ebook</code> — public ebook data</li>
        <li><code>/api/products</code> — active products</li>
      </ul>
    </div>
  </div>
</body>
</html>`);
});

app.get("/api/ebook", async (_req, res) => {
  const settings = await getSettings();
  res.json({
    ebook: publicEbook(settings.ebook),
    payment: settings.payment,
    content: mergeContent(settings.content)
  });
});

app.post("/api/orders", async (req, res) => {
  const { name, phone, email, amount, orderBump, items } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ message: "Name and phone number are required" });
  }

  if (!uddoktaPayBaseUrl || !uddoktaPayApiKey) {
    return res.status(500).json({ message: "UddoktaPay credentials are not configured" });
  }

  const settings = await getSettings();
  const order = await Order.create({
    name,
    phone,
    email: email || "",
    method: "uddoktapay",
    paymentGateway: "uddoktapay",
    amount: Number(amount || settings.ebook.price),
    orderBump: Boolean(orderBump),
    paymentPayload: { items: Array.isArray(items) ? items : [] }
  });

  try {
    const data = await callUddoktaPay("/api/checkout-v2", {
      full_name: name,
      email: email || `${String(phone).replace(/\D/g, "") || order.id}@customer.local`,
      amount: String(order.amount),
      metadata: {
        order_id: order.id,
        phone,
        source: "learn-ai-with-sadhin"
      },
      redirect_url: `${backendUrl}/api/payments/uddoktapay/return`,
      return_type: "GET",
      cancel_url: `${frontendUrl}/payment-cancelled?order_id=${order.id}`,
      webhook_url: `${backendUrl}/api/payments/uddoktapay/webhook`
    });

    if (!data.payment_url) {
      order.status = "rejected";
      order.paymentPayload = { ...order.paymentPayload, checkoutError: data };
      await order.save();
      return res.status(502).json({ message: data.message || "Could not start payment" });
    }

    order.paymentInvoiceId = data.invoice_id || invoiceIdFromPaymentUrl(data.payment_url);
    order.paymentPayload = { ...order.paymentPayload, checkout: data };
    await order.save();
    res.status(201).json({ orderId: order.id, status: order.status, paymentUrl: data.payment_url });
  } catch (error) {
    order.status = "rejected";
    order.paymentPayload = { ...order.paymentPayload, checkoutError: { message: error.message } };
    await order.save();
    res.status(502).json({ message: error.message || "Could not connect to UddoktaPay" });
  }
});

app.post("/api/manual-orders", async (req, res) => {
  const { name, phone, email, method, transactionId, amount, orderBump } = req.body;
  if (!name || !phone || !method || !transactionId) {
    return res.status(400).json({ message: "নাম, ফোন, পেমেন্ট মাধ্যম ও Transaction ID দিন" });
  }

  if (!["bkash", "nagad"].includes(method)) {
    return res.status(400).json({ message: "সঠিক পেমেন্ট মাধ্যম নির্বাচন করুন" });
  }

  const settings = await getSettings();
  const order = await Order.create({
    name,
    phone,
    email: email || "",
    method,
    transactionId,
    amount: Number(amount || settings.ebook.price),
    orderBump: Boolean(orderBump)
  });

  res.status(201).json({ orderId: order.id, status: order.status });
});

app.all("/api/payments/uddoktapay/return", async (req, res) => {
  const invoiceId = req.query.invoice_id || req.body?.invoice_id;
  if (!invoiceId) {
    return res.redirect(`${frontendUrl}/payment-failed?message=missing_invoice`);
  }

  try {
    const paymentData = await callUddoktaPay("/api/verify-payment", { invoice_id: String(invoiceId) });
    const orderId = paymentData.metadata?.order_id;
    const order = orderId ? await Order.findById(orderId) : await Order.findOne({ paymentInvoiceId: String(invoiceId) });

    if (!order) {
      return res.redirect(`${frontendUrl}/payment-failed?invoice_id=${encodeURIComponent(String(invoiceId))}`);
    }

    order.paymentInvoiceId = String(invoiceId);
    if (paymentData.status === "COMPLETED") {
      await approveUddoktaPayOrder(order, paymentData);
      return res.redirect(`${frontendUrl}/payment-success?order_id=${order.id}&invoice_id=${encodeURIComponent(String(invoiceId))}`);
    }

    if (["ERROR", "CANCELED", "CANCELLED"].includes(paymentData.status)) {
      order.status = "rejected";
    }
    order.paymentPayload = paymentData;
    await order.save();
    const path = order.status === "rejected" ? "payment-failed" : "payment-pending";
    return res.redirect(`${frontendUrl}/${path}?order_id=${order.id}&invoice_id=${encodeURIComponent(String(invoiceId))}`);
  } catch (error) {
    return res.redirect(`${frontendUrl}/payment-failed?message=${encodeURIComponent(error.message || "verify_failed")}`);
  }
});

app.post("/api/payments/uddoktapay/webhook", async (req, res) => {
  const invoiceId = req.body?.invoice_id;
  if (!invoiceId) return res.status(400).json({ message: "invoice_id is required" });

  try {
    const paymentData = await callUddoktaPay("/api/verify-payment", { invoice_id: String(invoiceId) });
    const orderId = paymentData.metadata?.order_id || req.body?.metadata?.order_id;
    const order = orderId ? await Order.findById(orderId) : await Order.findOne({ paymentInvoiceId: String(invoiceId) });
    if (!order) return res.status(404).json({ message: "Order not found" });

    order.paymentInvoiceId = String(invoiceId);
    if (paymentData.status === "COMPLETED") {
      await approveUddoktaPayOrder(order, paymentData);
    } else {
      if (["ERROR", "CANCELED", "CANCELLED"].includes(paymentData.status)) order.status = "rejected";
      order.paymentPayload = paymentData;
      await order.save();
    }

    res.json({ ok: true, orderId: order.id, status: order.status });
  } catch (error) {
    res.status(502).json({ message: error.message || "Webhook verification failed" });
  }
});

app.get("/api/orders/:id/payment-status", async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: "Order not found" });

  if (order.paymentGateway === "uddoktapay" && order.paymentInvoiceId && order.status !== "approved") {
    try {
      await refreshUddoktaPayOrder(order);
    } catch (error) {
      console.error("UddoktaPay status refresh failed:", error);
    }
  }

  res.json({
    orderId: order.id,
    status: order.status,
    invoiceId: order.paymentInvoiceId,
    downloadReady: Boolean(order.downloadToken)
  });
});

app.post("/api/admin/login", async (req, res) => {
  const { email, password } = req.body;
  const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";

  if (email !== adminEmail || password !== adminPassword) {
    return res.status(401).json({ message: "ইমেইল বা পাসওয়ার্ড সঠিক নয়" });
  }

  const token = jwt.sign({ email, role: "admin" }, jwtSecret, { expiresIn: "12h" });
  const settings = await getSettings();
  res.json({
    token,
    ebook: settings.ebook,
    payment: settings.payment,
    content: mergeContent(settings.content)
  });
});

app.get("/api/products", async (_req, res) => {
  const products = await Product.find({ status: "active" }).sort({ createdAt: -1 });
  res.json({ products });
});

app.get("/api/admin/orders", requireAdmin, async (_req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 });
  res.json({ orders });
});

app.get("/api/admin/products", requireAdmin, async (_req, res) => {
  const products = await Product.find().sort({ createdAt: -1 });
  res.json({ products });
});

app.post("/api/admin/products", requireAdmin, upload.fields([
  { name: "productImage", maxCount: 1 },
  { name: "productVideo", maxCount: 1 },
  { name: "productFile", maxCount: 1 }
]), async (req, res) => {
  const { title, type, price, originalPrice, description, stock, sku, shippingCharge, deliveryOptions, deliveryNote, youtubeUrl, isUpsell } = req.body;

  if (!title || !["ebook", "physical"].includes(type)) {
    return res.status(400).json({ message: "Product title এবং type প্রয়োজন" });
  }

  const product = {
    title,
    type,
    price: Number(price || 0),
    originalPrice: Number(originalPrice || 0),
    description: description || "",
    stock: type === "physical" ? Number(stock || 0) : null,
    sku: sku || "",
    shippingCharge: type === "physical" ? Number(shippingCharge || 0) : 0,
    deliveryOptions: type === "physical" ? String(deliveryOptions || "").split(",").map((item) => item.trim()).filter(Boolean) : ["Digital download"],
    deliveryNote: deliveryNote || "",
    youtubeUrl: youtubeUrl || "",
    isUpsell: readBoolean(isUpsell),
    status: "active"
  };

  const imageFile = req.files?.productImage?.[0];
  if (imageFile) {
    product.imageUrl = await uploadImage(imageFile.buffer, "ebook-store/products");
  }

  const videoFile = req.files?.productVideo?.[0];
  if (videoFile) {
    product.videoUrl = await uploadVideo(videoFile.buffer, "ebook-store/product-videos");
  }

  const productFile = req.files?.productFile?.[0];
  if (productFile) {
    const uploaded = await uploadPrivateFile(productFile.buffer, "ebook-store/files", productFile.originalname);
    product.filePublicId = uploaded.publicId;
    product.fileFormat = uploaded.format;
    product.fileResourceType = uploaded.resourceType;
    product.originalFileName = productFile.originalname;
  }

  const created = await Product.create(product);
  res.status(201).json({ product: created });
});

app.patch("/api/admin/products/:id", requireAdmin, upload.fields([
  { name: "productImage", maxCount: 1 },
  { name: "productVideo", maxCount: 1 },
  { name: "productFile", maxCount: 1 }
]), async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: "Product পাওয়া যায়নি" });

  const { title, price, originalPrice, description, stock, sku, shippingCharge, deliveryOptions, deliveryNote, youtubeUrl, isUpsell, status } = req.body;

  if (title) product.title = title;
  if (price !== undefined) product.price = Number(price);
  if (originalPrice !== undefined) product.originalPrice = Number(originalPrice);
  if (description !== undefined) product.description = description;
  if (stock !== undefined && product.type === "physical") product.stock = Number(stock);
  if (sku !== undefined) product.sku = sku;
  if (shippingCharge !== undefined) product.shippingCharge = Number(shippingCharge);
  if (deliveryOptions) product.deliveryOptions = String(deliveryOptions).split(",").map((x) => x.trim()).filter(Boolean);
  if (deliveryNote !== undefined) product.deliveryNote = deliveryNote;
  if (youtubeUrl !== undefined) product.youtubeUrl = youtubeUrl;
  if (isUpsell !== undefined) product.isUpsell = readBoolean(isUpsell);
  if (status && ["active", "draft", "archived"].includes(status)) product.status = status;

  const imageFile = req.files?.productImage?.[0];
  if (imageFile) {
    product.imageUrl = await uploadImage(imageFile.buffer, "ebook-store/products");
  }

  const videoFile = req.files?.productVideo?.[0];
  if (videoFile) {
    product.videoUrl = await uploadVideo(videoFile.buffer, "ebook-store/product-videos");
  }

  const productFile = req.files?.productFile?.[0];
  if (productFile) {
    const uploaded = await uploadPrivateFile(productFile.buffer, "ebook-store/files", productFile.originalname);
    product.filePublicId = uploaded.publicId;
    product.fileFormat = uploaded.format;
    product.fileResourceType = uploaded.resourceType;
    product.originalFileName = productFile.originalname;
  }

  await product.save();
  res.json({ product });
});

app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) return res.status(404).json({ message: "Product পাওয়া যায়নি" });
  res.json({ ok: true });
});

app.get("/api/admin/settings", requireAdmin, async (_req, res) => {
  const settings = await getSettings();
  res.json({
    ebook: settings.ebook,
    payment: settings.payment,
    content: mergeContent(settings.content)
  });
});

app.put("/api/admin/settings", requireAdmin, upload.fields([
  { name: "ebookFile", maxCount: 1 },
  { name: "coverImage", maxCount: 1 },
  { name: "logoImage", maxCount: 1 },
  { name: "faviconImage", maxCount: 1 },
  { name: "seoImage", maxCount: 1 },
  { name: "heroBannerImage", maxCount: 1 },
  { name: "authorImage", maxCount: 1 },
  { name: "guaranteeImage", maxCount: 1 },
  { name: "testimonialImage0", maxCount: 1 },
  { name: "testimonialImage1", maxCount: 1 },
  { name: "testimonialImage2", maxCount: 1 },
  { name: "testimonialImage3", maxCount: 1 },
  { name: "testimonialImage4", maxCount: 1 },
  { name: "testimonialImage5", maxCount: 1 },
  { name: "customSectionImage0", maxCount: 1 },
  { name: "customSectionImage1", maxCount: 1 },
  { name: "customSectionImage2", maxCount: 1 },
  { name: "customSectionImage3", maxCount: 1 },
  { name: "customSectionImage4", maxCount: 1 },
  { name: "customSectionImage5", maxCount: 1 },
  { name: "v2AuthorImage", maxCount: 1 },
  { name: "v2VideoTestimonialImage0", maxCount: 1 },
  { name: "v2VideoTestimonialImage1", maxCount: 1 },
  { name: "v2VideoTestimonialImage2", maxCount: 1 },
  { name: "v2VideoTestimonialImage3", maxCount: 1 },
  { name: "v2VideoTestimonialImage4", maxCount: 1 },
  { name: "v2VideoTestimonialImage5", maxCount: 1 }
]), async (req, res) => {
  const settings = await getSettings();
  const { title, subtitle, description, price, originalPrice, bkashNumber, nagadNumber, instructions, contentJson } = req.body;

  settings.ebook.title = title || settings.ebook.title;
  settings.ebook.subtitle = subtitle || settings.ebook.subtitle;
  settings.ebook.description = description || settings.ebook.description;
  settings.ebook.price = Number(price || settings.ebook.price);
  settings.ebook.originalPrice = Number(originalPrice || settings.ebook.originalPrice);

  const ebookFile = req.files?.ebookFile?.[0];
  if (ebookFile) {
    const uploaded = await uploadPrivateFile(ebookFile.buffer, "ebook-store/files", ebookFile.originalname);
    settings.ebook.filePublicId = uploaded.publicId;
    settings.ebook.fileFormat = uploaded.format;
    settings.ebook.fileResourceType = uploaded.resourceType;
    settings.ebook.originalFileName = ebookFile.originalname;
  }

  const coverUrl = await uploadIfPresent(req, "coverImage");
  if (coverUrl) settings.ebook.coverUrl = coverUrl;

  settings.payment.bkashNumber = bkashNumber || settings.payment.bkashNumber;
  settings.payment.nagadNumber = nagadNumber || settings.payment.nagadNumber;
  settings.payment.instructions = instructions || settings.payment.instructions;

  let content = mergeContent(settings.content);
  if (contentJson) {
    try {
      content = mergeContent(JSON.parse(contentJson));
    } catch {
      return res.status(400).json({ message: "Content JSON সঠিক নয়" });
    }
  }

  const logoUrl = await uploadIfPresent(req, "logoImage");
  if (logoUrl) content.logoUrl = logoUrl;

  const faviconUrl = await uploadIfPresent(req, "faviconImage");
  if (faviconUrl) content.faviconUrl = faviconUrl;

  const seoImageUrl = await uploadIfPresent(req, "seoImage");
  if (seoImageUrl) content.seoImageUrl = seoImageUrl;

  const heroBannerUrl = await uploadIfPresent(req, "heroBannerImage");
  if (heroBannerUrl) content.heroBannerUrl = heroBannerUrl;

  const authorPhotoUrl = await uploadIfPresent(req, "authorImage");
  if (authorPhotoUrl) content.authorPhotoUrl = authorPhotoUrl;

  const guaranteeBadgeUrl = await uploadIfPresent(req, "guaranteeImage");
  if (guaranteeBadgeUrl) content.guaranteeBadgeUrl = guaranteeBadgeUrl;

  for (let index = 0; index < 6; index += 1) {
    const url = await uploadIfPresent(req, `testimonialImage${index}`);
    if (url && content.testimonials?.[index]) {
      content.testimonials[index].imageUrl = url;
    }
  }

  for (let index = 0; index < 6; index += 1) {
    const url = await uploadIfPresent(req, `customSectionImage${index}`);
    if (url && content.customSections?.[index]) {
      content.customSections[index].imageUrl = url;
    }
  }

  const v2AuthorPhotoUrl = await uploadIfPresent(req, "v2AuthorImage");
  if (v2AuthorPhotoUrl) content.v2.author.photoUrl = v2AuthorPhotoUrl;

  for (let index = 0; index < 6; index += 1) {
    const url = await uploadIfPresent(req, `v2VideoTestimonialImage${index}`);
    if (url && content.v2.videoTestimonials?.[index]) {
      content.v2.videoTestimonials[index].imageUrl = url;
    }
  }

  settings.content = content;
  settings.markModified("ebook");
  settings.markModified("payment");
  settings.markModified("content");
  await settings.save();

  res.json({
    ebook: settings.ebook,
    payment: settings.payment,
    content: mergeContent(settings.content)
  });
});

app.patch("/api/admin/orders/:id", requireAdmin, async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: "অর্ডার পাওয়া যায়নি" });

  const status = req.body.status || order.status;
  if (!["approved", "rejected", "pending"].includes(status)) {
    return res.status(400).json({ message: "সঠিক স্ট্যাটাস দিন" });
  }

  const wasAlreadyApproved = order.status === "approved";
  order.status = status;
  if (req.body.deliveryStatus) order.deliveryStatus = req.body.deliveryStatus;
  if (typeof req.body.trackingNumber === "string") order.trackingNumber = req.body.trackingNumber;
  if (typeof req.body.deliveryNote === "string") order.deliveryNote = req.body.deliveryNote;
  order.downloadToken = status === "approved" ? createDownloadToken(order.id) : "";
  await order.save();

  if (status === "approved" && !wasAlreadyApproved && order.email) {
    const settings = await getSettings();
    const backendUrl = process.env.BACKEND_URL || `http://localhost:${port}`;
    const downloadUrl = `${backendUrl}/api/download/${order.downloadToken}`;
    sendEbookDeliveryEmail({
      to: order.email,
      customerName: order.name,
      ebookTitle: settings.ebook.title || "ইবুক",
      downloadUrl
    }).catch((err) => console.error("Email send failed:", err));
  }

  res.json({ order });
});

app.get("/api/download/:token", async (req, res) => {
  let payload;
  try {
    payload = jwt.verify(req.params.token, jwtSecret);
  } catch {
    return res.status(401).send("Download link expired");
  }

  if (payload.purpose !== "download") {
    return res.status(401).send("Invalid download link");
  }

  const order = await Order.findById(payload.orderId);
  const settings = await getSettings();
  const downloadFile = await getDownloadFileSource(settings);
  if (!order || order.status !== "approved" || !downloadFile?.filePublicId) {
    return res.status(403).send("Download not available");
  }

  const signedUrl = getSignedFileUrl(
    downloadFile.filePublicId,
    downloadFile.fileFormat,
    downloadFile.fileResourceType
  );

  const fileResponse = await fetch(signedUrl);
  if (!fileResponse.ok || !fileResponse.body) {
    return res.status(502).send("Download file unavailable");
  }

  const fileName = downloadFileName(downloadFile);
  res.setHeader("Content-Type", fileResponse.headers.get("content-type") || "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.setHeader("Cache-Control", "private, no-store");

  const contentLength = fileResponse.headers.get("content-length");
  if (contentLength) res.setHeader("Content-Length", contentLength);

  const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
  res.send(fileBuffer);
});

connectDb().then(() => {
  app.listen(port, () => {
    console.log(`Ebook backend running on http://localhost:${port}`);
  });
});
