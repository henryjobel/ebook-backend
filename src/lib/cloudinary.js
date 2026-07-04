import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";

dotenv.config();
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

export function uploadImage(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

export function uploadVideo(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "video" },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

export function uploadPrivateFile(buffer, folder, originalName) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "raw",
        type: "private",
        use_filename: true,
        filename_override: originalName
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({
          publicId: result.public_id,
          format: result.format || "",
          resourceType: result.resource_type
        });
      }
    );
    stream.end(buffer);
  });
}

export function getSignedFileUrl(publicId, format, resourceType) {
  return cloudinary.utils.private_download_url(publicId, format, {
    resource_type: resourceType || "raw",
    type: "private",
    expires_at: Math.floor(Date.now() / 1000) + 10 * 60
  });
}
