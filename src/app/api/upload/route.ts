import { randomUUID } from "crypto";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": process.env.UPLOAD_ALLOWED_ORIGIN?.trim() || "*",
    "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    ...init,
    headers: {
      ...corsHeaders(),
      ...init?.headers,
    },
  });
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function configureCloudinary() {
  cloudinary.config({
    cloud_name: requiredEnv("CLOUDINARY_CLOUD_NAME"),
    api_key: requiredEnv("CLOUDINARY_API_KEY"),
    api_secret: requiredEnv("CLOUDINARY_API_SECRET"),
    secure: true,
  });
}

function productFolder(productId: string) {
  const safeId = productId.trim().replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-");
  return `products/${safeId || "draft"}`;
}

function uploadBuffer(buffer: Buffer, folder: string) {
  return new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: randomUUID(),
        resource_type: "image",
        overwrite: false,
      },
      (error, result) => {
        if (error) reject(error);
        else if (!result) reject(new Error("Cloudinary did not return an upload result."));
        else resolve(result);
      },
    );

    stream.end(buffer);
  });
}

async function readImageFile(file: File) {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error(`${file.name} must be a JPG, PNG, or WebP image.`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`${file.name} is larger than 15MB.`);
  }

  return Buffer.from(await file.arrayBuffer());
}

export async function POST(request: Request) {
  try {
    configureCloudinary();

    const formData = await request.formData();
    const productId = String(formData.get("productId") || "draft");
    const files = formData.getAll("files").filter((item): item is File => item instanceof File);

    if (!files.length) {
      return json({ error: "No image files were uploaded." }, { status: 400 });
    }

    const folder = productFolder(productId);
    const uploaded = [];

    for (const file of files) {
      const buffer = await readImageFile(file);
      const result = await uploadBuffer(buffer, folder);
      uploaded.push({
        public_id: result.public_id,
        publicId: result.public_id,
        secure_url: result.secure_url,
        url: result.secure_url,
        width: result.width,
        height: result.height,
        format: result.format,
      });
    }

    return json({ images: uploaded });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    configureCloudinary();

    const body = await request.json();
    const publicIds = Array.isArray(body.publicIds)
      ? body.publicIds
        .map((id: unknown) => String(id || "").trim())
        .filter((id: string) => id.startsWith("products/"))
      : [];

    if (!publicIds.length) {
      return json({ deleted: 0 });
    }

    for (const publicId of publicIds) {
      const result = await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
      if (!["ok", "not found"].includes(String(result.result))) {
        throw new Error(`Cloudinary could not delete ${publicId}.`);
      }
    }

    return json({ deleted: publicIds.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete failed.";
    return json({ error: message }, { status: 500 });
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}
