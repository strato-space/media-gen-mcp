/**
 * Shared helper functions for media-gen-mcp tools.
 * Exported for unit testing.
 */

import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";
import type { ImageData } from "./compression.js";

// Helper: check if string is an HTTP(S) URL
export function isHttpUrl(val: string): boolean {
  return val.startsWith("http://") || val.startsWith("https://");
}

// Shared path validation
export function isAbsolutePath(val: string | undefined): boolean {
  if (!val) return true;
  if (val.startsWith("/")) return true;
  if (/^[a-zA-Z]:[/\\]/.test(val)) return true;
  return false;
}

// Shared base64 validation
export function isBase64Image(val: string | undefined): boolean {
  return !!val && (/^([A-Za-z0-9+/=\r\n]+)$/.test(val) || val.startsWith("data:image/"));
}

// Helper: check if directory exists and is writable
export async function ensureDirectoryWritable(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  try {
    const stat = await fs.promises.stat(dir);
    if (!stat.isDirectory()) {
      throw new Error(`Path exists but is not a directory: ${dir}`);
    }
    await fs.promises.access(dir, fs.constants.W_OK);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`Directory does not exist: ${dir}`);
    }
    if (code === "EACCES") {
      throw new Error(`Directory is not writable: ${dir}`);
    }
    throw err;
  }
}

// Helper: validate output directory (file path or fallback)
export async function validateOutputDirectory(file: string | undefined, outputDir?: string): Promise<void> {
  if (file) {
    await ensureDirectoryWritable(file);
  } else {
    const tmpDir = outputDir || "/tmp";
    await ensureDirectoryWritable(path.join(tmpDir, "test"));
  }
}

// Supported image formats
export type ImageFormat = "png" | "webp" | "jpeg";

// Helper: extract revised prompts from OpenAI API response
export function extractRevisedPrompts(data: Array<{ revised_prompt?: string }>): TextContent[] {
  return data
    .map((img) =>
      img.revised_prompt
        ? ({ type: "text" as const, text: String(img.revised_prompt) } satisfies TextContent)
        : null,
    )
    .filter((item): item is TextContent => item !== null);
}

// Helper: parse OpenAI API response into ImageData array
export function parseImageResponse(
  data: Array<{ b64_json: string }>,
  format: ImageFormat,
): ImageData[] {
  return data.map((img) => ({
    b64: img.b64_json,
    mimeType: `image/${format}`,
    ext: format,
  }));
}

// Helper: determine effective output mode and file path
// responseFormat: "url" -> file/URL-based output, "b64_json" -> inline base64
export function resolveOutputPath(
  images: ImageData[],
  responseFormat: "url" | "b64_json",
  file: string | undefined,
  toolPrefix: string,
  options?: { maxResponseSize?: number; outputDir?: string },
): { effectiveOutput: string; effectiveFileOutput: string } {
  const MAX_RESPONSE_SIZE = options?.maxResponseSize ?? 52428800; // default 50MB
  const totalBase64Size = images.reduce((sum, img) => sum + Buffer.byteLength(img.b64, "base64"), 0);

  const wantsBase64 = responseFormat === "b64_json";

  // Normalize effective output to "base64" or "file" only. response_format
  // controls the requested shape; effectiveOutput reflects auto-switching when
  // payload size limits are exceeded.
  let effectiveOutput: string = wantsBase64 ? "base64" : "file";

  // Auto-switch to file if total base64 size exceeds the configured limit
  if (wantsBase64 && totalBase64Size > MAX_RESPONSE_SIZE) {
    effectiveOutput = "file";
  }

  // Always generate a file path (we write files even for base64 output)
  let effectiveFileOutput = file;
  if (!effectiveFileOutput) {
    const tmpDir = options?.outputDir ?? "/tmp";
    const unique = crypto.randomUUID();
    const timestamp = Date.now();
    const fallbackExt = images[0]?.ext ?? "png";
    effectiveFileOutput = path.join(tmpDir, `${toolPrefix}_${timestamp}_${unique}.${fallbackExt}`);
  }

  return { effectiveOutput, effectiveFileOutput };
}

// tool_result types: controls content[] shape
export type ToolResultType = "resource_link" | "image";

// response_format types: controls structuredContent shape
export type ResponseFormatType = "url" | "b64_json";

// Resource link type (MCP SDK 2025-11-25 spec)
export interface ResourceLinkItem {
  type: "resource_link";
  uri: string;
  name: string;
  mimeType?: string;
}

// Shared processed images result interface
export interface ProcessedImagesResult {
  files: string[];
  urls: string[];
  resourceLinks: ResourceLinkItem[];
}

// Helper: build resource links from files
export function buildResourceLinks(
  files: string[],
  urlPrefix?: string,
): ProcessedImagesResult {
  const urls: string[] = [];
  const resourceLinks: ResourceLinkItem[] = files.map((file) => {
    if (urlPrefix) {
      const url = `${urlPrefix}/${path.basename(file)}`;
      urls.push(url);
    }
    return {
      type: "resource_link" as const,
      uri: `file://${file}`,
      name: path.basename(file),
      mimeType: `image/${path.extname(file).slice(1) || "png"}`,
    };
  });

  return { files, urls, resourceLinks };
}
