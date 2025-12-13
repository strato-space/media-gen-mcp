import { describe, it, expect } from "vitest";
import {
  isHttpUrl,
  isAbsolutePath,
  isBase64Image,
  ensureDirectoryWritable,
  validateOutputDirectory,
  extractRevisedPrompts,
  parseImageResponse,
  resolveOutputPath,
  buildResourceLinks,
} from "../src/lib/helpers.js";

describe("helpers module", () => {
  describe("isHttpUrl", () => {
    it("returns true for http URLs", () => {
      expect(isHttpUrl("http://example.com/image.png")).toBe(true);
    });

    it("returns true for https URLs", () => {
      expect(isHttpUrl("https://example.com/image.png")).toBe(true);
    });

    it("returns false for file paths", () => {
      expect(isHttpUrl("/path/to/image.png")).toBe(false);
    });

    it("returns false for base64 strings", () => {
      expect(isHttpUrl("data:image/png;base64,iVBORw0KGgo")).toBe(false);
    });

    it("returns false for relative paths", () => {
      expect(isHttpUrl("./image.png")).toBe(false);
    });
  });

  describe("isAbsolutePath", () => {
    it("returns true for undefined", () => {
      expect(isAbsolutePath(undefined)).toBe(true);
    });

    it("returns true for Unix absolute paths", () => {
      expect(isAbsolutePath("/home/user/image.png")).toBe(true);
      expect(isAbsolutePath("/tmp/file")).toBe(true);
    });

    it("returns true for Windows absolute paths", () => {
      expect(isAbsolutePath("C:/Users/image.png")).toBe(true);
      expect(isAbsolutePath("D:\\Documents\\file.txt")).toBe(true);
    });

    it("returns false for relative paths", () => {
      expect(isAbsolutePath("./image.png")).toBe(false);
      expect(isAbsolutePath("../file.txt")).toBe(false);
      expect(isAbsolutePath("image.png")).toBe(false);
    });
  });

  describe("isBase64Image", () => {
    it("returns true for base64 strings", () => {
      expect(isBase64Image("iVBORw0KGgoAAAANSUhEUg==")).toBe(true);
    });

    it("returns true for data URLs", () => {
      expect(isBase64Image("data:image/png;base64,iVBORw0KGgo")).toBe(true);
      expect(isBase64Image("data:image/jpeg;base64,/9j/4AAQ")).toBe(true);
    });

    it("returns false for undefined", () => {
      expect(isBase64Image(undefined)).toBe(false);
    });

    it("returns false for file paths", () => {
      expect(isBase64Image("/path/to/image.png")).toBe(false);
    });

    it("returns false for URLs", () => {
      expect(isBase64Image("https://example.com/image.png")).toBe(false);
    });
  });

  describe("ensureDirectoryWritable", () => {
    it("succeeds for /tmp directory", async () => {
      await expect(ensureDirectoryWritable("/tmp/test-file.txt")).resolves.toBeUndefined();
    });

    it("throws for non-existent directory", async () => {
      await expect(ensureDirectoryWritable("/nonexistent/path/file.txt")).rejects.toThrow(
        "Directory does not exist",
      );
    });
  });

  describe("validateOutputDirectory", () => {
    it("validates /tmp when file is undefined", async () => {
      await expect(validateOutputDirectory(undefined, "/tmp")).resolves.toBeUndefined();
    });

    it("validates explicit file path", async () => {
      await expect(validateOutputDirectory("/tmp/output.png")).resolves.toBeUndefined();
    });

    it("throws for invalid directory", async () => {
      await expect(validateOutputDirectory("/nonexistent/output.png")).rejects.toThrow();
    });
  });

  describe("extractRevisedPrompts", () => {
    it("extracts revised prompts from response data", () => {
      const data = [
        { revised_prompt: "A beautiful sunset over the ocean" },
        { revised_prompt: "A serene mountain landscape" },
      ];
      const result = extractRevisedPrompts(data);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ type: "text", text: "A beautiful sunset over the ocean" });
      expect(result[1]).toEqual({ type: "text", text: "A serene mountain landscape" });
    });

    it("filters out items without revised_prompt", () => {
      const data = [
        { revised_prompt: "Valid prompt" },
        {},
        { revised_prompt: "Another prompt" },
      ];
      const result = extractRevisedPrompts(data);

      expect(result).toHaveLength(2);
    });

    it("returns empty array for empty input", () => {
      expect(extractRevisedPrompts([])).toEqual([]);
    });
  });

  describe("parseImageResponse", () => {
    it("parses API response into ImageData array", () => {
      const data = [
        { b64_json: "base64data1" },
        { b64_json: "base64data2" },
      ];
      const result = parseImageResponse(data, "png");

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        b64: "base64data1",
        mimeType: "image/png",
        ext: "png",
      });
    });

    it("uses correct mime type for different formats", () => {
      const data = [{ b64_json: "test" }];

      expect(parseImageResponse(data, "jpeg")[0]?.mimeType).toBe("image/jpeg");
      expect(parseImageResponse(data, "webp")[0]?.mimeType).toBe("image/webp");
      expect(parseImageResponse(data, "png")[0]?.mimeType).toBe("image/png");
    });
  });

  describe("resolveOutputPath", () => {
    const mockImages = [
      { b64: "c2hvcnQ=", mimeType: "image/png", ext: "png" },
    ];

    it("keeps base64 output for small images", () => {
      const result = resolveOutputPath(mockImages, "b64_json", undefined, "test");
      expect(result.effectiveOutput).toBe("base64");
    });

    it("switches to file for large images", () => {
      // Create a base64 string that when measured by Buffer.byteLength exceeds 1MB
      // Buffer.byteLength for base64 returns decoded size, so we need ~1.4M chars for 1M bytes
      const largeB64 = "A".repeat(1_500_000);
      const largeImage = { b64: largeB64, mimeType: "image/png", ext: "png" };
      const result = resolveOutputPath([largeImage], "b64_json", undefined, "test", {
        maxResponseSize: 1_000_000, // 1MB limit
      });
      expect(result.effectiveOutput).toBe("file");
    });

    it("uses provided file path", () => {
      const result = resolveOutputPath(mockImages, "url", "/custom/path.png", "test");
      expect(result.effectiveFileOutput).toBe("/custom/path.png");
    });

    it("generates file path when not provided", () => {
      const result = resolveOutputPath(mockImages, "url", undefined, "create", {
        outputDir: "/tmp",
      });
      expect(result.effectiveFileOutput).toMatch(/^\/tmp\/output_\d+_media-gen__create_[\w-]+\.png$/);
    });
  });

  describe("buildResourceLinks", () => {
    it("builds resource links from files", () => {
      const files = ["/tmp/image1.png", "/tmp/image2.jpg"];
      const result = buildResourceLinks(files);

      expect(result.files).toEqual(files);
      expect(result.resourceLinks).toHaveLength(2);
      expect(result.resourceLinks[0]).toEqual({
        type: "resource_link",
        uri: "file:///tmp/image1.png",
        name: "image1.png",
        mimeType: "image/png",
      });
    });

    it("includes URLs when prefix is provided", () => {
      const files = ["/tmp/image.png"];
      const result = buildResourceLinks(files, "https://cdn.example.com");

      expect(result.urls).toEqual(["https://cdn.example.com/image.png"]);
    });

    it("returns empty URLs without prefix", () => {
      const files = ["/tmp/image.png"];
      const result = buildResourceLinks(files);

      expect(result.urls).toEqual([]);
    });
  });
});
