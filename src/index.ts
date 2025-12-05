// Media Gen MCP — MCP server for image generation via OpenAI gpt-image-1
// https://github.com/strato-space/media-gen-mcp
// Copyright (c) 2025 Strato Space Ltd.
// Author: Valery Pavlovich <vp@strato.space> (https://github.com/iqdoctor)
// License: MIT (see LICENSE in repository root)
// SPDX-License-Identifier: MIT

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import https from "node:https";
import http from "node:http";

import dotenv from "dotenv";
import { z } from "zod";

import {
  type ImageData,
  type CompressionOptions,
  fetchAndProcessImage,
  readAndProcessImage,
} from "./lib/compression.js";
import {
  parseEnvList,
  getDefaultRootDir,
  normalizeDirectories,
  createAllowedDirContext,
  createUrlPrefixChecker,
  mapFileToPublicUrl,
} from "./lib/env.js";
import { log } from "./lib/logger.js";
import { testToolSchema, type TestToolArgs } from "./lib/schemas.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { TextContent, ImageContent, ResourceLink, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OpenAI, AzureOpenAI, toFile } from "openai";

// Optional sharp import for image compression
// Falls back to no-op if sharp is not available (e.g., in environments without native modules)

// Load environment variables
const envFileIndex = process.argv.indexOf("--env-file");
if (envFileIndex !== -1) {
  const envPath = process.argv[envFileIndex + 1];
  if (typeof envPath === "string") {
    dotenv.config({ path: envPath, override: false });
  } else {
    dotenv.config({ override: false });
  }
} else {
  dotenv.config();
}

const configLog = log.child("config");

const configuredDirEntries = parseEnvList(process.env["MEDIA_GEN_DIRS"]);
const baseDirEntries = configuredDirEntries.length > 0 ? configuredDirEntries : [getDefaultRootDir()];
const normalizedBaseDirs = normalizeDirectories(baseDirEntries, "MEDIA_GEN_DIRS");
const extraDirEntries = [
  process.env["MEDIA_GEN_MCP_TEST_SAMPLE_DIR"],
].filter((dir): dir is string => !!dir);
const normalizedExtraDirs = normalizeDirectories(extraDirEntries, "MEDIA_GEN_MCP_TEST_SAMPLE_DIR");
const publicUrlPrefixes = parseEnvList(process.env["MEDIA_GEN_MCP_URL_PREFIXES"]);

// If MEDIA_GEN_DIRS is explicitly configured, require all non-glob roots to exist
if (configuredDirEntries.length > 0) {
  ensureDirectoriesExist(configuredDirEntries, normalizedBaseDirs, "MEDIA_GEN_DIRS");
}

// If test sample dir is configured, also require it to exist
if (extraDirEntries.length > 0) {
  ensureDirectoriesExist(extraDirEntries, normalizedExtraDirs, "MEDIA_GEN_MCP_TEST_SAMPLE_DIR");
}

const { primaryOutputDir, isPathInAllowedDirs } = createAllowedDirContext(
  normalizedBaseDirs,
  normalizedExtraDirs,
);

const allowedUrlPrefixes = parseEnvList(process.env["MEDIA_GEN_URLS"]);
const urlPrefixChecker = createUrlPrefixChecker(allowedUrlPrefixes);
const isUrlAllowedByEnv = (url: string): boolean => isHttpUrl(url) && urlPrefixChecker(url);

// Helper: check if string is an HTTP(S) URL
function isHttpUrl(val: string): boolean {
  return val.startsWith("http://") || val.startsWith("https://");
}

