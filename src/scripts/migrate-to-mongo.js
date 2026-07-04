/**
 * One-off migration: Backend/data/db.json + store.sqlite (local files/uploads)
 * -> MongoDB (Atlas) + Cloudinary.
 *
 * Usage: fill MONGODB_URI + CLOUDINARY_* in Backend/.env, then:
 *   node src/scripts/migrate-to-mongo.js
 */
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { connectDb } from "../db.js";
import { Settings } from "../models/Settings.js";
import { Product } from "../models/Product.js";
import { Order } from "../models/Order.js";
import { mergeContent } from "../defaultContent.js";
import { uploadImage, uploadPrivateFile } from "../lib/cloudinary.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const dataDir = path.join(rootDir, "data");
const uploadDir = path.join(rootDir, "uploads");
const dbPath = path.join(dataDir, "db.json");
const sqlitePath = path.join(dataDir, "store.sqlite");

async function readLocalFile(relativeUrl) {
  if (!relativeUrl || !relativeUrl.startsWith("/uploads/")) return null;
  const filePath = path.join(uploadDir, relativeUrl.replace("/uploads/", ""));
  try {
    return await fs.readFile(filePath);
  } catch {
    console.warn(`  ! could not read local file for ${relativeUrl}, skipping`);
    return null;
  }
}

async function migrateImageField(obj, key) {
  const buffer = await readLocalFile(obj?.[key]);
  if (!buffer) return;
  obj[key] = await uploadImage(buffer, "ebook-store");
  console.log(`  - uploaded image field "${key}"`);
}

async function migrateFileField(obj, fileNameKey, prefix) {
  const fileName = obj?.[fileNameKey];
  if (!fileName) return;
  const filePath = path.join(uploadDir, fileName);
  let buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    console.warn(`  ! could not read local file ${fileName}, skipping`);
    return;
  }
  const uploaded = await uploadPrivateFile(buffer, prefix, obj.originalFileName || fileName);
  obj.filePublicId = uploaded.publicId;
  obj.fileFormat = uploaded.format;
  obj.fileResourceType = uploaded.resourceType;
  console.log(`  - uploaded private file "${fileName}"`);
}

async function migrateSettings(raw) {
  const existing = await Settings.findById("main");
  if (existing) {
    console.log("Settings already exist in Mongo, skipping settings migration.");
    return;
  }

  const ebook = { ...(raw.ebook || {}) };
  await migrateImageField(ebook, "coverUrl");
  await migrateFileField(ebook, "fileName", "ebook-store/files");
  delete ebook.fileName;

  const payment = { ...(raw.payment || {}) };
  const content = mergeContent(raw.content || {});

  await migrateImageField(content, "logoUrl");
  await migrateImageField(content, "faviconUrl");
  await migrateImageField(content, "seoImageUrl");
  await migrateImageField(content, "heroBannerUrl");
  await migrateImageField(content, "authorPhotoUrl");
  await migrateImageField(content, "guaranteeBadgeUrl");

  for (const testimonial of content.testimonials || []) {
    await migrateImageField(testimonial, "imageUrl");
  }
  for (const section of content.customSections || []) {
    await migrateImageField(section, "imageUrl");
  }

  await Settings.create({ _id: "main", ebook, payment, content });
  console.log("Settings migrated.");
}

async function migrateProducts() {
  const existingCount = await Product.countDocuments();
  if (existingCount > 0) {
    console.log("Products already exist in Mongo, skipping product migration.");
    return;
  }

  const sql = new DatabaseSync(sqlitePath);
  const rows = sql.prepare("SELECT * FROM products ORDER BY createdAt DESC").all();
  sql.close();

  for (const row of rows) {
    const product = {
      title: row.title,
      type: row.type,
      price: row.price,
      originalPrice: row.originalPrice,
      description: row.description,
      stock: row.stock,
      sku: row.sku,
      shippingCharge: row.shippingCharge,
      deliveryOptions: JSON.parse(row.deliveryOptions || "[]"),
      deliveryNote: row.deliveryNote,
      status: row.status,
      originalFileName: row.originalFileName || "",
      createdAt: row.createdAt ? new Date(row.createdAt) : undefined
    };

    await migrateImageField(product, "imageUrl");
    if (row.imageUrl && !product.imageUrl) product.imageUrl = "";
    if (row.fileName) {
      await migrateFileField({ ...product, originalFileName: row.originalFileName }, "fileName", "ebook-store/files");
    }

    await Product.create(product);
    console.log(`Product migrated: ${row.title}`);
  }
}

async function migrateOrders(raw) {
  const existingCount = await Order.countDocuments();
  if (existingCount > 0) {
    console.log("Orders already exist in Mongo, skipping order migration.");
    return;
  }

  for (const order of raw.orders || []) {
    await Order.create({
      name: order.name,
      phone: order.phone,
      email: order.email || "",
      method: order.method,
      transactionId: order.transactionId,
      amount: order.amount,
      orderBump: Boolean(order.orderBump),
      status: order.status || "pending",
      deliveryStatus: order.deliveryStatus || "not_required",
      trackingNumber: order.trackingNumber || "",
      deliveryNote: order.deliveryNote || "",
      downloadToken: "",
      createdAt: order.createdAt ? new Date(order.createdAt) : undefined
    });
  }
  console.log(`${(raw.orders || []).length} orders migrated (download tokens cleared - re-approve to regenerate).`);
}

async function main() {
  await connectDb();

  const raw = JSON.parse(await fs.readFile(dbPath, "utf8"));

  console.log("Migrating settings (ebook/payment/content)...");
  await migrateSettings(raw);

  console.log("Migrating products...");
  await migrateProducts();

  console.log("Migrating orders...");
  await migrateOrders(raw);

  console.log("Done.");
  process.exit(0);
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
