import mongoose from "mongoose";

const { Schema } = mongoose;

const ebookSchema = new Schema(
  {
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },
    description: { type: String, default: "" },
    price: { type: Number, default: 0 },
    originalPrice: { type: Number, default: 0 },
    coverUrl: { type: String, default: "" },
    filePublicId: { type: String, default: "" },
    fileFormat: { type: String, default: "" },
    fileResourceType: { type: String, default: "" },
    originalFileName: { type: String, default: "" }
  },
  { _id: false }
);

const paymentSchema = new Schema(
  {
    bkashNumber: { type: String, default: "" },
    nagadNumber: { type: String, default: "" },
    instructions: { type: String, default: "" }
  },
  { _id: false }
);

const settingsSchema = new Schema({
  _id: { type: String, default: "main" },
  ebook: { type: ebookSchema, default: () => ({}) },
  payment: { type: paymentSchema, default: () => ({}) },
  content: { type: Schema.Types.Mixed, default: () => ({}) }
});

export const Settings = mongoose.model("Settings", settingsSchema);

export async function getSettings() {
  return Settings.findOneAndUpdate(
    { _id: "main" },
    { $setOnInsert: { _id: "main" } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}