function maskSecret(value: string | undefined): string {
  if (!value) return "<unset>";
  if (value.length <= 8) return `${value[0] ?? "*"}...${value[value.length - 1] ?? "*"}`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function ensureDirectoriesExist(rawDirs: string[], normalizedDirs: string[], label: string): void {
  for (let i = 0; i < rawDirs.length; i++) {
    const raw = rawDirs[i]!;
    if (raw.includes("*")) continue;
    const full = normalizedDirs[i]!;
    if (!fs.existsSync(full)) {
      throw new Error(`${label} entry does not exist: ${full}`);
    }
  }
}

function logResolvedEnv(): void {
  configLog.debug("resolved environment", {
    MEDIA_GEN_DIRS_raw: process.env["MEDIA_GEN_DIRS"] ?? "<unset>",
    MEDIA_GEN_DIRS_resolved: normalizedBaseDirs,
    MEDIA_GEN_URLS: allowedUrlPrefixes.length ? allowedUrlPrefixes : "<allow-all>",
    MEDIA_GEN_MCP_URL_PREFIXES_raw: process.env["MEDIA_GEN_MCP_URL_PREFIXES"] ?? "<unset>",
    MEDIA_GEN_MCP_URL_PREFIXES_resolved: publicUrlPrefixes,
    MEDIA_GEN_MCP_TEST_SAMPLE_DIR: process.env["MEDIA_GEN_MCP_TEST_SAMPLE_DIR"] ?? "<unset>",
    OPENAI_API_KEY: maskSecret(process.env["OPENAI_API_KEY"]),
    AZURE_OPENAI_API_KEY: maskSecret(process.env["AZURE_OPENAI_API_KEY"]),
  });
}

logResolvedEnv();

if (process.env["MEDIA_GEN_MCP_DEBUG"] === "true") {
  configLog.info("DEBUG MODE ENABLED — media-gen-mcp starting", {
    cwd: process.cwd(),
    nodeVersion: process.version,
    pid: process.pid,
    primaryOutputDir,
    normalizedBaseDirs,
    normalizedExtraDirs,
    allowedUrlPrefixes,
    timestamp: new Date().toISOString(),
  });
}

// Helper: fetch image from URL and return as base64 data URL
async function fetchImageAsBase64(url: string, maxRedirects = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error("Too many redirects"));
      return;
    }
    const protocol = url.startsWith("https://") ? https : http;
    const req = protocol.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Follow redirect with decrement
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          fetchImageAsBase64(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
          return;
        }
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch image: HTTP ${res.statusCode}`));
        return;
      }
      const contentType = res.headers["content-type"] || "image/png";
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const base64 = buffer.toString("base64");
        resolve(`data:${contentType};base64,${base64}`);
      });
      res.on("error", reject);
    }).on("error", reject);
    // Timeout after 30 seconds
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error(`Timeout fetching image from ${url}`));
    });
  });
}

// Helper: check if directory exists and is writable (creates when missing)
async function ensureDirectoryWritable(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  if (!isPathInAllowedDirs(dir)) {
    throw new Error(`Directory is outside allowed MEDIA_GEN_DIRS roots: ${dir}`);
  }
  try {
    const stat = await fs.promises.stat(dir);
    if (!stat.isDirectory()) {
      throw new Error(`Path exists but is not a directory: ${dir}`);
    }
    await fs.promises.access(dir, fs.constants.W_OK);
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.access(dir, fs.constants.W_OK);
      return;
    }
    if (error.code === "EACCES") {
      throw new Error(`Directory is not writable: ${dir}`);
    }
    throw err;
  }
}

// Helper: validate output directory (file path or fallback)
async function validateOutputDirectory(file: string | undefined): Promise<void> {
  if (file) {
    const resolvedFile = resolvePathInPrimaryRoot(file);
    if (!isPathInAllowedDirs(resolvedFile)) {
      throw new Error("Output path is outside allowed MEDIA_GEN_DIRS roots");
    }
    await ensureDirectoryWritable(resolvedFile);
  } else {
    await ensureDirectoryWritable(path.join(primaryOutputDir, "test"));
  }
}

// Helper: get OpenAI client (Azure or standard)
function getOpenAIClient(): OpenAI | AzureOpenAI {
  return process.env["AZURE_OPENAI_API_KEY"] ? new AzureOpenAI() : new OpenAI();
}

// Shared path validation
function isAbsolutePath(val: string | undefined): boolean {
  if (!val) return true;
  if (val.startsWith("/")) return true;
  if (/^[a-zA-Z]:[/\\]/.test(val)) return true;
  return false;
}

// Shared base64 validation
function isBase64Image(val: string | undefined): boolean {
  return !!val && (/^([A-Za-z0-9+/=\r\n]+)$/.test(val) || val.startsWith("data:image/"));
}

// Resolve a possibly relative path against the primary output directory
function resolvePathInPrimaryRoot(filePath: string): string {
  if (isAbsolutePath(filePath)) return filePath;
  return path.resolve(primaryOutputDir, filePath);
}

// Shared tool annotations
const imageToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

// Shared types for image processing result (ImageData imported from compression.ts)
interface ProcessedImagesResult {
  files: string[];
  urls: string[];
  resourceLinks: ResourceLink[];
}

// Shape of image data items returned by OpenAI Images API
type ImageApiDataItem = {
  b64_json?: string | null;
  revised_prompt?: string | null;
};

// Minimal view of OpenAI Images API response that we care about
type ImageGenerateResult = {
  data?: ImageApiDataItem[];
  output_format?: string | null;
};

// Helper: extract revised prompts from OpenAI API response
function extractRevisedPrompts(data: ImageApiDataItem[]): TextContent[] {
  return data
    .map((img) =>
      img.revised_prompt
        ? ({ type: "text" as const, text: String(img.revised_prompt) } satisfies TextContent)
        : null,
    )
    .filter((item): item is TextContent => item !== null);
}

// Supported image formats
type ImageFormat = "png" | "webp" | "jpeg";

// Compression and image IO helpers are implemented in src/compression.ts

// Parameters for OpenAI images.generate used in this project
type ImageGenerateParams = {
  prompt: string;
  model: string;
  background?: "transparent" | "opaque" | "auto";
  moderation?: "auto" | "low";
  n?: number;
  output_compression?: number;
  output_format?: "png" | "jpeg" | "webp";
  quality?: "auto" | "high" | "medium" | "low";
  size?: "1024x1024" | "1536x1024" | "1024x1536" | "auto";
  user?: string;
};

// Helper: parse OpenAI API response into ImageData array
function parseImageResponse(data: ImageApiDataItem[], format: ImageFormat): ImageData[] {
  return data
    .filter((img) => typeof img.b64_json === "string" && img.b64_json.length > 0)
    .map((img) => ({
      b64: img.b64_json as string,
      mimeType: `image/${format}`,
      ext: format,
    }));
}

// Helper: determine effective output mode and file path
// responseFormat: "url" -> file/URL-based output, "b64_json" -> inline base64
function resolveOutputPath(
  images: ImageData[],
  responseFormat: "url" | "b64_json",
  file: string | undefined,
  toolPrefix: string,
): { effectiveOutput: string; effectiveFileOutput: string } {
  const maxResponseSizeEnv = process.env["MCP_MAX_CONTENT_BYTES"];
  const MAX_RESPONSE_SIZE = maxResponseSizeEnv && !Number.isNaN(parseInt(maxResponseSizeEnv, 10))
    ? parseInt(maxResponseSizeEnv, 10)
    : 52428800; // default 50MB
  const totalBase64Size = images.reduce((sum, img) => sum + Buffer.byteLength(img.b64, "base64"), 0);

  const wantsBase64 = responseFormat === "b64_json";

  // Normalize effective output to "base64" or "file" only. response_format
  // controls the requested shape; effectiveOutput reflects auto-switching when
  // payload size limits are exceeded.
  let effectiveOutput: string = wantsBase64 ? "base64" : "file";
  let effectiveFileOutput = file ? resolvePathInPrimaryRoot(file) : undefined;

  // Auto-switch to file if total base64 size exceeds the configured limit
  if (wantsBase64 && totalBase64Size > MAX_RESPONSE_SIZE) {
    effectiveOutput = "file";
  }

  // Always generate a file path (we write files even for base64 output)
  if (!effectiveFileOutput) {
    const unique = crypto.randomUUID();
    const timestamp = Date.now();
    const fallbackExt = images[0]?.ext ?? "png";
    effectiveFileOutput = path.join(primaryOutputDir, `${toolPrefix}_${timestamp}_${unique}.${fallbackExt}`);
  }

  if (!isPathInAllowedDirs(effectiveFileOutput)) {
    throw new Error("Output file path is outside allowed MEDIA_GEN_DIRS roots");
  }

  return { effectiveOutput, effectiveFileOutput };
}

// Helper: build error result for tool handlers
function buildErrorResult(err: unknown, toolName: string): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  log.child(toolName).error(message, { stack: err instanceof Error ? err.stack : undefined });
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

// Helper: build public URL for a file path using MEDIA_GEN_MCP_URL_PREFIXES
// matched positionally against MEDIA_GEN_DIRS. Returns undefined when no
// matching prefix is configured.
function buildPublicUrlForFile(filePath: string): string | undefined {
  return mapFileToPublicUrl(filePath, normalizedBaseDirs, publicUrlPrefixes);
}

// Helper: write images to disk and build resource links + URLs
async function writeImagesAndBuildLinks(
  images: ImageData[],
  basePath: string,
): Promise<ProcessedImagesResult> {
  const files: string[] = [];
  const resourceLinks: ResourceLink[] = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (!img) continue;
    const parsed = path.parse(basePath);
    const ext = parsed.ext || `.${img.ext}`;
    const filePath = images.length > 1
      ? path.join(parsed.dir, `${parsed.name}_${i + 1}${ext}`)
      : path.join(parsed.dir, `${parsed.name}${ext}`);

    await fs.promises.writeFile(filePath, Buffer.from(img.b64, "base64"));

    const uri = `file://${filePath}`;
    files.push(uri);
    resourceLinks.push({
      type: "resource_link",
      uri,
      name: path.basename(filePath),
      mimeType: img.mimeType,
    });
  }

  const urls: string[] = [];
  for (const fileUri of files) {
    const filePath = fileUri.startsWith("file://")
      ? fileUri.slice("file://".length)
      : fileUri;
    const httpUrl = buildPublicUrlForFile(filePath);
    urls.push(httpUrl ?? "");
  }

  return { files, urls, resourceLinks };
}

