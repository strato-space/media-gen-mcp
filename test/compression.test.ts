import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import {
  type ImageData,
  type CompressionOptions,
  isCompressionAvailable,
  detectImageFormat,
  processBufferWithCompression,
  readAndProcessImage,
} from "../src/lib/compression.js";

// Small 1x1 PNG (red pixel) for testing
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_BASE64, "base64");

// Small 1x1 JPEG (red pixel) for testing
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQCERAA=";
const TINY_JPEG_BUFFER = Buffer.from(TINY_JPEG_BASE64, "base64");

describe("compression module", () => {
  describe("isCompressionAvailable", () => {
    it("returns boolean", () => {
      const result = isCompressionAvailable();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("detectImageFormat", () => {
    it("detects PNG format", async () => {
      const format = await detectImageFormat(TINY_PNG_BUFFER);
      // If sharp is available, it returns "png"; otherwise fallback "png"
      expect(format).toBe("png");
    });

    it("detects JPEG format when sharp available", async () => {
      const format = await detectImageFormat(TINY_JPEG_BUFFER);
      // If sharp is available, it returns "jpeg"; otherwise fallback "png"
      if (isCompressionAvailable()) {
        expect(format).toBe("jpeg");
      } else {
        expect(format).toBe("png"); // fallback
      }
    });
  });

  describe("processBufferWithCompression", () => {
    it("processes small PNG without compression", async () => {
      const result = await processBufferWithCompression(TINY_PNG_BUFFER);

      expect(result).toHaveProperty("b64");
      expect(result).toHaveProperty("mimeType");
      expect(result).toHaveProperty("ext");
      expect(typeof result.b64).toBe("string");
      expect(result.b64.length).toBeGreaterThan(0);
    });

    it("returns valid ImageData structure", async () => {
      const result = await processBufferWithCompression(TINY_PNG_BUFFER);

      // Verify ImageData shape
      expect(result.mimeType).toMatch(/^image\//);
      expect(["png", "jpg", "jpeg", "webp"]).toContain(result.ext);
    });

    it("applies compression options when sharp available", async () => {
      const options: CompressionOptions = {
        maxSize: 100,
        quality: 50,
        format: "jpeg",
      };

      const result = await processBufferWithCompression(TINY_PNG_BUFFER, options);

      if (isCompressionAvailable()) {
        expect(result.mimeType).toBe("image/jpeg");
        expect(result.ext).toBe("jpg");
      }
    });
  });

  describe("readAndProcessImage", () => {
    const testImagePath = "/tmp/test-image-media-gen-mcp.png";

    beforeAll(async () => {
      // Write test image to disk
      await fs.promises.writeFile(testImagePath, TINY_PNG_BUFFER);
    });

    it("reads and processes local file", async () => {
      const result = await readAndProcessImage(testImagePath);

      expect(result).toHaveProperty("b64");
      expect(result).toHaveProperty("mimeType");
      expect(result).toHaveProperty("ext");
      expect(result.b64.length).toBeGreaterThan(0);
    });

    it("throws on non-existent file", async () => {
      await expect(readAndProcessImage("/nonexistent/path.png")).rejects.toThrow();
    });
  });
});

describe("ImageData type", () => {
  it("has correct structure", () => {
    const imageData: ImageData = {
      b64: "base64string",
      mimeType: "image/png",
      ext: "png",
    };

    expect(imageData.b64).toBe("base64string");
    expect(imageData.mimeType).toBe("image/png");
    expect(imageData.ext).toBe("png");
  });
});

describe("CompressionOptions type", () => {
  it("accepts all optional fields", () => {
    const options: CompressionOptions = {
      maxSize: 1024,
      maxBytes: 819200,
      quality: 85,
      format: "jpeg",
    };

    expect(options.maxSize).toBe(1024);
    expect(options.maxBytes).toBe(819200);
    expect(options.quality).toBe(85);
    expect(options.format).toBe("jpeg");
  });

  it("accepts empty object", () => {
    const options: CompressionOptions = {};
    expect(options).toEqual({});
  });

  it("accepts format variants", () => {
    const jpeg: CompressionOptions = { format: "jpeg" };
    const png: CompressionOptions = { format: "png" };
    const webp: CompressionOptions = { format: "webp" };

    expect(jpeg.format).toBe("jpeg");
    expect(png.format).toBe("png");
    expect(webp.format).toBe("webp");
  });
});
