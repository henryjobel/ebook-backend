import mongoose from "mongoose";

const { Schema } = mongoose;

const productSchema = new Schema(
  {
    title: { type: String, required: true },
    type: { type: String, enum: ["ebook", "physical"], required: true },
    price: { type: Number, default: 0 },
    originalPrice: { type: Number, default: 0 },
    description: { type: String, default: "" },
    stock: { type: Number, default: null },
    sku: { type: String, default: "" },
    shippingCharge: { type: Number, default: 0 },
    deliveryOptions: { type: [String], default: [] },
    deliveryNote: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    videoUrl: { type: String, default: "" },
    youtubeUrl: { type: String, default: "" },
    isUpsell: { type: Boolean, default: false },
    filePublicId: { type: String, default: "" },
    fileFormat: { type: String, default: "" },
    fileResourceType: { type: String, default: "" },
    originalFileName: { type: String, default: "" },
    status: { type: String, enum: ["active", "draft", "archived"], default: "active" }
  },
  { timestamps: true }
);

export const Product = mongoose.model("Product", productSchema);
