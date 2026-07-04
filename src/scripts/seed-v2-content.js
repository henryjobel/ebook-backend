import dotenv from "dotenv";
import { connectDb } from "../db.js";
import { getSettings } from "../models/Settings.js";
import { mergeContent } from "../defaultContent.js";

dotenv.config();

const v2Patch = {
  brandName: "Learn AI With Sadhin",
  logoUrl: "",
  trustLine: "৩,২০০+ জন ইতিমধ্যে পড়েছেন",
  stickyCta: "এখনই নিন",
  heroPill: "🔥 ২০২৬ সালের সবচেয়ে দরকারি গাইড",
  heroHeadline: "AI শিখে ঘরে বসেই শুরু করুন ফ্রিল্যান্সিং",
  heroSubheadline: "শুধু স্মার্টফোন আর ইন্টারনেট থাকলেই হবে - অভিজ্ঞতা লাগবে না।",
  heroCta: "এখনই ডাউনলোড করুন - মাত্র ৯৯ টাকা",
  heroGuaranteeBadge: "৭ দিনের মানি-ব্যাক গ্যারান্টি",
  bonuses: [
    { title: "AI Prompt Cheat Sheet", text: "রেডি-টু-ইউজ প্রম্পট কালেকশন", value: 199 },
    { title: "Client Email Templates (বাংলা)", text: "ক্লায়েন্টকে পাঠানোর রেডি মেসেজ", value: 149 },
    { title: "৩০-Day Action Plan PDF", text: "প্রথম আয়ের জন্য দৈনিক অ্যাকশন প্ল্যান", value: 99 }
  ]
};

await connectDb();
const settings = await getSettings();
const content = mergeContent(settings.content);

settings.ebook.title = "AI দিয়ে ফ্রিল্যান্সিং";
settings.ebook.subtitle = "২০২৬ সালে অনলাইনে আয় করার সহজ বাংলা গাইড";
settings.ebook.description = "AI tools ব্যবহার করে ঘরে বসে ফ্রিল্যান্সিং শুরু করার step-by-step Bangla ebook.";
settings.ebook.price = 99;
settings.ebook.originalPrice = 499;

settings.content = {
  ...content,
  brandName: v2Patch.brandName,
  trustLine: v2Patch.trustLine,
  stickyCta: v2Patch.stickyCta,
  heroHeadline: v2Patch.heroHeadline,
  heroSubheadline: v2Patch.heroSubheadline,
  heroCta: v2Patch.heroCta,
  bonuses: v2Patch.bonuses,
  v2: {
    ...content.v2,
    ...v2Patch
  }
};

settings.markModified("ebook");
settings.markModified("content");
await settings.save();
console.log("Seeded Frontend-v2 content into MongoDB settings.");
process.exit(0);