// MCP content types union (per MCP 2025-11-25 spec)
type ContentBlock = TextContent | ImageContent | ResourceLink;

// Types for new parameter system:
// tool_result: controls content[] shape (resource_link vs image)
// response_format: controls structuredContent shape (url vs b64_json)
type ToolResultType = "resource_link" | "image";
type ResponseFormatType = "url" | "b64_json";

// Raw OpenAI API response shape (for "api" placement mode)
interface OpenAIImageApiResponse {
  created: number;
  data: Array<{
    b64_json?: string;
    url?: string;
    revised_prompt?: string;
  }>;
  // usage can be undefined when not returned by API
  usage?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: {
      text_tokens?: number;
      image_tokens?: number;
    };
  } | undefined;
  // Additional fields from gpt-image-1 (all can be undefined when not provided)
  background?: string | undefined;
  output_format?: string | undefined;
  size?: string | undefined;
  quality?: string | undefined;
}

// Helper: build MCP tool result for image responses
// New design per MCP 2025-11-25 spec 5.2.6:
// - content[] is built based on tool_result param (resource_link or image)
// - structuredContent always contains OpenAI ImagesResponse format (data[].url or data[].b64_json)
// - A TextContent block with serialized JSON (with URLs) for backward compatibility
function buildImageToolResult(
  images: ImageData[],
  processedResult: ProcessedImagesResult,
  revisedPromptItems: TextContent[],
  toolName: string,
  toolResult: ToolResultType,
  responseFormat: ResponseFormatType,
  rawApiResponse?: OpenAIImageApiResponse,
): CallToolResult {
  const { files, urls, resourceLinks } = processedResult;
  const revisedPromptTexts = revisedPromptItems.map((item) => item.text);

  // 1. Build content[] based on tool_result parameter
  const content: ContentBlock[] = [];

  if (toolResult === "image") {
    // Emit ImageContent blocks with base64
    for (const img of images) {
      if (!img) continue;
      content.push({
        type: "image" as const,
        data: img.b64,
        mimeType: img.mimeType,
      });
    }
  } else {
    // Default: emit ResourceLink items
    // Prefer HTTP URLs if available, fallback to file:// URIs
    const hasHttpUrls = urls.some((u) => !!u);
    if (hasHttpUrls && urls.length === resourceLinks.length) {
      for (let i = 0; i < resourceLinks.length; i++) {
        const link = resourceLinks[i];
        const httpUrl = urls[i];
        if (link && httpUrl) {
          content.push({
            ...link,
            uri: httpUrl,
          });
        }
      }
    } else {
      content.push(...resourceLinks);
    }
  }

  // Add revised prompts as TextContent
  content.push(...revisedPromptItems);

  // 2. Build structuredContent with OpenAI ImagesResponse format
  // data[] contains either url or b64_json based on response_format
  const apiResponse: OpenAIImageApiResponse = rawApiResponse
    ? { ...rawApiResponse }
    : {
        created: Math.floor(Date.now() / 1000),
        data: [],
      };

  const dataItems: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> = [];
  const maxLen = Math.max(images.length, urls.length, files.length, resourceLinks.length);

  for (let i = 0; i < maxLen; i++) {
    const item: { b64_json?: string; url?: string; revised_prompt?: string } = {};

    if (responseFormat === "b64_json") {
      // Put base64 in structuredContent
      const img = images[i];
      if (img) {
        item.b64_json = img.b64;
      }
    } else {
      // Put URL in structuredContent (prefer HTTP URL, fallback to file:// URI)
      const urlVal = urls[i];
      const linkVal = resourceLinks[i];
      const fileVal = files[i];
      if (urlVal) {
        item.url = urlVal;
      } else if (linkVal) {
        item.url = linkVal.uri;
      } else if (fileVal) {
        item.url = fileVal;
      }
    }

    // Add revised_prompt if available
    const revisedPrompt = revisedPromptTexts[i];
    if (revisedPrompt) {
      item.revised_prompt = revisedPrompt;
    }

    if (item.b64_json || item.url) {
      dataItems.push(item);
    }
  }

  apiResponse.data = dataItems;

  // 3. Per MCP spec 5.2.6: add TextContent with serialized JSON for backward compatibility
  // This always uses URLs (never base64) to avoid duplication
  const apiResponseForText: OpenAIImageApiResponse = {
    ...apiResponse,
    data: [],
  };

  // Build data[] with URLs only for the text representation
  for (let i = 0; i < maxLen; i++) {
    const textItem: { url?: string; revised_prompt?: string } = {};
    const urlVal = urls[i];
    const linkVal = resourceLinks[i];
    const fileVal = files[i];
    if (urlVal) {
      textItem.url = urlVal;
    } else if (linkVal) {
      textItem.url = linkVal.uri;
    } else if (fileVal) {
      textItem.url = fileVal;
    }
    const revisedPrompt = revisedPromptTexts[i];
    if (revisedPrompt) {
      textItem.revised_prompt = revisedPrompt;
    }
    if (textItem.url) {
      apiResponseForText.data.push(textItem);
    }
  }

  // Add serialized JSON as TextContent for backward compatibility
  content.push({
    type: "text" as const,
    text: JSON.stringify(apiResponseForText, null, 2),
  });

  log.child(toolName).info("response", {
    images: images.length,
    files: files.length,
    urls: urls.length,
    toolResult,
    responseFormat,
    revisedPrompts: revisedPromptTexts.length,
  });

  return {
    content,
    structuredContent: apiResponse as unknown as Record<string, unknown>,
  } as CallToolResult;
}

