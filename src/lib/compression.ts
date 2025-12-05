import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import { log } from "./logger.js";

const logger = log.child("sharp");

// Shared image data type used across tools
export interface ImageData {
  b64: string;
  mimeType: string;
  ext: string;
}

// Image compression options (shared across tools)
export interface CompressionOptions {
  maxSize?: number;      // Max dimension in pixels (default: no resize)
  maxBytes?: number;     // Target max file size in bytes (default: 800KB)
  quality?: number;      // JPEG/WebP quality 1-100 (default: 85)
  format?: "jpeg" | "png" | "webp";  // Output format (default: jpeg for compression)
}

const DEFAULT_COMPRESSION: CompressionOptions = {
  maxBytes: 819_200,  // 800KB — safe for MCP payloads
  quality: 85,
  format: "jpeg",
};

// Optional sharp import for image compression
// Falls back to no-op if sharp is not available (e.g., in environments without native modules)
type SharpInstance = {
  metadata(): Promise<{ width?: number; height?: number; format?: string }>;
  resize(width: number, height: number, options?: { fit?: string; withoutEnlargement?: boolean }): SharpInstance;
  jpeg(options?: { quality?: number; mozjpeg?: boolean }): SharpInstance;
  webp(options?: { quality?: number }): SharpInstance;
  png(options?: { compressionLevel?: number }): SharpInstance;
  clone(): SharpInstance;
  toBuffer(): Promise<Buffer>;
};

type SharpModule = (input: Buffer) => SharpInstance;

let sharpModule: SharpModule | null = null;

(async () => {
  try {
    const sharp = await import("sharp");
    sharpModule = sharp.default as unknown as SharpModule;
    logger.info("compression enabled");
  } catch {
    logger.warn("compression disabled (sharp not available)");
  }
})();

export function isCompressionAvailable(): boolean {
  return sharpModule !== null;
}

/**
 * Compress image buffer using sharp.
 * Iteratively reduces quality and size until target maxBytes is reached.
 * Returns null if sharp is not available.
 */
async function compressImage(
  input: Buffer,
  options: CompressionOptions = {},
): Promise<{ buffer: Buffer; mimeType: string; ext: string } | null> {
  if (!sharpModule) {
    return null;  // Compression not available
  }

  const sharp = sharpModule;
  const { maxSize, maxBytes = DEFAULT_COMPRESSION.maxBytes, quality: initialQuality = 85, format = "jpeg" } = options;

  let image = sharp(input);
  const metadata = await image.metadata();

  // Resize if maxSize specified and image exceeds it
  if (maxSize && metadata.width && metadata.height) {
    const maxDim = Math.max(metadata.width, metadata.height);
    if (maxDim > maxSize) {
      image = image.resize(maxSize, maxSize, { fit: "inside", withoutEnlargement: true });
    }
  }

  // Convert to target format with initial quality
  let quality = initialQuality;
  let scale = 1.0;
  let buffer: Buffer;

  while (true) {
    const baseWidth = metadata.width ?? 1024;
    const baseHeight = metadata.height ?? 1024;

    let pipeline = scale < 1.0
      ? sharp(input).resize(
          Math.round(baseWidth * scale),
          Math.round(baseHeight * scale),
          { fit: "inside", withoutEnlargement: true },
        )
      : image.clone();

    if (format === "jpeg") {
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    } else if (format === "webp") {
      pipeline = pipeline.webp({ quality });
    } else {
      pipeline = pipeline.png({ compressionLevel: 9 });
    }

    buffer = await pipeline.toBuffer();

    // Check if within target size
    if (!maxBytes || buffer.length <= maxBytes) break;

    // Reduce quality first, then scale
    if (quality > 20) {
      quality -= 10;
    } else if (scale > 0.3) {
      scale *= 0.8;
      quality = initialQuality;  // Reset quality when scaling
    } else {
      break;  // Give up — return best effort
    }
  }

  return {
    buffer,
    mimeType: `image/${format}`,
    ext: format === "jpeg" ? "jpg" : format,
  };
}

/**
 * Detect image format from buffer using sharp.
 * Returns "png" as fallback if sharp is not available.
 */
export async function detectImageFormat(buffer: Buffer): Promise<string> {
  if (!sharpModule) {
    return "png";  // Default fallback
  }
  const meta = await sharpModule(buffer).metadata();
  return meta.format ?? "png";
}

/**
 * Process an image buffer with optional compression and format detection.
 */
export async function processBufferWithCompression(
  buffer: Buffer,
  compression?: CompressionOptions,
): Promise<ImageData> {
  // Only apply compression when options are explicitly provided.
  // If compression is undefined, we simply detect the format and return the original buffer.
  const shouldCompress = compression !== undefined;

  if (shouldCompress && isCompressionAvailable()) {
    const result = await compressImage(buffer, compression);
    if (result) {
      return {
        b64: result.buffer.toString("base64"),
        mimeType: result.mimeType,
        ext: result.ext,
      };
    }
  }

  const ext = await detectImageFormat(buffer);
  return {
    b64: buffer.toString("base64"),
    mimeType: `image/${ext}`,
    ext,
  };
}

/**
 * Read local image file and optionally compress it.
 */
export async function readAndProcessImage(
  filePath: string,
  compression?: CompressionOptions,
): Promise<ImageData> {
  const buffer = await fs.promises.readFile(filePath);
  return processBufferWithCompression(buffer, compression);
}

/**
 * Fetch raw image buffer from URL with redirect handling.
 */
async function fetchImageBuffer(url: string, maxRedirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error("Too many redirects"));

    const protocol = url.startsWith("https://") ? https : http;
    const req = protocol.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          fetchImageBuffer(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
          return;
        }
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const contentType = res.headers["content-type"] || "";
      const isTelegramFileUrl = url.includes("api.telegram.org") && url.includes("/file/bot");
      if (!contentType.startsWith("image/")) {
        if (!isTelegramFileUrl) {
          return reject(new Error(`Not an image: ${contentType}`));
        }
        // Telegram File API may return application/octet-stream for real images.
        // In that case we trust the URL and let downstream format detection handle it.
        logger.debug(
          `Treating Telegram file URL ${url} as image despite Content-Type=${contentType || "<empty>"}`,
        );
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);

    req.setTimeout(30_000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
}

/**
 * Fetch image from URL and optionally compress it.
 */
export async function fetchAndProcessImage(
  url: string,
  compression?: CompressionOptions,
): Promise<ImageData> {
  const buffer = await fetchImageBuffer(url);
  return processBufferWithCompression(buffer, compression);
}
