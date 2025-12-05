/**
 * Zod schemas for media-gen-mcp tools.
 * Exported for unit testing and type inference.
 */

import { z } from "zod";
import { isAbsolutePath } from "./helpers.js";

// Shared compression schema
export const compressionSchema = z.object({
  maxSize: z.number().int().positive().optional()
    .describe("Max dimension in pixels. Larger images are resized."),
  maxBytes: z.number().int().positive().optional()
    .describe("Target max file size in bytes. Default: 800KB."),
  quality: z.number().int().min(1).max(100).optional()
    .describe("JPEG/WebP quality 1-100. Default: 85."),
  format: z.enum(["jpeg", "png", "webp"]).optional()
    .describe("Output format. Default: jpeg (best compression)."),
}).optional().describe("Compression options. If omitted, no compression is applied.");

// tool_result schema: controls content[] shape (MCP content blocks)
// resource_link -> ResourceLink items in content[]
// image         -> ImageContent items with base64 in content[]
const toolResultEnum = z.enum(["resource_link", "image"]);
export type ToolResultType = z.infer<typeof toolResultEnum>;

// response_format schema: controls structuredContent shape (OpenAI Images API format)
// url      -> data[].url in structuredContent
// b64_json -> data[].b64_json in structuredContent
const responseFormatEnum = z.enum(["url", "b64_json"]);
export type ResponseFormatType = z.infer<typeof responseFormatEnum>;

// openai-images-generate base schema (without output/file for reuse)
export const openaiImagesGenerateBaseSchema = z.object({
  prompt: z.string().max(32000).describe("Text prompt describing the desired image (max 32K chars)."),
  background: z.enum(["transparent", "opaque", "auto"]).optional()
    .describe("Background type (default: auto). Use 'transparent' for PNG with alpha channel."),
  moderation: z.enum(["low", "auto"]).optional()
    .describe("Moderation level (default: auto). 'low' for less restrictive adult content filtering."),
  size: z.enum([
    "1024x1024",
    "1536x1024",
    "1024x1536",
    "auto",
  ]).optional().describe("Image dimensions (default: auto)."),
  quality: z.enum(["low", "medium", "high", "auto"]).optional()
    .describe("Quality/detail (default: auto). 'high' for detailed images, 'low' for fast previews."),
  n: z.number().int().min(1).max(10).optional()
    .describe("Number of images to generate (1-10, default: 1)."),
  output_format: z.enum(["png", "webp", "jpeg"]).optional()
    .describe("Output format (default: png). Use 'webp' or 'jpeg' for smaller files."),
  output_compression: z.number().int().min(0).max(100).optional()
    .describe("Compression level (0-100, default: varies by format)."),
  user: z.string().optional()
    .describe("Optional user ID for abuse tracking."),
  tool_result: toolResultEnum.default("resource_link").optional()
    .describe("Controls content[] shape: 'resource_link' (default) emits ResourceLink items, 'image' emits base64 ImageContent blocks."),
});

// Full openai-images-generate schema with response_format and file
export const openaiImagesGenerateSchema = openaiImagesGenerateBaseSchema.extend({
  response_format: responseFormatEnum.default("url")
    .describe("Response format: url (file/URL-based) or b64_json (inline base64). Default: url."),
  file: z.string().optional()
    .refine((val) => !val || isAbsolutePath(val), { message: "file must be an absolute path if provided" })
    .describe("Base path for output files. If multiple images, index suffix is added."),
});

// openai-images-edit base schema
export const openaiImagesEditBaseSchema = z.object({
  prompt: z.string().max(32000).describe("Text prompt describing the desired edit (max 32K chars)."),
  image: z.union([
    z.string(),
    z.array(z.string()).min(1).max(16),
  ]).describe("Base64 image(s), file path(s), or URL(s) to edit. Can be a single value or array of 1-16 items."),
  mask: z.string().optional()
    .describe("Base64 mask image or file path. White pixels are edited, black pixels preserved."),
  size: z.enum([
    "1024x1024",
    "1536x1024",
    "1024x1536",
    "auto",
  ]).optional().describe("Output dimensions (default: auto)."),
  n: z.number().int().min(1).max(10).optional()
    .describe("Number of edits (1-10, default: 1)."),
  quality: z.enum(["low", "medium", "high", "auto"]).optional()
    .describe("Quality (default: auto)."),
  user: z.string().optional()
    .describe("Optional user ID."),
  tool_result: toolResultEnum.default("resource_link").optional()
    .describe("Controls content[] shape: 'resource_link' (default) emits ResourceLink items, 'image' emits base64 ImageContent blocks."),
});