(async () => {
  const server = new McpServer({
    name: "media-gen-mcp",
    version: "1.0.0"
  }, {
    capabilities: {
      tools: { listChanged: false }
    }
  });

  // Zod schema for openai-images-generate tool input
  const openaiImagesGenerateBaseSchema = z.object({
    prompt: z.string().max(32000),
    background: z.enum(["transparent", "opaque", "auto"]).optional(),
    model: z.literal("gpt-image-1").default("gpt-image-1"),
    moderation: z.enum(["auto", "low"]).optional(),
    n: z.number().int().min(1).max(10).optional(),
    output_compression: z.number().int().min(0).max(100).optional(),
    output_format: z.enum(["png", "jpeg", "webp"]).optional(),
    quality: z.enum(["auto", "high", "medium", "low"]).default("low"),
    size: z.enum(["1024x1024", "1536x1024", "1024x1536", "auto"]).default("1024x1024"),
    user: z.string().optional(),
    tool_result: z.enum(["resource_link", "image"]).default("resource_link")
      .describe("Controls content[] shape: 'resource_link' (default) emits ResourceLink items, 'image' emits base64 ImageContent blocks."),
    response_format: z.enum(["url", "b64_json"]).default("url")
      .describe("Controls structuredContent shape: 'url' (default) emits data[].url, 'b64_json' emits data[].b64_json."),
    file: z.string().optional()
      .describe("Path to save the image file, absolute or relative to the first MEDIA_GEN_DIRS entry (or the default root). If multiple images are generated (n > 1), an index will be appended (e.g., /path/to/image_1.png)."),
  });

  // Full schema with refinement for validation inside the handler
  const openaiImagesGenerateSchema = openaiImagesGenerateBaseSchema;

  type OpenAIImagesGenerateToolArgs = z.input<typeof openaiImagesGenerateBaseSchema>;

  server.registerTool(
    "openai-images-generate",
    {
      title: "OpenAI Images Generate",
      description: "Generate images from text prompts using OpenAI gpt-image-1. Returns MCP CallToolResult with content[] (ResourceLink or ImageContent based on tool_result param) and structuredContent (OpenAI ImagesResponse format with data[].url or data[].b64_json based on response_format param).",
      inputSchema: openaiImagesGenerateBaseSchema.shape,
      annotations: imageToolAnnotations,
    },
    async (args: OpenAIImagesGenerateToolArgs, _extra: unknown) => {
      try {
        const openai = getOpenAIClient();
        const {
          prompt,
          background,
          model = "gpt-image-1",
          moderation,
          n,
          output_compression,
          output_format,
          quality,
          size,
          user,
          tool_result = "resource_link",
          response_format = "url",
          file: fileRaw,
        } = openaiImagesGenerateSchema.parse(args);
        const file: string | undefined = fileRaw;

        await validateOutputDirectory(file);

        // Enforce: if background is 'transparent', output_format must be 'png' or 'webp'
        if (background === "transparent" && output_format && !["png", "webp"].includes(output_format)) {
          throw new Error("If background is 'transparent', output_format must be 'png' or 'webp'");
        }

        // Only include output_compression if output_format is webp or jpeg
        const imageParams: ImageGenerateParams = {
          prompt,
          model,
          ...(background ? { background } : {}),
          ...(moderation ? { moderation } : {}),
          ...(n ? { n } : {}),
          ...(output_format ? { output_format } : {}),
          ...(quality ? { quality } : {}),
          ...(size ? { size } : {}),
          ...(user ? { user } : {}),
        };
        if (
          typeof output_compression !== "undefined" &&
          output_format &&
          ["webp", "jpeg"].includes(output_format)
        ) {
          imageParams.output_compression = output_compression;
        }

        const result = await openai.images.generate(imageParams);

        // Determine effective output format based on API response (preferred) or request/default.
        // According to the OpenAI spec, output_format is one of: png, webp, jpeg.
        const rawResult = result as unknown as ImageGenerateResult;
        const rawFormat = (rawResult.output_format ?? output_format) ?? "png";
        const effectiveFormat: ImageFormat =
          rawFormat === "png" || rawFormat === "webp" || rawFormat === "jpeg"
            ? rawFormat
            : "png";

        const generateData = (result.data ?? []) as ImageApiDataItem[];
        const images = parseImageResponse(generateData, effectiveFormat);

        const revisedPromptItems = extractRevisedPrompts(generateData);
        const { effectiveFileOutput } = resolveOutputPath(images, response_format, file, "openai_image");

        const processedResult = await writeImagesAndBuildLinks(images, effectiveFileOutput);

        // Build raw API response for "api" placement mode
        const rawApiResponseData: OpenAIImageApiResponse["data"] = generateData.map((item) => {
          const dataItem: { b64_json?: string; url?: string; revised_prompt?: string } = {};
          if (item.b64_json) dataItem.b64_json = item.b64_json;
          if (item.revised_prompt) dataItem.revised_prompt = item.revised_prompt;
          return dataItem;
        });
        const rawApiResponse: OpenAIImageApiResponse = {
          created: (result as unknown as { created?: number }).created ?? Math.floor(Date.now() / 1000),
          data: rawApiResponseData,
          usage: (result as unknown as { usage?: OpenAIImageApiResponse["usage"] }).usage,
          background: background,
          output_format: effectiveFormat,
          size: size,
          quality: quality,
        };

        return buildImageToolResult(
          images,
          processedResult,
          revisedPromptItems,
          "openai-images-generate",
          tool_result,
          response_format,
          rawApiResponse,
        );
      } catch (err) {
        return buildErrorResult(err, "openai-images-generate");
      }
    }
  );

  // Zod schema for openai-images-edit tool input (gpt-image-1 only)
  const imageInputCheck = (val: string) =>
    isHttpUrl(val) || isBase64Image(val) || val.trim().length > 0;
  const imageInputSchema = z.string().refine(
    imageInputCheck,
    { message: "Must be a non-empty string: HTTP(S) URL, base64-encoded image, or file path (absolute or relative)" }
  ).describe("Image source: HTTP(S) URL, base64-encoded image string, or file path (absolute or relative to the first MEDIA_GEN_DIRS entry).");
  const imageFieldSchema = z.union([
    imageInputSchema,
    z.array(imageInputSchema).min(1).max(16),
  ]);

  // Base schema without refinement for server.tool signature
  const openaiImagesEditBaseSchema = z.object({
    image: imageFieldSchema.describe(
      "Absolute image path, base64 string, or HTTP(S) URL to edit, or an array of such values (1-16 images).",
    ),
    prompt: z.string().max(32000).describe("A text description of the desired edit. Max 32000 chars."),
    mask: z.string().optional().describe("Optional absolute path, base64 string, or HTTP(S) URL for a mask image (png < 4MB, same dimensions as the first image). Fully transparent areas indicate where to edit."),
    model: z.literal("gpt-image-1").default("gpt-image-1"),
    n: z.number().int().min(1).max(10).optional().describe("Number of images to generate (1-10)."),
    quality: z.enum(["auto", "high", "medium", "low"]).default("low").describe("Quality (high, medium, low) - only for gpt-image-1. Default: low."),
    size: z.enum(["1024x1024", "1536x1024", "1024x1536", "auto"]).default("1024x1024").describe("Size of the generated images. Default: 1024x1024."),
    user: z.string().optional().describe("Optional user identifier for OpenAI monitoring."),
    tool_result: z.enum(["resource_link", "image"]).default("resource_link")
      .describe("Controls content[] shape: 'resource_link' (default) emits ResourceLink items, 'image' emits base64 ImageContent blocks."),
    response_format: z.enum(["url", "b64_json"]).default("url")
      .describe("Controls structuredContent shape: 'url' (default) emits data[].url, 'b64_json' emits data[].b64_json."),
    file: z.string().optional()
      .describe("Path to save the output image file, absolute or relative to the first MEDIA_GEN_DIRS entry. If n > 1, an index is appended."),
  });

  // Full schema with refinement for validation inside the handler
  const openaiImagesEditSchema = openaiImagesEditBaseSchema;

  type OpenAIImagesEditToolArgs = z.input<typeof openaiImagesEditBaseSchema>;

  // Edit Image Tool (gpt-image-1 only)
  server.registerTool(
    "openai-images-edit",
    {
      title: "OpenAI Images Edit",
      description: "Edit images (inpainting, outpainting, compositing) from 1 to 16 inputs using OpenAI gpt-image-1. Returns MCP CallToolResult with content[] (ResourceLink or ImageContent based on tool_result param) and structuredContent (OpenAI ImagesResponse format with data[].url or data[].b64_json based on response_format param).",
      inputSchema: openaiImagesEditBaseSchema.shape,
      annotations: imageToolAnnotations,
    },
    async (args: OpenAIImagesEditToolArgs, _extra: unknown) => {
      try {
        log.child("openai-images-edit").debug("raw args", { args });
        const validatedArgs = openaiImagesEditSchema.parse(args);

        const rawImageInputs = Array.isArray(validatedArgs.image)
          ? validatedArgs.image
          : [validatedArgs.image];

        // Fetch HTTP(S) URLs and convert to base64 data URLs
        const imageInputs: string[] = [];
        for (const input of rawImageInputs) {
          if (isHttpUrl(input)) {
            if (!isUrlAllowedByEnv(input)) {
              throw new Error("Image URL is not allowed by MEDIA_GEN_URLS");
            }
            log.child("openai-images-edit").debug("fetching image from URL", { url: input });
            const base64DataUrl = await fetchImageAsBase64(input);
            imageInputs.push(base64DataUrl);
          } else {
            imageInputs.push(input);
          }
        }

        // Fetch mask URL if provided
        let maskInput = validatedArgs.mask;
        if (maskInput && isHttpUrl(maskInput)) {
          if (!isUrlAllowedByEnv(maskInput)) {
            throw new Error("Mask URL is not allowed by MEDIA_GEN_URLS");
          }
          log.child("openai-images-edit").debug("fetching mask from URL", { url: maskInput });
          maskInput = await fetchImageAsBase64(maskInput);
        }

        // Validate inputs after URL fetch (HTTP(S) URLs already converted to base64 above)
        const isValidInput = (input: string) => isBase64Image(input) || input.trim().length > 0;
        if (imageInputs.some((input) => !isValidInput(input))) {
          throw new Error("Invalid 'image' input: Must be a non-empty file path or a base64-encoded string.");
        }
        if (maskInput && !isValidInput(maskInput)) {
          throw new Error("Invalid 'mask' input: Must be a non-empty file path or a base64-encoded string.");
        }

        const openai = getOpenAIClient();
        const { prompt, model = "gpt-image-1", n, quality, size, user, tool_result = "resource_link", response_format = "url", file: fileRaw } = validatedArgs;
        const file: string | undefined = fileRaw;

        await validateOutputDirectory(file);

        // Helper to convert input (path or base64) to toFile
        async function inputToFile(input: string, idx = 0) {
          if (!isBase64Image(input)) {
            const resolved = resolvePathInPrimaryRoot(input);
            if (!isPathInAllowedDirs(resolved)) {
              throw new Error("Image path is outside allowed MEDIA_GEN_DIRS roots");
            }
            // File path: infer mime type from extension
            const ext = resolved.split('.').pop()?.toLowerCase();
            let mime = "image/png";
            if (ext === "jpg" || ext === "jpeg") mime = "image/jpeg";
            else if (ext === "webp") mime = "image/webp";
            else if (ext === "png") mime = "image/png";
            // else default to png
            return await toFile(fs.createReadStream(resolved), undefined, { type: mime });
          } else {
            // Base64 or data URL
            let base64 = input;
            let mime = "image/png";
            if (input.startsWith("data:image/")) {
              // data URL
              const match = input.match(/^data:(image\/\w+);base64,(.*)$/);
              if (match && match.length >= 3) {
                const mimeGroup = match[1];
                const base64Group = match[2];
                if (mimeGroup && base64Group) {
                  mime = mimeGroup;
                  base64 = base64Group;
                }
              }
            }
            const buffer = Buffer.from(base64, "base64");
            const [, subtype = "png"] = mime.split("/");
            return await toFile(buffer, `input_${idx}.${subtype}`, { type: mime });
          }
        }

        // Prepare image input(s)
        const imageFiles = await Promise.all(
          imageInputs.map((input, idx) => inputToFile(input, idx)),
        );

        // Prepare mask input
        const maskFile = maskInput ? await inputToFile(maskInput, 1) : undefined;

        if (imageFiles.length === 0) {
          throw new Error("No images provided for openai-images-edit");
        }

        const imageParam = imageFiles.length === 1 ? imageFiles[0]! : imageFiles;

        // Construct parameters for OpenAI API
        const editParams: Parameters<typeof openai.images.edit>[0] = {
          image: imageParam,
          prompt,
          model, // Always gpt-image-1
          ...(maskFile ? { mask: maskFile } : {}),
          ...(n ? { n } : {}),
          ...(quality ? { quality } : {}),
          ...(size ? { size } : {}),
          ...(user ? { user } : {}),
          stream: false as const,
          // response_format is not applicable for gpt-image-1 (always b64_json)
        };

        const result = await openai.images.edit(editParams);

        const editResult = result as unknown as ImageGenerateResult;
        const editData = (editResult.data ?? []) as ImageApiDataItem[];

        // gpt-image-1 edit always returns png
        const images = parseImageResponse(editData, "png");

        const revisedPromptItems = extractRevisedPrompts(editData);
        const { effectiveFileOutput } = resolveOutputPath(images, response_format, file, "openai_image_edit");

        const processedResult = await writeImagesAndBuildLinks(images, effectiveFileOutput);

        // Build raw API response for "api" placement mode
        const editApiResponseData: OpenAIImageApiResponse["data"] = editData.map((item) => {
          const dataItem: { b64_json?: string; url?: string; revised_prompt?: string } = {};
          if (item.b64_json) dataItem.b64_json = item.b64_json;
          if (item.revised_prompt) dataItem.revised_prompt = item.revised_prompt;
          return dataItem;
        });
        const rawApiResponse: OpenAIImageApiResponse = {
          created: (result as unknown as { created?: number }).created ?? Math.floor(Date.now() / 1000),
          data: editApiResponseData,
          usage: (result as unknown as { usage?: OpenAIImageApiResponse["usage"] }).usage,
          output_format: "png",
          size: size,
          quality: quality,
        };

        return buildImageToolResult(images, processedResult, revisedPromptItems, "openai-images-edit", tool_result, response_format, rawApiResponse);
      } catch (err) {
        return buildErrorResult(err, "openai-images-edit");
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // fetch-images: Fetch and process images from URLs or local files
  // ═══════════════════════════════════════════════════════════════════════════

  const fetchImagesSchema = z.object({
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
    tool_result: z.enum(["resource_link", "image"]).default("resource_link")
      .describe("Controls content[] shape: 'resource_link' (default) emits ResourceLink items, 'image' emits base64 ImageContent blocks."),
    response_format: z.enum(["url", "b64_json"]).default("url")
      .describe("Controls structuredContent shape: 'url' (default) emits data[].url, 'b64_json' emits data[].b64_json."),
    file: z.string().optional()
      .describe("Base path for output files, absolute or relative to the first MEDIA_GEN_DIRS entry. If multiple images, index suffix is added."),
  });

  type FetchImagesArgs = z.input<typeof fetchImagesSchema>;

  server.registerTool(
    "fetch-images",
    {
      title: "Fetch Images",
      description: "Fetch and process images from URLs or local file paths. Returns MCP CallToolResult with content[] (ResourceLink or ImageContent based on tool_result param) and structuredContent (OpenAI ImagesResponse format with data[].url or data[].b64_json based on response_format param).",
      inputSchema: fetchImagesSchema.shape,
      annotations: imageToolAnnotations,
    },
    async (args: FetchImagesArgs) => {
      try {
        const { sources, n, compression, tool_result = "resource_link", response_format, file } = fetchImagesSchema.parse(args);

        const hasSources = Array.isArray(sources) && sources.length > 0;
        if (hasSources && typeof n === "number") {
          throw new Error("'sources' and 'n' are mutually exclusive");
        }

        let activeSources: string[] = [];

        if (typeof n === "number") {
          if (process.env["MEDIA_GEN_MCP_ALLOW_FETCH_LAST_N_IMAGES"] !== "true") {
            throw new Error("Fetching last N images is disabled by MEDIA_GEN_MCP_ALLOW_FETCH_LAST_N_IMAGES");
          }

          const root = primaryOutputDir;
          const entries = await fs.promises.readdir(root, { withFileTypes: true });
          const imageExtensions = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
          const candidates: { path: string; mtimeMs: number }[] = [];

          for (const entry of entries) {
            if (!entry.isFile()) continue;
            if (!imageExtensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) continue;
            const absPath = path.resolve(root, entry.name);
            const stat = await fs.promises.stat(absPath);
            candidates.push({ path: absPath, mtimeMs: stat.mtimeMs });
          }

          candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
          activeSources = candidates.slice(0, n).map((c) => c.path);

          if (activeSources.length === 0) {
            return {
              content: [{ type: "text", text: `No images found in ${root}` }],
              isError: true,
            };
          }
        } else if (hasSources) {
          activeSources = sources;
        } else {
          throw new Error("Either 'sources' or 'n' must be provided");
        }

        let compressionOpts: CompressionOptions | undefined;
        if (compression) {
          compressionOpts = {};
          if (compression.max_size !== undefined) compressionOpts.maxSize = compression.max_size;
          if (compression.max_bytes !== undefined) compressionOpts.maxBytes = compression.max_bytes;
          if (compression.quality !== undefined) compressionOpts.quality = compression.quality;
          if (compression.format !== undefined) compressionOpts.format = compression.format;
        }

        const hasCompression = !!compressionOpts;

        const canReuseAll = !hasCompression && activeSources.every((source) => {
          if (isHttpUrl(source)) {
            return false;
          }
          const resolvedSource = resolvePathInPrimaryRoot(source);
          if (!isPathInAllowedDirs(resolvedSource)) {
            return false;
          }
          const httpUrl = buildPublicUrlForFile(resolvedSource);
          return !!httpUrl;
        });

        if (canReuseAll) {
          const results = await Promise.allSettled(
            activeSources.map(async (source) => {
              const resolvedSource = resolvePathInPrimaryRoot(source);
              if (!isPathInAllowedDirs(resolvedSource)) {
                throw new Error("Image path is outside allowed MEDIA_GEN_DIRS roots");
              }
              const image = await readAndProcessImage(resolvedSource);
              const fileUri = `file://${resolvedSource}`;
              const httpUrl = buildPublicUrlForFile(resolvedSource) ?? "";
              const resourceLink: ResourceLink = {
                type: "resource_link",
                uri: fileUri,
                name: path.basename(resolvedSource),
                mimeType: image.mimeType,
              };
              return { image, fileUri, httpUrl, resourceLink };
            }),
          );

          const images: ImageData[] = [];
          const files: string[] = [];
          const urls: string[] = [];
          const resourceLinks: ResourceLink[] = [];
          const errors: string[] = [];

          results.forEach((result, i) => {
            if (result.status === "fulfilled") {
              images.push(result.value.image);
              files.push(result.value.fileUri);
              urls.push(result.value.httpUrl);
              resourceLinks.push(result.value.resourceLink);
            } else {
              const reason = result.reason;
              const message = reason instanceof Error ? reason.message : String(reason);
              errors.push(`[${i}] ${activeSources[i]}: ${message}`);
            }
          });

          if (images.length === 0) {
            return {
              content: [{ type: "text", text: `All fetches failed:\n${errors.join("\n")}` }],
              isError: true,
            };
          }

          const processedResult: ProcessedImagesResult = { files, urls, resourceLinks };

          const revisedPromptItems: TextContent[] = errors.length > 0
            ? [{ type: "text", text: `Errors (${errors.length}/${activeSources.length}):\n${errors.join("\n")}` }]
            : [];

          log.child("fetch-images").info("reused", { success: images.length, total: activeSources.length });

          return buildImageToolResult(
            images,
            processedResult,
            revisedPromptItems,
            "fetch-images",
            tool_result,
            response_format,
          );
        }

        const results = await Promise.allSettled(
          activeSources.map(async (source): Promise<ImageData> => {
            if (isHttpUrl(source)) {
              if (!isUrlAllowedByEnv(source)) {
                throw new Error("Image URL is not allowed by MEDIA_GEN_URLS");
              }
              return fetchAndProcessImage(source, compressionOpts);
            }

            const resolvedSource = resolvePathInPrimaryRoot(source);
            if (!isPathInAllowedDirs(resolvedSource)) {
              throw new Error("Image path is outside allowed MEDIA_GEN_DIRS roots");
            }
            return readAndProcessImage(resolvedSource, compressionOpts);
          }),
        );

        const images: ImageData[] = [];
        const errors: string[] = [];
        results.forEach((result, i) => {
          if (result.status === "fulfilled") {
            images.push(result.value);
          } else {
            const reason = result.reason;
            const message = reason instanceof Error ? reason.message : String(reason);
            errors.push(`[${i}] ${activeSources[i]}: ${message}`);
          }
        });

        if (images.length === 0) {
          return {
            content: [{ type: "text", text: `All fetches failed:\n${errors.join("\n")}` }],
            isError: true,
          };
        }

        const { effectiveFileOutput } = resolveOutputPath(images, response_format, file, "fetch_images");
        const processedResult = await writeImagesAndBuildLinks(images, effectiveFileOutput);

        const revisedPromptItems: TextContent[] = errors.length > 0
          ? [{ type: "text", text: `Errors (${errors.length}/${activeSources.length}):\n${errors.join("\n")}` }]
          : [];

        log.child("fetch-images").info("processed", { success: images.length, total: activeSources.length });

        return buildImageToolResult(
          images,
          processedResult,
          revisedPromptItems,
          "fetch-images",
          tool_result,
          response_format,
        );
      } catch (err) {
        return buildErrorResult(err, "fetch-images");
      }
    },
  );

  // ---------------------------------------------------------------------------
  // test-tool: Debug MCP result format with predictable sample images
  // ---------------------------------------------------------------------------
  // Enabled only when MEDIA_GEN_MCP_TEST_SAMPLE_DIR is set. Does NOT create new
  // files; instead it enumerates existing sample files and maps them into
  // placements so the MCP client behavior can be inspected.

  const testSampleDir = process.env["MEDIA_GEN_MCP_TEST_SAMPLE_DIR"];

  log.child("test-tool").info("MEDIA_GEN_MCP_TEST_SAMPLE_DIR resolved", {
    isSet: !!testSampleDir,
    testSampleDir,
  });

  if (testSampleDir) {
    log.child("test-tool").info("registering test-tool", { testSampleDir });

    server.registerTool(
      "test-tool",
      {
        title: "Test Tool",
        description: `Debug MCP result format using existing sample files from ${testSampleDir}. Reads up to 10 images and returns MCP CallToolResult with content[] (ResourceLink or ImageContent based on tool_result param) and structuredContent (OpenAI ImagesResponse format with data[].url or data[].b64_json based on response_format param). No new files are created.`,
        inputSchema: testToolSchema.shape,
        annotations: {
          title: "Test Tool",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async (args: TestToolArgs) => {
        try {
          const { tool_result = "resource_link", response_format = "url", compression } = testToolSchema.parse(args);

          // Read sample images (max 10, no sorting — predictable order from fs)
          const entries = await fs.promises.readdir(testSampleDir, { withFileTypes: true });
          const imageExtensions = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
          const imageFiles = entries
            .filter((e) => e.isFile() && imageExtensions.some((ext) => e.name.toLowerCase().endsWith(ext)))
            .slice(0, 10)
            .map((e) => path.resolve(testSampleDir, e.name));

          if (imageFiles.length === 0) {
            return {
              content: [{ type: "text", text: `No sample images found in ${testSampleDir}` }],
              isError: true,
            };
          }

          // Build file:// URIs and resource links for existing sample files
          const files: string[] = imageFiles.map((absPath) => `file://${absPath}`);
          const resourceLinks: ResourceLink[] = imageFiles.map((absPath, idx) => {
            const uri = files[idx]!;
            const ext = path.extname(absPath).toLowerCase();
            let mimeType = "image/png";
            if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
            else if (ext === ".webp") mimeType = "image/webp";
            else if (ext === ".gif") mimeType = "image/gif";
            else if (ext === ".png") mimeType = "image/png";
            return {
              type: "resource_link",
              uri,
              name: path.basename(absPath),
              mimeType,
            };
          });

          // Optional compression options for base64 output
          let compressionOpts: CompressionOptions | undefined;
          if (compression) {
            compressionOpts = compression as CompressionOptions;
          }

          const urls: string[] = [];
          for (const absPath of imageFiles) {
            const httpUrl = buildPublicUrlForFile(absPath);
            urls.push(httpUrl ?? "");
          }

          const processedResult: ProcessedImagesResult = { files, urls, resourceLinks };

          // For b64_json response_format, read sample files into ImageData; for url, images can be empty
          let images: ImageData[] = [];
          if (response_format === "b64_json") {
            images = await Promise.all(
              imageFiles.map((absPath) => readAndProcessImage(absPath, compressionOpts)),
            );
          }

          const revisedPromptItems: TextContent[] = [];

          // Build mock OpenAI API response for "api" placement mode
          // Get file stats to determine created timestamp and size
          const firstFileStat = await fs.promises.stat(imageFiles[0]!);
          const createdTimestamp = Math.floor(firstFileStat.mtime.getTime() / 1000);

          // Determine output_format from first file extension
          const firstExt = path.extname(imageFiles[0]!).toLowerCase().slice(1);
          const outputFormat = firstExt === "jpg" ? "jpeg" : (firstExt || "png");

          const mockApiResponse: OpenAIImageApiResponse = {
            created: createdTimestamp,
            data: [], // Will be filled by buildImageToolResult based on output mode
            background: "opaque",
            output_format: outputFormat,
            size: "1024x1024", // Default size for test
            quality: "high",
          };

          log.child("test-tool").info("enumerated sample images", {
            count: imageFiles.length,
            tool_result,
            response_format,
          });

          return buildImageToolResult(
            images,
            processedResult,
            revisedPromptItems,
            "test-tool",
            tool_result,
            response_format,
            mockApiResponse,
          );
        } catch (err) {
          return buildErrorResult(err, "test-tool");
        }
      },
    );

    log.info("test-tool enabled", { sample: testSampleDir });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
})();