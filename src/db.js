import mongoose from "mongoose";

export async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set");
  }
  await mongoose.connect(uri);
  console.log("MongoDB connected");
}

const READY_STATE_LABELS = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting"
};

export function getDbStatus() {
  const state = mongoose.connection.readyState;
  return { state, label: READY_STATE_LABELS[state] || "unknown", connected: state === 1 };
}