export const openaiImagesEditSchema = openaiImagesEditBaseSchema.extend({
  response_format: responseFormatEnum.default("url")
    .describe("Response format: url (file/URL-based) or b64_json (inline base64). Default: url."),
  file: z.string().optional()
    .refine((val) => !val || isAbsolutePath(val), { message: "file must be an absolute path if provided" })
    .describe("Base path for output files."),
});

// fetch-images schema
export const fetchImagesSchema = z.object({
  images: z.array(z.string()).min(1).max(20)
    .describe("Array of image URLs or local file paths (1-20)."),
  compression: compressionSchema,
  response_format: responseFormatEnum.default("url")
    .describe("Response format for fetched images: url (file/URL-based) or b64_json (inline base64). Default: url."),
  file: z.string().optional()
    .refine((val) => !val || isAbsolutePath(val), { message: "file must be an absolute path if provided" })
    .describe("Base path for output files. If multiple images, index suffix is added."),
  tool_result: toolResultEnum.default("resource_link").optional()
    .describe("Controls content[] shape: 'resource_link' (default) emits ResourceLink items, 'image' emits base64 ImageContent blocks."),
});

// Client-facing fetch-images schema (sources + optional n)
// This mirrors the MCP tool input shape used by src/index.ts for the
// "fetch-images" tool and is intended for use in client integrations and
// tests. The mutual exclusivity between `sources` and `n` is enforced in the
// handler, not in this schema.
export const fetchImagesClientSchema = z.object({
  sources: z.array(z.string()).min(1).max(20).optional()
    .describe("Array of image sources: HTTP(S) URLs or file paths (absolute or relative to the first MEDIA_GEN_DIRS entry). Max 20 images. Mutually exclusive with 'n'."),
  n: z.number().int().min(1).max(50).optional()
    .describe("When set, returns the last N image files from the primary MEDIA_GEN_DIRS[0] directory (most recently modified first). Mutually exclusive with 'sources'."),
  compression: z.object({
    max_size: z.number().int().min(100).max(4096).optional()
      .describe("Max dimension in pixels. Images larger than this will be resized."),
    max_bytes: z.number().int().min(10240).max(10485760).optional()
      .describe("Target max file size in bytes. Default: 819200 (800KB)."),
    quality: z.number().int().min(1).max(100).optional()
      .describe("JPEG/WebP quality 1-100. Default: 85."),
    format: z.enum(["jpeg", "png", "webp"]).optional()
      .describe("Output format. Default: jpeg (best compression)."),
  }).optional().describe("Compression options. If omitted, no compression is applied."),
  response_format: responseFormatEnum.default("url")
    .describe("Controls structuredContent shape: 'url' (default) emits data[].url, 'b64_json' emits data[].b64_json."),
  file: z.string().optional()
    .refine((val) => !val || isAbsolutePath(val), { message: "file must be an absolute path if provided" })
    .describe("Base path for output files, absolute or relative to the first MEDIA_GEN_DIRS entry. If multiple images, index suffix is added."),
  tool_result: toolResultEnum.default("resource_link").optional()
    .describe("Controls content[] shape: 'resource_link' (default) emits ResourceLink items, 'image' emits base64 ImageContent blocks."),
});

// test-tool schema
export const testToolSchema = z.object({
  tool_result: toolResultEnum.default("resource_link").optional()
    .describe("Controls content[] shape: 'resource_link' (default) emits ResourceLink items, 'image' emits base64 ImageContent blocks."),
  response_format: responseFormatEnum.default("url")
    .describe("Controls structuredContent shape: 'url' (default) emits data[].url, 'b64_json' emits data[].b64_json."),
  compression: compressionSchema,
});

// Type exports for handler args
// Note: tools are named openai-images-generate and openai-images-edit
export type OpenAIImagesGenerateArgs = z.input<typeof openaiImagesGenerateSchema>;
export type OpenAIImagesEditArgs = z.input<typeof openaiImagesEditSchema>;
export type FetchImagesArgs = z.input<typeof fetchImagesSchema>;
export type FetchImagesClientArgs = z.input<typeof fetchImagesClientSchema>;
export type TestToolArgs = z.input<typeof testToolSchema>;
