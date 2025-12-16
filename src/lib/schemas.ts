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

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Videos schemas
// ─────────────────────────────────────────────────────────────────────────────

const videoModelEnum = z.enum(["sora-2", "sora-2-pro"]);
export type VideoModelType = z.infer<typeof videoModelEnum>;

const videoSecondsEnum = z.enum(["4", "8", "12"]);
export type VideoSecondsType = z.infer<typeof videoSecondsEnum>;

const videoSizeEnum = z.enum(["720x1280", "1280x720", "1024x1792", "1792x1024"]);
export type VideoSizeType = z.infer<typeof videoSizeEnum>;

const videoVariantEnum = z.enum(["video", "thumbnail", "spritesheet"]);
export type VideoVariantType = z.infer<typeof videoVariantEnum>;

const inputReferenceFitEnum = z.enum(["match", "cover", "contain", "stretch"]);
export type InputReferenceFitType = z.infer<typeof inputReferenceFitEnum>;

const inputReferenceBackgroundEnum = z.enum(["blur", "black", "white"]);
export type InputReferenceBackgroundType = z.infer<typeof inputReferenceBackgroundEnum>;

const hexColorSchema = z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, {
  message: "Expected a hex color like #RRGGBB or #RRGGBBAA",
});

const nonEmptyString = z.string().refine((val) => val.trim().length > 0, { message: "Must be a non-empty string" });
const safeIdSchema = z.string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, {
    message: "Invalid id: only letters, digits, '_' and '-' are allowed",
  });

export const openaiVideosCreateSchema = z.object({
  prompt: z.string().max(32000).describe("Text prompt that describes the video to generate (max 32K chars)."),
  input_reference: nonEmptyString.optional()
    .describe("Optional image reference: HTTP(S) URL, base64 / data URL, or file path."),
  input_reference_fit: inputReferenceFitEnum.default("contain").optional()
    .describe("How to fit input_reference to the requested video size: match (require exact), cover (crop), contain (pad), stretch (distort). Default: contain."),
  input_reference_background: z.union([inputReferenceBackgroundEnum, hexColorSchema]).default("blur").optional()
    .describe("Padding background when input_reference_fit=contain: blur (default), black, white, or hex color (#RRGGBB/#RRGGBBAA)."),
  model: videoModelEnum.default("sora-2").optional()
    .describe("Video model to use (default: sora-2)."),
  seconds: videoSecondsEnum.optional()
    .describe("Clip duration in seconds (default: 4 seconds)."),
  size: videoSizeEnum.optional()
    .describe("Output resolution formatted as width x height (default: 720x1280)."),

  wait_for_completion: z.boolean().default(false).optional()
    .describe("If true, poll the job until completed/failed (then optionally download assets)."),
  timeout_ms: z.number().int().min(1000).max(3600000).default(300000).optional()
    .describe("Max time to wait for completion when wait_for_completion is true (default: 300000)."),
  poll_interval_ms: z.number().int().min(250).max(60000).default(2000).optional()
    .describe("Polling interval when wait_for_completion is true (default: 2000)."),

  download_variants: z.array(videoVariantEnum).min(1).default(["video"]).optional()
    .describe("Which downloadable assets to fetch when completed (default: ['video'])."),
});

export const openaiVideosRemixSchema = z.object({
  video_id: nonEmptyString.describe("Source video job id to remix."),
  prompt: z.string().max(32000).describe("Updated prompt that directs the remix (max 32K chars)."),

  wait_for_completion: z.boolean().default(false).optional()
    .describe("If true, poll the job until completed/failed (then optionally download assets)."),
  timeout_ms: z.number().int().min(1000).max(3600000).default(300000).optional()
    .describe("Max time to wait for completion when wait_for_completion is true (default: 300000)."),
  poll_interval_ms: z.number().int().min(250).max(60000).default(2000).optional()
    .describe("Polling interval when wait_for_completion is true (default: 2000)."),

  download_variants: z.array(videoVariantEnum).min(1).default(["video"]).optional()
    .describe("Which downloadable assets to fetch when completed (default: ['video'])."),
});

export const openaiVideosListSchema = z.object({
  after: nonEmptyString.optional().describe("Cursor (video id) to list after."),
  limit: z.number().int().min(1).max(100).optional().describe("Page size."),
  order: z.enum(["asc", "desc"]).optional()
    .describe("Sort order of results by timestamp."),
});

export const openaiVideosRetrieveSchema = z.object({
  video_id: nonEmptyString.describe("Video job id."),
});

export const openaiVideosDeleteSchema = z.object({
  video_id: nonEmptyString.describe("Video job id to delete."),
});

export const openaiVideosRetrieveContentSchema = z.object({
  video_id: nonEmptyString.describe("Video job id."),
  variant: videoVariantEnum.default("video").optional()
    .describe("Which downloadable asset to return (default: video)."),
});

// ─────────────────────────────────────────────────────────────────────────────
// Google Videos schemas
// ─────────────────────────────────────────────────────────────────────────────

const googleVideoAspectRatioEnum = z.enum(["16:9", "9:16"]);
export type GoogleVideoAspectRatioType = z.infer<typeof googleVideoAspectRatioEnum>;

