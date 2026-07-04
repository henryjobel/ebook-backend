import mongoose from "mongoose";

const { Schema } = mongoose;

const orderSchema = new Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, default: "" },
    method: { type: String, enum: ["bkash", "nagad", "uddoktapay"], required: true },
    transactionId: { type: String, default: "" },
    paymentGateway: { type: String, default: "manual" },
    paymentInvoiceId: { type: String, default: "" },
    paymentPayload: { type: Schema.Types.Mixed, default: () => ({}) },
    amount: { type: Number, default: 0 },
    orderBump: { type: Boolean, default: false },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    deliveryStatus: { type: String, default: "not_required" },
    trackingNumber: { type: String, default: "" },
    deliveryNote: { type: String, default: "" },
    downloadToken: { type: String, default: "" }
  },
  { timestamps: true }
);

export const Order = mongoose.model("Order", orderSchema);