const googlePersonGenerationEnum = z.enum(["DONT_ALLOW", "ALLOW_ADULT", "ALLOW_ALL"]);
export type GooglePersonGenerationType = z.infer<typeof googlePersonGenerationEnum>;

const imageMimeTypeSchema = z.string().regex(/^image\/[a-zA-Z0-9.+-]+$/, {
  message: "Expected an image MIME type like image/jpeg",
});

export const googleVideosGenerateSchema = z.object({
  prompt: z.string().max(32000).optional()
    .describe("Text prompt that describes the video to generate (max 32K chars). Required unless an input image/video is provided."),
  input_reference: nonEmptyString.optional()
    .describe("Optional image reference (image-to-video): HTTP(S) URL, base64 / data URL, or file path under MEDIA_GEN_DIRS."),
  input_reference_mime_type: imageMimeTypeSchema.optional()
    .describe("Optional override for input image MIME type (e.g. image/jpeg). Useful when input_reference is raw base64 without a data URL header."),
  input_video_reference: nonEmptyString.optional()
    .describe("Optional input video reference (video extension): HTTP(S) URL or file path under MEDIA_GEN_DIRS. Mutually exclusive with input_reference."),

  model: nonEmptyString.default("veo-2.0-generate-001").optional()
    .describe("Google video model id (default: veo-2.0-generate-001)."),

  number_of_videos: z.number().int().min(1).max(4).default(1).optional()
    .describe("Number of videos to generate (default: 1)."),
  aspect_ratio: googleVideoAspectRatioEnum.optional()
    .describe("Aspect ratio for the generated video."),
  duration_seconds: z.number().int().min(1).max(120).optional()
    .describe("Video duration in seconds (provider/model-dependent)."),
  person_generation: googlePersonGenerationEnum.optional()
    .describe("Controls whether people are allowed in the generated video."),

  wait_for_completion: z.boolean().default(false).optional()
    .describe("If true, poll the operation until done (then optionally download)."),
  timeout_ms: z.number().int().min(1000).max(3600000).default(300000).optional()
    .describe("Max time to wait for completion when wait_for_completion is true (default: 300000)."),
  poll_interval_ms: z.number().int().min(1000).max(60000).default(10000).optional()
    .describe("Polling interval when wait_for_completion is true (default: 10000)."),

  download_when_done: z.boolean().optional()
    .describe("When waiting, whether to download generated videos to MEDIA_GEN_DIRS[0]. Defaults to true when wait_for_completion=true, otherwise false."),
}).superRefine((val, ctx) => {
  const hasPrompt = typeof val.prompt === "string" && val.prompt.trim().length > 0;
  const hasImage = typeof val.input_reference === "string" && val.input_reference.trim().length > 0;
  const hasVideo = typeof val.input_video_reference === "string" && val.input_video_reference.trim().length > 0;

  if (!hasPrompt && !hasImage && !hasVideo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide at least one of: prompt, input_reference, input_video_reference",
      path: [],
    });
  }

  if (hasImage && hasVideo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "input_reference and input_video_reference are mutually exclusive",
      path: ["input_video_reference"],
    });
  }
});

export const googleVideosRetrieveOperationSchema = z.object({
  operation_name: nonEmptyString.describe("Google video operation name/id."),
});

export const googleVideosRetrieveContentSchema = z.object({
  operation_name: nonEmptyString.describe("Google video operation name/id."),
  index: z.number().int().min(0).default(0).optional()
    .describe("Which generatedVideos[index] to download (default: 0)."),
});

// openai-images-generate base schema (shared params)
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

// Full openai-images-generate schema with response_format
export const openaiImagesGenerateSchema = openaiImagesGenerateBaseSchema.extend({
  response_format: responseFormatEnum.default("url")
    .describe("Response format: url (file/URL-based) or b64_json (inline base64). Default: url."),
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
  ids: z.array(safeIdSchema).min(1).max(50).optional()
    .describe("Array of image IDs to fetch by filename match (looks for filenames containing _{id}_ or _{id}. under the primary MEDIA_GEN_DIRS[0] directory). Mutually exclusive with 'sources' and 'n'."),
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

// test-images schema
export const testImagesSchema = z.object({
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
export type TestImagesArgs = z.input<typeof testImagesSchema>;

export type OpenAIVideosCreateArgs = z.input<typeof openaiVideosCreateSchema>;
export type OpenAIVideosRemixArgs = z.input<typeof openaiVideosRemixSchema>;
export type OpenAIVideosListArgs = z.input<typeof openaiVideosListSchema>;
export type OpenAIVideosRetrieveArgs = z.input<typeof openaiVideosRetrieveSchema>;
export type OpenAIVideosDeleteArgs = z.input<typeof openaiVideosDeleteSchema>;
export type OpenAIVideosRetrieveContentArgs = z.input<typeof openaiVideosRetrieveContentSchema>;

export type GoogleVideosGenerateArgs = z.input<typeof googleVideosGenerateSchema>;
export type GoogleVideosRetrieveOperationArgs = z.input<typeof googleVideosRetrieveOperationSchema>;
export type GoogleVideosRetrieveContentArgs = z.input<typeof googleVideosRetrieveContentSchema>;
