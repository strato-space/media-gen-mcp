// Media Gen MCP — MCP server for image generation via OpenAI gpt-image-1.5
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
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { z } from "zod";

import {
  type ImageData,
  type CompressionOptions,
  detectImageFormat,
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
import { applySecretsToEnv, loadSecretsYaml, resolveSecretsFilePath } from "./lib/secrets.js";
import { log } from "./lib/logger.js";
import { estimateSoraVideoCost, estimateGptImageCost } from "./lib/pricing.js";
import {
  testImagesSchema,
  openaiVideosCreateSchema,
  openaiVideosRemixSchema,
  openaiVideosListSchema,
  openaiVideosRetrieveSchema,
  openaiVideosDeleteSchema,
  openaiVideosRetrieveContentSchema,
  googleVideosGenerateSchema,
  googleVideosRetrieveOperationSchema,
  googleVideosRetrieveContentSchema,
  type TestImagesArgs,
  type OpenAIVideosCreateArgs,
  type OpenAIVideosRemixArgs,
  type OpenAIVideosListArgs,
  type OpenAIVideosRetrieveArgs,
  type OpenAIVideosDeleteArgs,
  type OpenAIVideosRetrieveContentArgs,
  type GoogleVideosGenerateArgs,
  type GoogleVideosRetrieveOperationArgs,
  type GoogleVideosRetrieveContentArgs,
} from "./lib/schemas.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { TextContent, ImageContent, ResourceLink, EmbeddedResource, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OpenAI, AzureOpenAI, toFile, type Uploadable } from "openai";
import { GoogleGenAI, GenerateVideosOperation, type Video } from "@google/genai";

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

// Load `secrets.yaml` if present (same structure as fast-agent secrets template).
// Keys in `secrets.yaml` override environment variables.
const resolvedSecretsPath = resolveSecretsFilePath(process.argv, process.cwd());
if (resolvedSecretsPath) {
  try {
    const secrets = loadSecretsYaml(resolvedSecretsPath);
    const applied = applySecretsToEnv(secrets);
    if (applied.length > 0) {
      configLog.info("loaded secrets.yaml", { path: resolvedSecretsPath, applied });
    } else {
      configLog.debug("secrets.yaml found (no env changes)", { path: resolvedSecretsPath });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    configLog.warn("failed to load secrets.yaml", { path: resolvedSecretsPath, error: message });
  }
}

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

// Helper: allow file:// prefixed paths by normalizing them to filesystem paths
function normalizeFilePathInput(filePath: string): string {
  if (!filePath) return filePath;
  const lower = filePath.toLowerCase();
  if (lower.startsWith("file://")) {
    try {
      return fileURLToPath(filePath);
    } catch {
      const withoutScheme = filePath.replace(/^file:\/\//i, "");
      return path.normalize(withoutScheme);
    }
  }
  return filePath;
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
    GEMINI_API_KEY: maskSecret(process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"]),
    GOOGLE_GENAI_USE_VERTEXAI: process.env["GOOGLE_GENAI_USE_VERTEXAI"] ?? "<unset>",
    GOOGLE_CLOUD_PROJECT: process.env["GOOGLE_CLOUD_PROJECT"] ?? "<unset>",
    GOOGLE_CLOUD_LOCATION: process.env["GOOGLE_CLOUD_LOCATION"] ?? "<unset>",
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
          const nextUrl = new URL(redirectUrl, url).toString();
          fetchImageAsBase64(nextUrl, maxRedirects - 1).then(resolve).catch(reject);
          return;
        }
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch image: HTTP ${res.statusCode}`));
        return;
      }
      const rawContentType = res.headers["content-type"];
      const resolvedContentType = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;
      const sanitizedContentType = (resolvedContentType?.split(";")[0]?.trim().toLowerCase() || "").startsWith("image/")
        ? (resolvedContentType?.split(";")[0]?.trim() ?? "image/png")
        : "image/png";
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const base64 = buffer.toString("base64");
        resolve(`data:${sanitizedContentType};base64,${base64}`);
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
  const normalized = normalizeFilePathInput(val);
  if (path.isAbsolute(normalized)) return true;
  if (/^[a-zA-Z]:[/\\]/.test(normalized)) return true;
  return false;
}

// Shared base64 validation
function isBase64Image(val: string | undefined): boolean {
  return !!val && (/^([A-Za-z0-9+/=\r\n]+)$/.test(val) || val.startsWith("data:image/"));
}

function truncateLogString(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...(${value.length} chars)`;
}

const LOG_SANITIZE_IMAGES_FOR_ARGS = (() => {
  const raw = process.env["MEDIA_GEN_MCP_LOG_SANITIZE_IMAGES"];
  if (!raw) return true; // default: sanitize on
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
})();

function summarizeArgsForLog(value: unknown): unknown {
  if (!LOG_SANITIZE_IMAGES_FOR_ARGS) return value;
  if (typeof value === "string") {
    if (isBase64Image(value) && value.length > 512) {
      return truncateLogString(value, 256);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => summarizeArgsForLog(item));
  if (value === null || typeof value !== "object") return value;

  const input = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input)) {
    result[key] = summarizeArgsForLog(val);
  }
  return result;
}

function debugLogRawArgs(toolName: string, args: unknown): void {
  log.child(toolName).debug("raw args", { args: summarizeArgsForLog(args) });
}

// Resolve a possibly relative path against the primary output directory
function resolvePathInPrimaryRoot(filePath: string): string {
  const normalizedPath = normalizeFilePathInput(filePath);
  if (isAbsolutePath(normalizedPath)) return normalizedPath;
  return path.resolve(primaryOutputDir, normalizedPath);
}

// Shared tool annotations
const openaiToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const localToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const safeIdSchema = z.string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, {
    message: "Invalid id: only letters, digits, '_' and '-' are allowed",
  });

function filenameMatchesId(filename: string, id: string): boolean {
  const marker = `_${id}`;
  const idx = filename.indexOf(marker);
  if (idx === -1) return false;
  const after = filename[idx + marker.length];
  return after === "_" || after === "." || typeof after === "undefined";
}

async function resolveFilesByIds(opts: {
  rootDir: string;
  ids: string[];
  allowedExtensions: string[];
}): Promise<{ orderedFiles: string[]; missingIds: string[] }> {
  const entries = await fs.promises.readdir(opts.rootDir, { withFileTypes: true });
  const ids = Array.from(new Set(opts.ids));
  const matchesById = new Map<string, string[]>();
  for (const id of ids) matchesById.set(id, []);

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    const ext = path.extname(name).toLowerCase();
    if (!opts.allowedExtensions.includes(ext)) continue;
    for (const id of ids) {
      if (!filenameMatchesId(name, id)) continue;
      matchesById.get(id)!.push(path.resolve(opts.rootDir, name));
      break;
    }
  }

  const orderedFiles: string[] = [];
  const missingIds: string[] = [];
  for (const id of ids) {
    const files = matchesById.get(id) ?? [];
    files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
    if (files.length === 0) missingIds.push(id);
    orderedFiles.push(...files);
  }

  return { orderedFiles, missingIds };
}

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
function sanitizeForFilename(value: string): string {
  // Keep only broadly safe filename characters.
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function nowTimeTSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function buildDefaultOutputBaseName(opts: { methodName: string; id: string; timestampSeconds?: number | undefined }): string {
  const ts = opts.timestampSeconds ?? nowTimeTSeconds();
  const method = sanitizeForFilename(opts.methodName);
  const id = sanitizeForFilename(opts.id);
  return `output_${ts}_media-gen__${method}_${id}`;
}

function resolveOutputPath(
  images: ImageData[],
  responseFormat: "url" | "b64_json",
  file: string | undefined,
  methodName: string,
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
    const fallbackExt = images[0]?.ext ?? "png";
    const unique = crypto.randomUUID();
    const baseName = buildDefaultOutputBaseName({ methodName, id: unique });
    effectiveFileOutput = path.join(primaryOutputDir, `${baseName}.${fallbackExt}`);
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

// Helper: get a standard OpenAI client for Videos endpoints.
// AzureOpenAI compatibility for /videos is not assumed.
function getOpenAIVideosClient(toolName: string): OpenAI {
  const client = getOpenAIClient();
  if (client instanceof AzureOpenAI) {
    throw new Error(`${toolName} is not supported with AzureOpenAI (AZURE_OPENAI_API_KEY is set).`);
  }
  return client;
}

function envNonEmpty(name: string): string | undefined {
  const raw = process.env[name];
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function toStructuredContentRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (isPlainRecord(value)) return value;

  try {
    const jsonValue = JSON.parse(JSON.stringify(value)) as unknown;
    if (isPlainRecord(jsonValue)) return jsonValue;
    if (jsonValue && typeof jsonValue === "object" && !Array.isArray(jsonValue)) {
      return jsonValue as Record<string, unknown>;
    }
    return { value: jsonValue } satisfies Record<string, unknown>;
  } catch {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>));
    }
    return { value: String(value) } satisfies Record<string, unknown>;
  }
}

function getGoogleGenAIClient(toolName: string): GoogleGenAI {
  const useVertexAi = envNonEmpty("GOOGLE_GENAI_USE_VERTEXAI") === "true";
  if (useVertexAi) {
    const project = envNonEmpty("GOOGLE_CLOUD_PROJECT");
    const location = envNonEmpty("GOOGLE_CLOUD_LOCATION");
    if (!project) {
      throw new Error(`${toolName} requires GOOGLE_CLOUD_PROJECT when GOOGLE_GENAI_USE_VERTEXAI=true`);
    }
    if (!location) {
      throw new Error(`${toolName} requires GOOGLE_CLOUD_LOCATION when GOOGLE_GENAI_USE_VERTEXAI=true`);
    }
    return new GoogleGenAI({ vertexai: true, project, location });
  }

  const apiKey = envNonEmpty("GOOGLE_API_KEY") ?? envNonEmpty("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error(`${toolName} requires GOOGLE_API_KEY (or GEMINI_API_KEY) unless GOOGLE_GENAI_USE_VERTEXAI=true`);
  }
  return new GoogleGenAI({ apiKey });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type VideoDownloadVariant = "video" | "thumbnail" | "spritesheet";
type InputReferenceFit = "match" | "cover" | "contain" | "stretch";
type InputReferenceBackground = "blur" | "black" | "white" | `#${string}`;

function normalizeContentType(contentType: string | null): string | undefined {
  const raw = contentType?.split(";")[0]?.trim().toLowerCase();
  return raw && raw.length > 0 ? raw : undefined;
}

function normalizeImageMimeType(raw: string | undefined): string | undefined {
  const normalized = raw?.split(";")[0]?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (!normalized.startsWith("image/")) return undefined;
  return normalized;
}

function normalizeVideoMimeType(raw: string | undefined): string | undefined {
  const normalized = raw?.split(";")[0]?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (!normalized.startsWith("video/")) return undefined;
  return normalized;
}

function imageMimeToExt(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/jpg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  return normalized.split("/")[1] ?? "png";
}

function imageExtToMime(ext: string): string {
  const normalized = ext.toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
  if (normalized === "png") return "image/png";
  if (normalized === "webp") return "image/webp";
  if (normalized === "gif") return "image/gif";
  return "image/png";
}

function inferImageMimeFromFilePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

function inferVideoMimeFromFilePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mkv") return "video/x-matroska";
  return "video/mp4";
}

function parseHexColorToRgba(color: string): { r: number; g: number; b: number; alpha: number } {
  const match = color.trim().match(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (!match) {
    throw new Error(`Invalid hex color: ${color}`);
  }
  const hex = match[1]!;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, alpha };
}

function parseBase64DataUrl(input: string): { mimeType: string | undefined; base64: string } | null {
  if (!input.startsWith("data:")) return null;
  const commaIndex = input.indexOf(",");
  if (commaIndex === -1) return null;
  const header = input.slice("data:".length, commaIndex);
  const data = input.slice(commaIndex + 1);
  const parts = header.split(";").map((p) => p.trim()).filter((p) => p.length > 0);
  const mimeType = parts.length > 0 && parts[0]?.includes("/") ? parts[0] : undefined;
  const isBase64 = parts.some((p) => p.toLowerCase() === "base64");
  if (!isBase64) return null;
  return { mimeType: mimeType ? mimeType.trim() : undefined, base64: data };
}

async function fetchBinaryFromUrl(url: string, maxRedirects = 5): Promise<{ buffer: Buffer; contentType?: string }> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error("Too many redirects"));
      return;
    }
    const protocol = url.startsWith("https://") ? https : http;
    const req = protocol.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          const nextUrl = new URL(redirectUrl, url).toString();
          fetchBinaryFromUrl(nextUrl, maxRedirects - 1).then(resolve).catch(reject);
          return;
        }
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch: HTTP ${res.statusCode}`));
        return;
      }
      const rawContentType = res.headers["content-type"];
      const contentType = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ buffer: Buffer.concat(chunks), contentType }));
      res.on("error", reject);
    }).on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

async function fetchBinaryFromUrlWithFetch(
  url: string,
  opts: { timeoutMs: number },
): Promise<{ buffer: Buffer; contentType?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) {
      throw new Error(`Failed to fetch: HTTP ${res.status}`);
    }
    const contentType = res.headers.get("content-type");
    const buf = Buffer.from(await res.arrayBuffer());
    if (contentType && contentType.trim().length > 0) {
      return { buffer: buf, contentType };
    }
    return { buffer: buf };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch ${url}: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

function parseVideoSize(size: string): { width: number; height: number } {
  const parts = size.split("x");
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid size: ${size}`);
  }
  return { width, height };
}

type SharpMetadata = { width?: number; height?: number };
type SharpCompositeInput = { input: Buffer; gravity?: string };
type SharpInstance = {
  metadata: () => Promise<SharpMetadata>;
  resize: (width: number, height: number, options?: Record<string, unknown>) => SharpInstance;
  blur: (sigma?: number) => SharpInstance;
  png: () => SharpInstance;
  composite: (items: SharpCompositeInput[]) => SharpInstance;
  toBuffer: () => Promise<Buffer>;
};
type SharpFactory = (input: Buffer) => SharpInstance;

async function getSharpModule(): Promise<SharpFactory | null> {
  try {
    const sharpImport = await import("sharp");
    const maybeDefault = (sharpImport as unknown as { default?: unknown }).default;
    if (typeof maybeDefault === "function") return maybeDefault as unknown as SharpFactory;
    if (typeof (sharpImport as unknown) === "function") return sharpImport as unknown as SharpFactory;
    return null;
  } catch {
    return null;
  }
}

async function loadImageBufferFromReference(
  inputReference: string,
  toolName: string,
): Promise<{ buffer: Buffer; mimeType: string; ext: string }> {
  if (isHttpUrl(inputReference)) {
    if (!isUrlAllowedByEnv(inputReference)) {
      throw new Error("input_reference URL is not allowed by MEDIA_GEN_URLS");
    }
    log.child(toolName).debug("fetching input_reference", { url: inputReference });
    const { buffer, contentType } = await fetchBinaryFromUrl(inputReference);
    const headerMime = normalizeImageMimeType(contentType);
    const detectedFormat = await detectImageFormat(buffer);
    const ext = imageMimeToExt(headerMime ?? imageExtToMime(detectedFormat));
    const mimeType = headerMime ?? imageExtToMime(ext);
    return { buffer, mimeType, ext };
  }

  if (isBase64Image(inputReference)) {
    const parsed = parseBase64DataUrl(inputReference);
    const mimeFromUrl = normalizeImageMimeType(parsed?.mimeType);
    const base64 = (parsed ? parsed.base64 : inputReference).replace(/\s/g, "");
    const buffer = Buffer.from(base64, "base64");
    const detectedFormat = await detectImageFormat(buffer);
    const ext = imageMimeToExt(mimeFromUrl ?? imageExtToMime(detectedFormat));
    const mimeType = mimeFromUrl ?? imageExtToMime(ext);
    return { buffer, mimeType, ext };
  }

  const resolved = resolvePathInPrimaryRoot(inputReference);
  if (!isPathInAllowedDirs(resolved)) {
    throw new Error("input_reference path is outside allowed MEDIA_GEN_DIRS roots");
  }
  const buffer = await fs.promises.readFile(resolved);
  const detectedFormat = await detectImageFormat(buffer);
  const ext = imageMimeToExt(imageExtToMime(detectedFormat));
  const mimeType = imageExtToMime(ext);
  return { buffer, mimeType, ext };
}

async function loadImageBufferFromReferenceForGoogleVideo(
  inputReference: string,
  opts: { mimeTypeOverride?: string | undefined; toolName: string },
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (isHttpUrl(inputReference)) {
    if (!isUrlAllowedByEnv(inputReference)) {
      throw new Error("input_reference URL is not allowed by MEDIA_GEN_URLS");
    }
    log.child(opts.toolName).debug("fetching input_reference", { url: inputReference });
    const { buffer, contentType } = await fetchBinaryFromUrl(inputReference);
    const headerMime = normalizeImageMimeType(contentType);
    const overrideMime = normalizeImageMimeType(opts.mimeTypeOverride);

    const detectedFormat = await detectImageFormat(buffer);
    const detectedMime = imageExtToMime(detectedFormat);

    return { buffer, mimeType: overrideMime ?? headerMime ?? detectedMime };
  }

  if (isBase64Image(inputReference)) {
    const parsed = parseBase64DataUrl(inputReference);
    const mimeFromUrl = normalizeImageMimeType(parsed?.mimeType);
    const overrideMime = normalizeImageMimeType(opts.mimeTypeOverride);
    const base64 = (parsed ? parsed.base64 : inputReference).replace(/\s/g, "");
    const buffer = Buffer.from(base64, "base64");

    if (overrideMime) return { buffer, mimeType: overrideMime };
    if (mimeFromUrl) return { buffer, mimeType: mimeFromUrl };

    const detectedFormat = await detectImageFormat(buffer);
    return { buffer, mimeType: imageExtToMime(detectedFormat) };
  }

  const resolved = resolvePathInPrimaryRoot(inputReference);
  if (!isPathInAllowedDirs(resolved)) {
    throw new Error("input_reference path is outside allowed MEDIA_GEN_DIRS roots");
  }
  const buffer = await fs.promises.readFile(resolved);
  const detectedFormat = await detectImageFormat(buffer);

  const overrideMime = normalizeImageMimeType(opts.mimeTypeOverride);
  return { buffer, mimeType: overrideMime ?? imageExtToMime(detectedFormat) };
}

async function loadVideoBufferFromReferenceForGoogleVideo(
  inputVideoReference: string,
  opts: { toolName: string },
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (isHttpUrl(inputVideoReference)) {
    if (!isUrlAllowedByEnv(inputVideoReference)) {
      throw new Error("input_video_reference URL is not allowed by MEDIA_GEN_URLS");
    }
    log.child(opts.toolName).debug("fetching input_video_reference", { url: inputVideoReference });
    const { buffer, contentType } = await fetchBinaryFromUrlWithFetch(inputVideoReference, { timeoutMs: 5 * 60_000 });
    const headerMime = normalizeVideoMimeType(contentType);
    const urlMime = inferVideoMimeFromFilePath(new URL(inputVideoReference).pathname);
    return { buffer, mimeType: headerMime ?? urlMime };
  }

  const resolved = resolvePathInPrimaryRoot(inputVideoReference);
  if (!isPathInAllowedDirs(resolved)) {
    throw new Error("input_video_reference path is outside allowed MEDIA_GEN_DIRS roots");
  }
  const buffer = await fs.promises.readFile(resolved);
  const mimeType = inferVideoMimeFromFilePath(resolved);
  return { buffer, mimeType };
}

async function preprocessInputReferenceForVideo(
  input: { buffer: Buffer; mimeType: string; ext: string },
  targetSize: string,
  fit: InputReferenceFit,
  background: InputReferenceBackground,
  toolName: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const { width, height } = parseVideoSize(targetSize);

  const sharp = await getSharpModule();
  if (!sharp) {
    if (fit === "match") {
      return { buffer: input.buffer, mimeType: input.mimeType, filename: `input_reference.${input.ext}` };
    }
    throw new Error("sharp is required to resize/pad input_reference; install sharp or use input_reference_fit=match");
  }

  const meta = await sharp(input.buffer).metadata();
  const srcW = meta.width;
  const srcH = meta.height;

  if (!srcW || !srcH) {
    throw new Error("Unable to read input_reference dimensions");
  }

  const needsResize = srcW !== width || srcH !== height;

  if (fit === "match") {
    if (needsResize) {
      throw new Error(
        `input_reference is ${srcW}x${srcH} but requested video size is ${width}x${height}; set input_reference_fit=contain|cover|stretch to auto-fit`,
      );
    }
    return { buffer: input.buffer, mimeType: input.mimeType, filename: `input_reference.${input.ext}` };
  }

  if (!needsResize) {
    return { buffer: input.buffer, mimeType: input.mimeType, filename: `input_reference.${input.ext}` };
  }

  const targetName = `input_reference_${width}x${height}_${fit}.png`;

  if (fit === "cover") {
    const out = await sharp(input.buffer)
      .resize(width, height, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    log.child(toolName).info("input_reference resized", { fit, from: `${srcW}x${srcH}`, to: `${width}x${height}` });
    return { buffer: out, mimeType: "image/png", filename: targetName };
  }

  if (fit === "stretch") {
    const out = await sharp(input.buffer)
      .resize(width, height, { fit: "fill" })
      .png()
      .toBuffer();
    log.child(toolName).info("input_reference resized", { fit, from: `${srcW}x${srcH}`, to: `${width}x${height}` });
    return { buffer: out, mimeType: "image/png", filename: targetName };
  }

  // contain: pad/letterbox
  if (background === "blur") {
    const bg = await sharp(input.buffer)
      .resize(width, height, { fit: "cover", position: "centre" })
      .blur(50)
      .png()
      .toBuffer();
    const fg = await sharp(input.buffer)
      .resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const out = await sharp(bg)
      .composite([{ input: fg, gravity: "centre" }])
      .png()
      .toBuffer();
    log.child(toolName).info("input_reference resized", { fit, background, from: `${srcW}x${srcH}`, to: `${width}x${height}` });
    return { buffer: out, mimeType: "image/png", filename: targetName };
  }

  const backgroundColor = background === "black" ? "#000000" : background === "white" ? "#FFFFFF" : background;
  const rgba = parseHexColorToRgba(backgroundColor);
  const out = await sharp(input.buffer)
    .resize(width, height, { fit: "contain", background: rgba })
    .png()
    .toBuffer();
  log.child(toolName).info("input_reference resized", { fit, background, from: `${srcW}x${srcH}`, to: `${width}x${height}` });
  return { buffer: out, mimeType: "image/png", filename: targetName };
}

function inferVideoExtension(contentType: string | null, variant: VideoDownloadVariant): string {
  const ct = normalizeContentType(contentType);
  if (ct === "video/mp4" || ct === "application/mp4") return ".mp4";
  if (ct === "video/webm") return ".webm";
  if (ct === "video/quicktime") return ".mov";
  if (ct === "video/x-m4v") return ".m4v";
  if (ct === "video/x-matroska") return ".mkv";
  if (ct === "video/x-msvideo") return ".avi";
  if (ct === "image/png") return ".png";
  if (ct === "image/jpeg") return ".jpg";
  if (ct === "image/webp") return ".webp";
  if (ct === "application/zip") return ".zip";

  if (variant === "video") return ".mp4";
  if (variant === "thumbnail") return ".png";
  return ".zip";
}

function inferMimeType(contentType: string | null, ext: string): string {
  const ct = normalizeContentType(contentType);
  if (ct) return ct;

  const normalizedExt = ext.toLowerCase();
  if (normalizedExt === ".mp4") return "video/mp4";
  if (normalizedExt === ".png") return "image/png";
  if (normalizedExt === ".jpg" || normalizedExt === ".jpeg") return "image/jpeg";
  if (normalizedExt === ".webp") return "image/webp";
  if (normalizedExt === ".zip") return "application/zip";
  return "application/octet-stream";
}

const KNOWN_VIDEO_FILE_EXTENSIONS = [".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi"] as const;
const KNOWN_OPENAI_VIDEO_ASSET_EXTENSIONS = [
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  ".mkv",
  ".avi",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".zip",
] as const;

function splitPathForKnownExtension(basePath: string, knownExts: readonly string[]): { dir: string; baseName: string } {
  const dir = path.dirname(basePath);
  const base = path.basename(basePath);
  const ext = path.extname(base).toLowerCase();
  if (ext && knownExts.includes(ext)) {
    return { dir, baseName: base.slice(0, -ext.length) };
  }
  return { dir, baseName: base };
}

function resolveVideoBaseOutputPath(file: string | undefined, methodName: string, id: string | undefined): string {
  if (file) return resolvePathInPrimaryRoot(file);
  const effectiveId = id && id.trim().length > 0 ? id : crypto.randomUUID();
  const baseName = buildDefaultOutputBaseName({ methodName, id: effectiveId });
  return path.join(primaryOutputDir, baseName);
}

function buildVariantOutputPath(
  basePath: string,
  variant: VideoDownloadVariant,
  ext: string,
  multipleVariants: boolean,
): string {
  const { dir, baseName } = splitPathForKnownExtension(basePath, KNOWN_OPENAI_VIDEO_ASSET_EXTENSIONS);
  if (multipleVariants) {
    return path.join(dir, `${baseName}_${variant}${ext}`);
  }
  return path.join(dir, `${baseName}${ext}`);
}

async function downloadVideoAssetToFile(
  openai: OpenAI,
  videoId: string,
  variant: VideoDownloadVariant,
  basePath: string,
  multipleVariants: boolean,
): Promise<{ resourceLink: ResourceLink; filePath: string; uri: string; mimeType: string }> {
  const response = await openai.videos.downloadContent(videoId, { variant });
  const contentType = response.headers.get("content-type");
  const ext = inferVideoExtension(contentType, variant);
  const mimeType = inferMimeType(contentType, ext);

  const filePath = buildVariantOutputPath(basePath, variant, ext, multipleVariants);
  if (!isPathInAllowedDirs(filePath)) {
    throw new Error(`Output path is outside allowed MEDIA_GEN_DIRS roots: ${filePath}`);
  }

  await ensureDirectoryWritable(filePath);

  const buf = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(filePath, buf);

  const httpUrl = buildPublicUrlForFile(filePath);
  const uri = httpUrl ?? `file://${filePath}`;
  const resourceLink: ResourceLink = {
    type: "resource_link",
    uri,
    name: path.basename(filePath),
    mimeType,
  };

  return { resourceLink, filePath, uri, mimeType };
}

async function buildEmbeddedResourceFromFile(opts: {
  filePath: string;
  uri: string;
  mimeType: string;
}): Promise<EmbeddedResource> {
  const buffer = await fs.promises.readFile(opts.filePath);
  return {
    type: "resource" as const,
    resource: {
      uri: opts.uri,
      mimeType: opts.mimeType,
      blob: buffer.toString("base64"),
    },
  };
}

async function waitForVideoCompletion(
  openai: OpenAI,
  videoId: string,
  opts: { timeoutMs?: number | undefined; pollIntervalMs?: number | undefined; toolName: string },
): Promise<Awaited<ReturnType<OpenAI["videos"]["retrieve"]>>> {
  const timeoutMs = opts.timeoutMs ?? 900000;
  const pollIntervalMs = opts.pollIntervalMs ?? 2000;
  const start = Date.now();

  while (Date.now() - start <= timeoutMs) {
    const video = await openai.videos.retrieve(videoId);
    if (video.status === "completed") return video;
    if (video.status === "failed") {
      const message = video.error?.message ?? "Video generation failed";
      throw new Error(message);
    }
    await sleep(pollIntervalMs);
  }

  const last = await openai.videos.retrieve(videoId);
  throw new Error(
    `${opts.toolName} timeout after ${timeoutMs}ms (status=${last.status}, progress=${last.progress})`,
  );
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
type ContentBlock = TextContent | ImageContent | ResourceLink | EmbeddedResource;

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
    output_tokens_details?: {
      text_tokens?: number;
      image_tokens?: number;
    };
  } | null;
  // Additional fields from GPT Image models (all can be undefined when not provided)
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
  imageModel?: unknown,
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

  const isOpenAIImagesTool = toolName === "openai-images-generate" || toolName === "openai-images-edit";
  const pricing = isOpenAIImagesTool ? estimateGptImageCost({ model: imageModel, usage: apiResponse.usage }) : null;
  if (pricing) {
    const formattedCost = pricing.cost.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    content.push({
      type: "text" as const,
      text: `cost_usd=${formattedCost} text_in=${pricing.text_input_tokens} image_in=${pricing.image_input_tokens} out=${pricing.text_output_tokens + pricing.image_output_tokens}`,
    });
  }

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
    urls: urls.filter((u) => u.length > 0),
    urls_count: urls.length,
    toolResult,
    responseFormat,
    revisedPrompts: revisedPromptTexts.length,
  });

  const structuredContent = isOpenAIImagesTool
    ? ({ ...apiResponse, pricing } as unknown as Record<string, unknown>)
    : (apiResponse as unknown as Record<string, unknown>);

  return {
    content,
    structuredContent,
  } as CallToolResult;
}

(async () => {
	const server = new McpServer({
	  name: "media-gen-mcp",
	  version: "1.1.1"
	}, {
  capabilities: {
    tools: { listChanged: false }
  }
});

	  // Zod schema for openai-images-generate tool input
		  const openaiImagesGenerateBaseSchema = z.object({
		    prompt: z.string().max(32000),
		    background: z.enum(["transparent", "opaque", "auto"]).optional(),
		    model: z.enum(["gpt-image-1.5", "gpt-image-1"]).default("gpt-image-1.5"),
		    moderation: z.enum(["auto", "low"]).optional(),
		    n: z.number().int().min(1).max(10).optional(),
		    output_compression: z.number().int().min(0).max(100).optional(),
		    output_format: z.enum(["png", "jpeg", "webp"]).optional(),
		    quality: z.enum(["auto", "high", "medium", "low"]).default("high"),
	    size: z.enum(["1024x1024", "1536x1024", "1024x1536", "auto"]).default("1024x1536"),
	    user: z.string().optional(),
	    tool_result: z.enum(["resource_link", "image"]).default("resource_link")
	      .describe("Controls content[] shape: 'resource_link' (default) emits ResourceLink items, 'image' emits base64 ImageContent blocks."),
	    response_format: z.enum(["url", "b64_json"]).default("url")
	      .describe("Controls structuredContent shape: 'url' (default) emits data[].url, 'b64_json' emits data[].b64_json."),
	  });

  // Full schema with refinement for validation inside the handler
  const openaiImagesGenerateSchema = openaiImagesGenerateBaseSchema;

  type OpenAIImagesGenerateToolArgs = z.input<typeof openaiImagesGenerateBaseSchema>;

  server.registerTool(
	    "openai-images-generate",
	    {
	      title: "OpenAI Images Generate",
	      description: "Generate images from text prompts using OpenAI gpt-image-1.5 (default) or gpt-image-1. Returns MCP CallToolResult with content[] (ResourceLink or ImageContent based on tool_result param) and structuredContent (OpenAI ImagesResponse format with data[].url or data[].b64_json based on response_format param).",
	      inputSchema: openaiImagesGenerateBaseSchema.shape,
	      annotations: openaiToolAnnotations,
	    },
	    async (args: OpenAIImagesGenerateToolArgs, _extra: unknown) => {
      try {
        debugLogRawArgs("openai-images-generate", args);
        const openai = getOpenAIClient();
		        const {
		          prompt,
		          background,
		          model = "gpt-image-1.5",
		          moderation,
		          n,
		          output_compression,
		          output_format,
	          quality,
	          size,
	          user,
	          tool_result = "resource_link",
	          response_format = "url",
	        } = openaiImagesGenerateSchema.parse(args);

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
	        const { effectiveFileOutput } = resolveOutputPath(images, response_format, undefined, "openai-images-generate");

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
          usage: (result as unknown as { usage?: OpenAIImageApiResponse["usage"] }).usage ?? null,
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
	          model,
	        );
	      } catch (err) {
	        return buildErrorResult(err, "openai-images-generate");
	      }
	    }
	  );

	  // Zod schema for openai-images-edit tool input (gpt-image-1.5/gpt-image-1)
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
		    model: z.enum(["gpt-image-1.5", "gpt-image-1"]).default("gpt-image-1.5"),
		    n: z.number().int().min(1).max(10).optional().describe("Number of images to generate (1-10)."),
		    quality: z.enum(["auto", "high", "medium", "low"]).default("high").describe("Quality (high, medium, low). Default: high."),
	    size: z.enum(["1024x1024", "1536x1024", "1024x1536", "auto"]).default("1024x1536").describe("Size of the generated images. Default: 1024x1536."),
		    user: z.string().optional().describe("Optional user identifier for OpenAI monitoring."),
	    tool_result: z.enum(["resource_link", "image"]).default("resource_link")
	      .describe("Controls content[] shape: 'resource_link' (default) emits ResourceLink items, 'image' emits base64 ImageContent blocks."),
	    response_format: z.enum(["url", "b64_json"]).default("url")
	      .describe("Controls structuredContent shape: 'url' (default) emits data[].url, 'b64_json' emits data[].b64_json."),
	  });

  // Full schema with refinement for validation inside the handler
  const openaiImagesEditSchema = openaiImagesEditBaseSchema;

  type OpenAIImagesEditToolArgs = z.input<typeof openaiImagesEditBaseSchema>;

	  // Edit Image Tool (gpt-image-1.5/gpt-image-1)
	  server.registerTool(
	    "openai-images-edit",
	    {
	      title: "OpenAI Images Edit",
	      description: "Edit images (inpainting, outpainting, compositing) from 1 to 16 inputs using OpenAI gpt-image-1.5 (default) or gpt-image-1. Returns MCP CallToolResult with content[] (ResourceLink or ImageContent based on tool_result param) and structuredContent (OpenAI ImagesResponse format with data[].url or data[].b64_json based on response_format param).",
	      inputSchema: openaiImagesEditBaseSchema.shape,
	      annotations: openaiToolAnnotations,
	    },
    async (args: OpenAIImagesEditToolArgs, _extra: unknown) => {
      try {
        debugLogRawArgs("openai-images-edit", args);
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
	        const { prompt, model = "gpt-image-1.5", n, quality, size, user, tool_result = "resource_link", response_format = "url" } = validatedArgs;

        // Helper to convert input (path or base64) to toFile
        async function inputToFile(input: string, idx = 0) {
          if (!isBase64Image(input)) {
            const resolved = resolvePathInPrimaryRoot(input);
            if (!isPathInAllowedDirs(resolved)) {
              throw new Error("Image path is outside allowed MEDIA_GEN_DIRS roots");
            }
            const mime = inferImageMimeFromFilePath(resolved);
            return await toFile(fs.createReadStream(resolved), undefined, { type: mime });
          } else {
            // Base64 or data URL
            const parsed = parseBase64DataUrl(input);
            const mimeFromUrl = normalizeImageMimeType(parsed?.mimeType);
            const base64 = (parsed ? parsed.base64 : input).replace(/\s/g, "");
            const buffer = Buffer.from(base64, "base64");
            const detectedFormat = await detectImageFormat(buffer);
            const detectedExt = imageMimeToExt(imageExtToMime(detectedFormat));
            const mime = mimeFromUrl ?? imageExtToMime(detectedExt);
            const ext = imageMimeToExt(mime);
            return await toFile(buffer, `input_${idx}.${ext}`, { type: mime });
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
	          model, // gpt-image-1.5 by default
	          ...(maskFile ? { mask: maskFile } : {}),
	          ...(n ? { n } : {}),
	          ...(quality ? { quality } : {}),
	          ...(size ? { size } : {}),
	          ...(user ? { user } : {}),
	          stream: false as const,
	          // response_format is not applicable for images.edit (always b64_json)
	        };

        const result = await openai.images.edit(editParams);

        const editResult = result as unknown as ImageGenerateResult;
        const editData = (editResult.data ?? []) as ImageApiDataItem[];

	        // OpenAI Images edit currently returns png
	        const images = parseImageResponse(editData, "png");

	        const revisedPromptItems = extractRevisedPrompts(editData);
	        const { effectiveFileOutput } = resolveOutputPath(images, response_format, undefined, "openai-images-edit");

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
          usage: (result as unknown as { usage?: OpenAIImageApiResponse["usage"] }).usage ?? null,
          output_format: "png",
          size: size,
          quality: quality,
        };

	        return buildImageToolResult(images, processedResult, revisedPromptItems, "openai-images-edit", tool_result, response_format, rawApiResponse, model);
      } catch (err) {
        return buildErrorResult(err, "openai-images-edit");
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // OpenAI Videos tools
  // ═══════════════════════════════════════════════════════════════════════════

  server.registerTool(
    "openai-videos-create",
    {
      title: "OpenAI Videos Create",
      description:
        "Create a video generation job using the OpenAI Videos API. Returns structuredContent with the OpenAI Video job object, and (optionally) downloaded assets as MCP content blocks (tool_result=resource_link|resource).",
      inputSchema: openaiVideosCreateSchema.shape,
      annotations: openaiToolAnnotations,
    },
    async (args: OpenAIVideosCreateArgs, _extra: unknown) => {
      try {
        debugLogRawArgs("openai-videos-create", args);
        const validated = openaiVideosCreateSchema.parse(args);
	        const {
	          prompt,
	          input_reference,
	          input_reference_fit,
	          input_reference_background,
	          model,
	          seconds,
	          size,
	          wait_for_completion,
	          timeout_ms,
	          poll_interval_ms,
	          download_variants,
	          tool_result,
	        } = validated;

        const openai = getOpenAIVideosClient("openai-videos-create");

        const content: ContentBlock[] = [];

        let inputReferenceUploadable: Uploadable | undefined;
        const effectiveSize = input_reference ? (size ?? ("720x1280" as const)) : size;

        if (input_reference) {
          const targetSize = size ?? ("720x1280" as const);
          const loaded = await loadImageBufferFromReference(input_reference, "openai-videos-create");
          const processed = await preprocessInputReferenceForVideo(
            loaded,
            targetSize,
            (input_reference_fit ?? "contain") as InputReferenceFit,
            (input_reference_background ?? "blur") as InputReferenceBackground,
            "openai-videos-create",
          );
          inputReferenceUploadable = await toFile(processed.buffer, processed.filename, { type: processed.mimeType });
        }

        const createParams: Parameters<typeof openai.videos.create>[0] = {
          prompt,
          ...(inputReferenceUploadable ? { input_reference: inputReferenceUploadable } : {}),
          ...(model ? { model } : {}),
          ...(seconds ? { seconds } : {}),
          ...(effectiveSize ? { size: effectiveSize } : {}),
        };

        const created = await openai.videos.create(createParams);
        const pricing = estimateSoraVideoCost({ model: created.model, seconds: created.seconds, size: created.size });

        content.push({
          type: "text" as const,
          text: `video_id=${created.id} status=${created.status} progress=${created.progress}${pricing ? ` cost_usd=${pricing.cost}` : ""}`,
        });

        if (!wait_for_completion) {
          content.push({ type: "text" as const, text: JSON.stringify({ video_id: created.id, pricing }, null, 2) });
          content.push({ type: "text" as const, text: JSON.stringify(created, null, 2) });
          return {
            content,
            structuredContent: toStructuredContentRecord(created),
          };
        }

        const finalVideo = await waitForVideoCompletion(openai, created.id, {
          timeoutMs: timeout_ms,
          pollIntervalMs: poll_interval_ms,
          toolName: "openai-videos-create",
        });
        const finalPricing = estimateSoraVideoCost({ model: finalVideo.model, seconds: finalVideo.seconds, size: finalVideo.size });

	        const variants = (download_variants ?? ["video"]) as VideoDownloadVariant[];
	        const multipleVariants = variants.length > 1;
	        const basePath = resolveVideoBaseOutputPath(undefined, "openai-videos-create", finalVideo.id);
	        await validateOutputDirectory(basePath);

	        const assets: Array<{ variant: VideoDownloadVariant; uri: string; mimeType: string; file: string }> = [];
	        for (const variant of variants) {
	          const downloaded = await downloadVideoAssetToFile(openai, finalVideo.id, variant, basePath, multipleVariants);
	          if (tool_result === "resource") {
	            content.push(
	              await buildEmbeddedResourceFromFile({
	                filePath: downloaded.filePath,
	                uri: downloaded.uri,
	                mimeType: downloaded.mimeType,
	              }),
	            );
	          } else {
	            content.push(downloaded.resourceLink);
	          }
	          assets.push({
	            variant,
	            uri: downloaded.uri,
	            mimeType: downloaded.mimeType,
	            file: `file://${downloaded.filePath}`,
	          });
	        }

        content.push({ type: "text" as const, text: JSON.stringify({ video_id: finalVideo.id, assets, pricing: finalPricing }, null, 2) });
        content.push({ type: "text" as const, text: JSON.stringify(finalVideo, null, 2) });

        return {
          content,
          structuredContent: toStructuredContentRecord(finalVideo),
        };
      } catch (err) {
        return buildErrorResult(err, "openai-videos-create");
      }
    },
  );

  server.registerTool(
    "openai-videos-remix",
    {
      title: "OpenAI Videos Remix",
      description:
        "Create a remix video job from an existing video_id. Returns structuredContent with the OpenAI Video job object, and (optionally) downloaded assets as MCP content blocks (tool_result=resource_link|resource).",
      inputSchema: openaiVideosRemixSchema.shape,
      annotations: openaiToolAnnotations,
    },
    async (args: OpenAIVideosRemixArgs) => {
      try {
        debugLogRawArgs("openai-videos-remix", args);
        const validated = openaiVideosRemixSchema.parse(args);
	        const {
	          video_id,
	          prompt,
	          wait_for_completion,
	          timeout_ms,
	          poll_interval_ms,
	          download_variants,
	          tool_result,
	        } = validated;

        const openai = getOpenAIVideosClient("openai-videos-remix");

        const content: ContentBlock[] = [];
        const remixed = await openai.videos.remix(video_id, { prompt });
        const pricing = estimateSoraVideoCost({ model: remixed.model, seconds: remixed.seconds, size: remixed.size });

        content.push({
          type: "text" as const,
          text: `video_id=${remixed.id} status=${remixed.status} progress=${remixed.progress} remixed_from=${remixed.remixed_from_video_id ?? video_id}${pricing ? ` cost_usd=${pricing.cost}` : ""}`,
        });

        if (!wait_for_completion) {
          content.push({ type: "text" as const, text: JSON.stringify({ video_id: remixed.id, pricing }, null, 2) });
          content.push({ type: "text" as const, text: JSON.stringify(remixed, null, 2) });
          return {
            content,
            structuredContent: toStructuredContentRecord(remixed),
          };
        }

        const finalVideo = await waitForVideoCompletion(openai, remixed.id, {
          timeoutMs: timeout_ms,
          pollIntervalMs: poll_interval_ms,
          toolName: "openai-videos-remix",
        });
        const finalPricing = estimateSoraVideoCost({ model: finalVideo.model, seconds: finalVideo.seconds, size: finalVideo.size });

	        const variants = (download_variants ?? ["video"]) as VideoDownloadVariant[];
	        const multipleVariants = variants.length > 1;
	        const basePath = resolveVideoBaseOutputPath(undefined, "openai-videos-remix", finalVideo.id);
	        await validateOutputDirectory(basePath);

        const assets: Array<{ variant: VideoDownloadVariant; uri: string; mimeType: string; file: string }> = [];
        for (const variant of variants) {
          const downloaded = await downloadVideoAssetToFile(openai, finalVideo.id, variant, basePath, multipleVariants);
          if (tool_result === "resource") {
            content.push(
              await buildEmbeddedResourceFromFile({
                filePath: downloaded.filePath,
                uri: downloaded.uri,
                mimeType: downloaded.mimeType,
              }),
            );
          } else {
            content.push(downloaded.resourceLink);
          }
          assets.push({
            variant,
            uri: downloaded.uri,
            mimeType: downloaded.mimeType,
            file: `file://${downloaded.filePath}`,
          });
        }

        content.push({ type: "text" as const, text: JSON.stringify({ video_id: finalVideo.id, assets, pricing: finalPricing }, null, 2) });
        content.push({ type: "text" as const, text: JSON.stringify(finalVideo, null, 2) });

        return {
          content,
          structuredContent: toStructuredContentRecord(finalVideo),
        };
      } catch (err) {
        return buildErrorResult(err, "openai-videos-remix");
      }
    },
  );

  server.registerTool(
    "openai-videos-list",
    {
      title: "OpenAI Videos List",
      description:
        "List video jobs using the OpenAI Videos API. Returns structuredContent with the OpenAI list response shape { data, has_more, last_id }.",
      inputSchema: openaiVideosListSchema.shape,
      annotations: openaiToolAnnotations,
    },
    async (args: OpenAIVideosListArgs) => {
      try {
        debugLogRawArgs("openai-videos-list", args);
        const validated = openaiVideosListSchema.parse(args);
        const openai = getOpenAIVideosClient("openai-videos-list");

        const page = await openai.videos.list({
          ...(validated.after ? { after: validated.after } : {}),
          ...(validated.limit ? { limit: validated.limit } : {}),
          ...(validated.order ? { order: validated.order } : {}),
        });

        const structured = {
          data: page.data,
          has_more: page.has_more,
          last_id: page.last_id,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
          structuredContent: toStructuredContentRecord(structured),
        };
      } catch (err) {
        return buildErrorResult(err, "openai-videos-list");
      }
    },
  );

  server.registerTool(
    "openai-videos-retrieve",
    {
      title: "OpenAI Videos Retrieve",
      description: "Retrieve a video job by id using the OpenAI Videos API.",
      inputSchema: openaiVideosRetrieveSchema.shape,
      annotations: openaiToolAnnotations,
    },
    async (args: OpenAIVideosRetrieveArgs) => {
      try {
        debugLogRawArgs("openai-videos-retrieve", args);
        const validated = openaiVideosRetrieveSchema.parse(args);
        const openai = getOpenAIVideosClient("openai-videos-retrieve");
        const video = await openai.videos.retrieve(validated.video_id);
        return {
          content: [{ type: "text", text: JSON.stringify(video, null, 2) }],
          structuredContent: toStructuredContentRecord(video),
        };
      } catch (err) {
        return buildErrorResult(err, "openai-videos-retrieve");
      }
    },
  );

  server.registerTool(
    "openai-videos-delete",
    {
      title: "OpenAI Videos Delete",
      description: "Delete a video job by id using the OpenAI Videos API.",
      inputSchema: openaiVideosDeleteSchema.shape,
      annotations: openaiToolAnnotations,
    },
    async (args: OpenAIVideosDeleteArgs) => {
      try {
        debugLogRawArgs("openai-videos-delete", args);
        const validated = openaiVideosDeleteSchema.parse(args);
        const openai = getOpenAIVideosClient("openai-videos-delete");
        const deleted = await openai.videos.delete(validated.video_id);
        return {
          content: [{ type: "text", text: JSON.stringify(deleted, null, 2) }],
          structuredContent: toStructuredContentRecord(deleted),
        };
      } catch (err) {
        return buildErrorResult(err, "openai-videos-delete");
      }
    },
  );

  server.registerTool(
    "openai-videos-retrieve-content",
    {
      title: "OpenAI Videos Retrieve Content",
      description:
        "Retrieve a video asset (video/thumbnail/spritesheet) for a completed job, write it under MEDIA_GEN_DIRS, and return content blocks (tool_result=resource_link|resource).",
      inputSchema: openaiVideosRetrieveContentSchema.shape,
      annotations: openaiToolAnnotations,
    },
    async (args: OpenAIVideosRetrieveContentArgs) => {
      try {
        debugLogRawArgs("openai-videos-retrieve-content", args);
        const validated = openaiVideosRetrieveContentSchema.parse(args);
        const openai = getOpenAIVideosClient("openai-videos-retrieve-content");

	        const video = await openai.videos.retrieve(validated.video_id);
	        if (video.status !== "completed") {
	          throw new Error(`Cannot retrieve content: video status is ${video.status} (progress=${video.progress})`);
	        }

	        const variant = (validated.variant ?? "video") as VideoDownloadVariant;
	        const toolResult = validated.tool_result ?? "resource_link";
	        const basePath = resolveVideoBaseOutputPath(undefined, "openai-videos-retrieve-content", video.id);
	        await validateOutputDirectory(basePath);

        const downloaded = await downloadVideoAssetToFile(openai, video.id, variant, basePath, false);
        const pricing = estimateSoraVideoCost({ model: video.model, seconds: video.seconds, size: video.size });

        const content: ContentBlock[] = [];
        if (toolResult === "resource") {
          content.push(
            await buildEmbeddedResourceFromFile({
              filePath: downloaded.filePath,
              uri: downloaded.uri,
              mimeType: downloaded.mimeType,
            }),
          );
        } else {
          content.push(downloaded.resourceLink);
        }

        return {
          content: [
            ...content,
            { type: "text", text: JSON.stringify({ video_id: video.id, variant, uri: downloaded.uri, pricing }, null, 2) },
            { type: "text", text: JSON.stringify(video, null, 2) },
          ],
          structuredContent: toStructuredContentRecord(video),
        };
      } catch (err) {
        return buildErrorResult(err, "openai-videos-retrieve-content");
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Google Videos (Gemini / Veo)
  // ═══════════════════════════════════════════════════════════════════════════

  function createGoogleVideosOperation(operationName: string): GenerateVideosOperation {
    const op = new GenerateVideosOperation();
    op.name = operationName;
    return op;
  }

  function appendGoogleApiKeyToUrl(url: string): string {
    const apiKey = envNonEmpty("GOOGLE_API_KEY") ?? envNonEmpty("GEMINI_API_KEY");
    if (!apiKey) return url;
    try {
      const u = new URL(url);
      if (!u.searchParams.has("key")) {
        u.searchParams.set("key", apiKey);
      }
      return u.toString();
    } catch {
      return url;
    }
  }

  async function waitForGoogleVideosCompletion(opts: {
    ai: GoogleGenAI;
    operation: GenerateVideosOperation;
    timeoutMs: number;
    pollIntervalMs: number;
    toolName: string;
  }): Promise<GenerateVideosOperation> {
    const start = Date.now();
    let current = opts.operation;

    while (Date.now() - start <= opts.timeoutMs) {
      current = await opts.ai.operations.getVideosOperation({ operation: current });
      if (current.done) {
        if (current.error) {
          throw new Error(`${opts.toolName} failed: ${JSON.stringify(current.error)}`);
        }
        return current;
      }
      await sleep(opts.pollIntervalMs);
    }

    const last = await opts.ai.operations.getVideosOperation({ operation: current });
    throw new Error(`${opts.toolName} timeout after ${opts.timeoutMs}ms (done=${last.done ?? false})`);
  }

  function buildGoogleVideoOutputPath(basePath: string, index: number, extWithDot: string, total: number): string {
    const { dir, baseName } = splitPathForKnownExtension(basePath, KNOWN_VIDEO_FILE_EXTENSIONS);
    if (total > 1) return path.join(dir, `${baseName}_${index + 1}${extWithDot}`);
    return path.join(dir, `${baseName}${extWithDot}`);
  }

  async function downloadGoogleVideoToFile(opts: {
    toolName: string;
    basePath: string;
    index: number;
    total: number;
    video: Video;
  }): Promise<{ resourceLink: ResourceLink; filePath: string; uri: string; mimeType: string }> {
    // Prefer embedded base64 when present, otherwise fetch by URI.
    if (opts.video.videoBytes) {
      const contentType = opts.video.mimeType ?? null;
      const ext = inferVideoExtension(contentType, "video");
      const mimeType = inferMimeType(contentType, ext);
      const filePath = buildGoogleVideoOutputPath(opts.basePath, opts.index, ext, opts.total);

      if (!isPathInAllowedDirs(filePath)) {
        throw new Error(`Output path is outside allowed MEDIA_GEN_DIRS roots: ${filePath}`);
      }
      await ensureDirectoryWritable(filePath);

      const buf = Buffer.from(opts.video.videoBytes.replace(/\s/g, ""), "base64");
      await fs.promises.writeFile(filePath, buf);

      const httpUrl = buildPublicUrlForFile(filePath);
      const uri = httpUrl ?? `file://${filePath}`;
      const resourceLink: ResourceLink = { type: "resource_link", uri, name: path.basename(filePath), mimeType };
      return { resourceLink, filePath, uri, mimeType };
    }

    if (!opts.video.uri) {
      throw new Error("Generated video has neither videoBytes nor uri");
    }

    const downloadUrl = appendGoogleApiKeyToUrl(opts.video.uri);
    if (!isUrlAllowedByEnv(downloadUrl)) {
      throw new Error("Video download URL is not allowed by MEDIA_GEN_URLS");
    }

    const fetched = await fetchBinaryFromUrlWithFetch(downloadUrl, { timeoutMs: 10 * 60_000 });
    const ext = inferVideoExtension(fetched.contentType ?? null, "video");
    const mimeType = inferMimeType(fetched.contentType ?? null, ext);
    const filePath = buildGoogleVideoOutputPath(opts.basePath, opts.index, ext, opts.total);

    if (!isPathInAllowedDirs(filePath)) {
      throw new Error(`Output path is outside allowed MEDIA_GEN_DIRS roots: ${filePath}`);
    }
    await ensureDirectoryWritable(filePath);

    await fs.promises.writeFile(filePath, fetched.buffer);

    const httpUrl = buildPublicUrlForFile(filePath);
    const uri = httpUrl ?? `file://${filePath}`;
    const resourceLink: ResourceLink = { type: "resource_link", uri, name: path.basename(filePath), mimeType };
    return { resourceLink, filePath, uri, mimeType };
  }

  async function buildGoogleVideosStructuredContent(opts: {
    operation: GenerateVideosOperation;
    responseFormat: "url" | "b64_json";
    downloads?: Array<{ index: number; uri: string; mimeType: string; filePath: string }> | undefined;
  }): Promise<Record<string, unknown> | undefined> {
    const record = toStructuredContentRecord(opts.operation);
    if (!record) return record;

    const downloadsByIndex = new Map<number, { uri: string; mimeType: string; filePath: string }>();
    for (const item of opts.downloads ?? []) {
      downloadsByIndex.set(item.index, { uri: item.uri, mimeType: item.mimeType, filePath: item.filePath });
    }

    const response = record["response"];
    if (!response || typeof response !== "object" || Array.isArray(response)) return record;
    const responseRecord = response as Record<string, unknown>;
    const generated = responseRecord["generatedVideos"];
    if (!Array.isArray(generated)) return record;

    for (let i = 0; i < generated.length; i++) {
      const item = generated[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const itemRecord = item as Record<string, unknown>;
      const video = itemRecord["video"];
      if (!video || typeof video !== "object" || Array.isArray(video)) continue;

      const videoRecord = video as Record<string, unknown>;
      const download = downloadsByIndex.get(i);

      if (opts.responseFormat === "url") {
        if (download) {
          videoRecord["uri"] = download.uri;
          videoRecord["mimeType"] = download.mimeType;
        }
        delete videoRecord["videoBytes"];
      } else {
        const existingBytes = videoRecord["videoBytes"];
        if (typeof existingBytes === "string") {
          videoRecord["videoBytes"] = existingBytes.replace(/\s/g, "");
        } else if (download) {
          const buffer = await fs.promises.readFile(download.filePath);
          videoRecord["videoBytes"] = buffer.toString("base64");
          videoRecord["mimeType"] = download.mimeType;
        }
        delete videoRecord["uri"];
      }
    }

    return record;
  }

  server.registerTool(
    "google-videos-generate",
    {
      title: "Google Videos Generate",
      description:
        "Generate videos using Google GenAI (Veo). Can optionally wait for completion and download generated videos to MEDIA_GEN_DIRS.",
      inputSchema: googleVideosGenerateSchema.shape,
      annotations: openaiToolAnnotations,
    },
    async (args: GoogleVideosGenerateArgs) => {
      try {
        const toolLog = log.child("google-videos-generate");
        toolLog.debug("raw args", { args: summarizeArgsForLog(args) });
        const validated = googleVideosGenerateSchema.parse(args);

        const ai = getGoogleGenAIClient("google-videos-generate");

        const prompt = typeof validated.prompt === "string" ? validated.prompt.trim() : undefined;
        const model = validated.model ?? "veo-3.1-generate-001";

        const config: {
          numberOfVideos?: number;
          aspectRatio?: string;
          durationSeconds?: number;
          personGeneration?: string;
        } = {};

        if (typeof validated.number_of_videos === "number") config.numberOfVideos = validated.number_of_videos;
        if (validated.aspect_ratio) config.aspectRatio = validated.aspect_ratio;
        if (typeof validated.duration_seconds === "number") config.durationSeconds = validated.duration_seconds;
        if (validated.person_generation) config.personGeneration = validated.person_generation;

        const params: {
          model: string;
          prompt?: string;
          image?: { imageBytes: string; mimeType?: string };
          video?: Video;
          config?: typeof config;
        } = { model, ...(prompt ? { prompt } : {}), ...(Object.keys(config).length > 0 ? { config } : {}) };

        if (validated.input_reference) {
          const loaded = await loadImageBufferFromReferenceForGoogleVideo(validated.input_reference, {
            mimeTypeOverride: validated.input_reference_mime_type,
            toolName: "google-videos-generate",
          });
          params.image = {
            imageBytes: loaded.buffer.toString("base64"),
            mimeType: loaded.mimeType,
          };
        }

        if (validated.input_video_reference) {
          const loaded = await loadVideoBufferFromReferenceForGoogleVideo(validated.input_video_reference, {
            toolName: "google-videos-generate",
          });
          params.video = {
            videoBytes: loaded.buffer.toString("base64"),
            mimeType: loaded.mimeType,
          };
        }

	        const operation = await ai.models.generateVideos(params);
	        const operationName = operation.name ?? "<unknown>";
	        const responseFormat = validated.response_format ?? "url";

        toolLog.info("operation started", { operation_name: operationName });
        toolLog.debug("google response", { operation });

	        if (!validated.wait_for_completion) {
	          const structuredContent = await buildGoogleVideosStructuredContent({ operation, responseFormat });
	          return {
	            content: [
	              { type: "text", text: `operation_name=${operationName}` },
	              { type: "text", text: `Started Google video operation: ${operationName}` },
	              { type: "text", text: JSON.stringify(summarizeArgsForLog(operation), null, 2) },
	            ],
	            structuredContent,
	          };
	        }

        const finalOperation = await waitForGoogleVideosCompletion({
          ai,
          operation,
          timeoutMs: validated.timeout_ms ?? 900000,
          pollIntervalMs: validated.poll_interval_ms ?? 10000,
          toolName: "google-videos-generate",
        });
        const finalOperationName = finalOperation.name ?? operationName;
        toolLog.info("operation done", {
          operation_name: finalOperationName,
          done: finalOperation.done ?? true,
          generated_videos: finalOperation.response?.generatedVideos?.length ?? 0,
        });
        toolLog.debug("google response (final)", { operation: finalOperation });

	        const downloadWhenDone = validated.download_when_done ?? true;
	        const toolResult = validated.tool_result ?? "resource_link";
	        const generated = finalOperation.response?.generatedVideos ?? [];

        const content: ContentBlock[] = [
          { type: "text", text: `Google video operation completed: ${finalOperationName}` },
        ];

	        const downloads: Array<{ index: number; uri: string; mimeType: string; file: string }> = [];
	        const downloadsForStructured: Array<{ index: number; uri: string; mimeType: string; filePath: string }> = [];

        if (downloadWhenDone) {
          const basePath = resolveVideoBaseOutputPath(undefined, "google-videos-generate", finalOperationName);
          await validateOutputDirectory(basePath);

          const videos = generated
            .map((item) => item.video)
            .filter((video): video is Video => !!video);

          if (videos.length === 0) {
            throw new Error("No generated videos to download");
          }

	          for (let i = 0; i < videos.length; i++) {
	            const downloaded = await downloadGoogleVideoToFile({
	              toolName: "google-videos-generate",
	              basePath,
	              index: i,
	              total: videos.length,
	              video: videos[i]!,
	            });
	            if (toolResult === "resource") {
	              content.push(
	                await buildEmbeddedResourceFromFile({
	                  filePath: downloaded.filePath,
	                  uri: downloaded.uri,
	                  mimeType: downloaded.mimeType,
	                }),
	              );
	            } else {
	              content.push(downloaded.resourceLink);
	            }
	            downloads.push({
	              index: i,
	              uri: downloaded.uri,
	              mimeType: downloaded.mimeType,
	              file: `file://${downloaded.filePath}`,
	            });
	            downloadsForStructured.push({
	              index: i,
	              uri: downloaded.uri,
	              mimeType: downloaded.mimeType,
	              filePath: downloaded.filePath,
	            });
	          }

          toolLog.info("downloads complete", { operation_name: finalOperationName, downloads });
        }

        content.push({
          type: "text",
          text: JSON.stringify({ operation_name: finalOperationName, generated_videos: generated.length, downloads }, null, 2),
        });
        content.push({ type: "text", text: JSON.stringify(summarizeArgsForLog(finalOperation), null, 2) });

	        const structuredContent = await buildGoogleVideosStructuredContent({
	          operation: finalOperation,
	          responseFormat,
	          downloads: downloadsForStructured,
	        });

	        return {
	          content,
	          structuredContent,
	        };
      } catch (err) {
        return buildErrorResult(err, "google-videos-generate");
      }
    },
  );

  server.registerTool(
    "google-videos-retrieve-operation",
    {
      title: "Google Videos Retrieve Operation",
      description: "Retrieve the status/result of a Google video generation operation (response_format=url|b64_json controls uri vs videoBytes in structuredContent).",
      inputSchema: googleVideosRetrieveOperationSchema.shape,
      annotations: openaiToolAnnotations,
    },
    async (args: GoogleVideosRetrieveOperationArgs) => {
      try {
        const toolLog = log.child("google-videos-retrieve-operation");
        toolLog.debug("raw args", { args: summarizeArgsForLog(args) });
	        const validated = googleVideosRetrieveOperationSchema.parse(args);
	        const responseFormat = validated.response_format ?? "url";
	        const ai = getGoogleGenAIClient("google-videos-retrieve-operation");

        const op = createGoogleVideosOperation(validated.operation_name);
        const latest = await ai.operations.getVideosOperation({ operation: op });

        const summary = {
          operation_name: latest.name ?? validated.operation_name,
          done: latest.done ?? false,
          has_error: !!latest.error,
          generated_videos: latest.response?.generatedVideos?.length ?? 0,
        };

	        toolLog.info("retrieved", summary);
	        toolLog.debug("google response", { operation: latest });

	        const structuredContent = await buildGoogleVideosStructuredContent({ operation: latest, responseFormat });

	        return {
	          content: [
	            { type: "text", text: JSON.stringify(summary, null, 2) },
	            { type: "text", text: JSON.stringify(summarizeArgsForLog(latest), null, 2) },
	          ],
	          structuredContent,
	        };
      } catch (err) {
        return buildErrorResult(err, "google-videos-retrieve-operation");
      }
    },
  );

  server.registerTool(
    "google-videos-retrieve-content",
    {
      title: "Google Videos Retrieve Content",
      description:
        "Download generated video content for a completed Google video operation, write it under MEDIA_GEN_DIRS, and return content blocks (tool_result=resource_link|resource).",
      inputSchema: googleVideosRetrieveContentSchema.shape,
      annotations: openaiToolAnnotations,
    },
    async (args: GoogleVideosRetrieveContentArgs) => {
      try {
        const toolLog = log.child("google-videos-retrieve-content");
        toolLog.debug("raw args", { args: summarizeArgsForLog(args) });
	        const validated = googleVideosRetrieveContentSchema.parse(args);
	        const responseFormat = validated.response_format ?? "url";
	        const ai = getGoogleGenAIClient("google-videos-retrieve-content");

        const op = createGoogleVideosOperation(validated.operation_name);
        const latest = await ai.operations.getVideosOperation({ operation: op });

        if (!latest.done) {
          throw new Error(`Operation is not done yet: ${latest.name ?? validated.operation_name}`);
        }
        if (latest.error) {
          throw new Error(`Operation failed: ${JSON.stringify(latest.error)}`);
        }

        const generated = latest.response?.generatedVideos ?? [];
        const videos = generated
          .map((item) => item.video)
          .filter((video): video is Video => !!video);

        if (videos.length === 0) {
          throw new Error("No generated videos found on operation response");
        }

        const index = validated.index ?? 0;
        if (index < 0 || index >= videos.length) {
          throw new Error(`index out of range: ${index} (available: 0..${videos.length - 1})`);
        }

        const basePath = resolveVideoBaseOutputPath(undefined, "google-videos-retrieve-content", latest.name ?? validated.operation_name);
        await validateOutputDirectory(basePath);

	        const downloaded = await downloadGoogleVideoToFile({
	          toolName: "google-videos-retrieve-content",
	          basePath,
	          index,
	          total: videos.length,
	          video: videos[index]!,
	        });
	        const toolResult = validated.tool_result ?? "resource_link";

        const summary = {
          operation_name: latest.name ?? validated.operation_name,
          index,
          uri: downloaded.uri,
          file: `file://${downloaded.filePath}`,
        };

	        toolLog.info("downloaded", summary);
	        toolLog.debug("google response", { operation: latest });

	        const structuredContent = await buildGoogleVideosStructuredContent({
	          operation: latest,
	          responseFormat,
	          downloads: [
	            {
	              index,
	              uri: downloaded.uri,
	              mimeType: downloaded.mimeType,
	              filePath: downloaded.filePath,
	            },
	          ],
	        });

	        return {
	          content: [
	            toolResult === "resource"
	              ? await buildEmbeddedResourceFromFile({
	                  filePath: downloaded.filePath,
	                  uri: downloaded.uri,
	                  mimeType: downloaded.mimeType,
	                })
	              : downloaded.resourceLink,
	            { type: "text", text: JSON.stringify(summary, null, 2) },
	            { type: "text", text: JSON.stringify(summarizeArgsForLog(latest), null, 2) },
	          ],
	          structuredContent,
	        };
      } catch (err) {
        return buildErrorResult(err, "google-videos-retrieve-content");
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // fetch-images: Fetch and process images from URLs or local files
  // ═══════════════════════════════════════════════════════════════════════════

  // Helper: resolve a source (URL or path) to an existing local file under
  // MEDIA_GEN_DIRS, when possible. Used to reuse existing files (without
  // creating copies) for fetch-images when no compression is requested.
  function resolveSourceToLocalPathIfExisting(source: string): string | undefined {
    if (isHttpUrl(source)) {
      for (let i = 0; i < publicUrlPrefixes.length; i++) {
        const prefixRaw = publicUrlPrefixes[i];
        const root = normalizedBaseDirs[i];
        if (!prefixRaw || !root) continue;
        const prefix = prefixRaw.replace(/\/$/, "");
        if (!source.startsWith(prefix + "/")) continue;
        const relativeUrlPath = source.slice(prefix.length + 1);
        if (!relativeUrlPath) continue;
        const candidate = path.resolve(root, relativeUrlPath.split("/").join(path.sep));
        if (!isPathInAllowedDirs(candidate)) continue;
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
      return undefined;
    }

    const candidate = resolvePathInPrimaryRoot(source);
    if (!isPathInAllowedDirs(candidate)) return undefined;
    if (!fs.existsSync(candidate)) return undefined;
    return candidate;
  }

  const fetchImagesSchema = z.object({
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
      annotations: localToolAnnotations,
    },
    async (args: FetchImagesArgs) => {
      try {
        debugLogRawArgs("fetch-images", args);
        const { sources, ids, n, compression, tool_result = "resource_link", response_format, file } = fetchImagesSchema.parse(args);

        const hasSources = Array.isArray(sources) && sources.length > 0;
        const hasIds = Array.isArray(ids) && ids.length > 0;
        const hasN = typeof n === "number";
        if (hasSources && hasN) throw new Error("'sources' and 'n' are mutually exclusive");
        if (hasSources && hasIds) throw new Error("'sources' and 'ids' are mutually exclusive");
        if (hasIds && hasN) throw new Error("'ids' and 'n' are mutually exclusive");
        if (hasIds && typeof file === "string") throw new Error("'file' is not supported when using 'ids' (no new files are created)");
        if (hasIds && compression) throw new Error("'compression' is not supported when using 'ids' (returns existing files as-is)");

        let activeSources: string[] = [];

        if (hasN) {
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
        } else if (hasIds) {
          const root = primaryOutputDir;
          const imageExtensions = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
          const idList = ids ?? [];
          const resolved = await resolveFilesByIds({ rootDir: root, ids: idList, allowedExtensions: imageExtensions });
          activeSources = resolved.orderedFiles;
          if (activeSources.length === 0) {
            return {
              content: [{ type: "text", text: `No images found for ids in ${root}` }],
              isError: true,
            };
          }

          const results = await Promise.allSettled(
            activeSources.map(async (filePath) => {
              const image = await readAndProcessImage(filePath);
              const fileUri = `file://${filePath}`;
              const httpUrl = buildPublicUrlForFile(filePath) ?? "";
              const resourceLink: ResourceLink = {
                type: "resource_link",
                uri: fileUri,
                name: path.basename(filePath),
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

          if (resolved.missingIds.length > 0) {
            errors.push(...resolved.missingIds.map((id) => `No images found for id: ${id}`));
          }

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
            ? [{ type: "text", text: `Errors (${errors.length}):\n${errors.join("\n")}` }]
            : [];

          return buildImageToolResult(
            images,
            processedResult,
            revisedPromptItems,
            "fetch-images",
            tool_result,
            response_format,
          );
        } else if (hasSources) {
          activeSources = sources;
        } else {
          throw new Error("Either 'sources', 'ids', or 'n' must be provided");
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
          const localPath = resolveSourceToLocalPathIfExisting(source);
          if (!localPath) {
            return false;
          }
          const httpUrl = buildPublicUrlForFile(localPath);
          return !!httpUrl;
        });

        if (canReuseAll) {
          const results = await Promise.allSettled(
            activeSources.map(async (source) => {
              const resolvedSource = resolveSourceToLocalPathIfExisting(source);
              if (!resolvedSource) {
                throw new Error("Image source cannot be resolved to an allowed local path");
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

        const { effectiveFileOutput } = resolveOutputPath(images, response_format, file, "fetch-images");
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

  // ═══════════════════════════════════════════════════════════════════════════
  // fetch-videos: Fetch videos from URLs or local file paths
  // ═══════════════════════════════════════════════════════════════════════════

	  const fetchVideosSchema = z.object({
	    sources: z.array(z.string()).min(1).max(20).optional()
	      .describe("Array of video sources: HTTP(S) URLs or file paths (absolute or relative to the first MEDIA_GEN_DIRS entry). Max 20 videos. Mutually exclusive with 'n'."),
	    ids: z.array(safeIdSchema).min(1).max(50).optional()
	      .describe("Array of video IDs to fetch by filename match (looks for filenames containing _{id}_ or _{id}. under the primary MEDIA_GEN_DIRS[0] directory). Mutually exclusive with 'sources' and 'n'."),
	    n: z.number().int().min(1).max(50).optional()
	      .describe("When set, returns the last N video files from the primary MEDIA_GEN_DIRS[0] directory (most recently modified first). Mutually exclusive with 'sources'."),
	    tool_result: z.enum(["resource_link", "resource"]).default("resource_link")
	      .describe("Controls content[] shape: 'resource_link' (default) emits ResourceLink items, 'resource' emits EmbeddedResource blocks with base64 blob."),
	    file: z.string().optional()
	      .describe("Base path for output files (when downloading from URLs), absolute or relative to the first MEDIA_GEN_DIRS entry. If multiple videos are downloaded, an index suffix is added."),
	  });

  type FetchVideosArgs = z.input<typeof fetchVideosSchema>;

  function inferVideoMimeTypeFromExt(extWithDot: string): string {
    const ext = extWithDot.toLowerCase();
    if (ext === ".mp4") return "video/mp4";
    if (ext === ".webm") return "video/webm";
    if (ext === ".mov") return "video/quicktime";
    if (ext === ".m4v") return "video/x-m4v";
    if (ext === ".mkv") return "video/x-matroska";
    if (ext === ".avi") return "video/x-msvideo";
    return "application/octet-stream";
  }

  function inferVideoExtFromUrlOrContentType(url: string, contentType: string | undefined): string {
    const ct = normalizeContentType(contentType ?? null);
    if (ct === "video/mp4" || ct === "application/mp4") return ".mp4";
    if (ct === "video/webm") return ".webm";
    if (ct === "video/quicktime") return ".mov";

    const urlPath = (() => {
      try {
        return new URL(url).pathname;
      } catch {
        return url;
      }
    })();
    const ext = path.extname(urlPath);
    if (ext) return ext;
    return ".mp4";
  }

  function buildIndexedOutputPath(basePath: string, idx: number, extWithDot: string, total: number): string {
    const { dir, baseName } = splitPathForKnownExtension(basePath, KNOWN_VIDEO_FILE_EXTENSIONS);
    if (total > 1) {
      return path.join(dir, `${baseName}_${idx + 1}${extWithDot}`);
    }
    return path.join(dir, `${baseName}${extWithDot}`);
  }

  server.registerTool(
    "fetch-videos",
    {
      title: "Fetch Videos",
      description:
        "Fetch videos from URLs or local file paths. Returns MCP CallToolResult with content blocks (tool_result=resource_link|resource) and structuredContent listing resolved files/URLs.",
      inputSchema: fetchVideosSchema.shape,
      annotations: localToolAnnotations,
    },
	    async (args: FetchVideosArgs) => {
	      try {
	        debugLogRawArgs("fetch-videos", args);
	        const { sources, ids, n, tool_result = "resource_link", file } = fetchVideosSchema.parse(args);

        const hasSources = Array.isArray(sources) && sources.length > 0;
        const hasIds = Array.isArray(ids) && ids.length > 0;
        const hasN = typeof n === "number";
        if (hasSources && hasN) throw new Error("'sources' and 'n' are mutually exclusive");
        if (hasSources && hasIds) throw new Error("'sources' and 'ids' are mutually exclusive");
        if (hasIds && hasN) throw new Error("'ids' and 'n' are mutually exclusive");
        if (hasIds && typeof file === "string") throw new Error("'file' is not supported when using 'ids' (no new files are created)");

        const videoExtensions = [".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi"];

        let activeSources: string[] = [];
        let idLookupErrors: string[] = [];
        if (hasN) {
          if (process.env["MEDIA_GEN_MCP_ALLOW_FETCH_LAST_N_VIDEOS"] !== "true") {
            throw new Error("Fetching last N videos is disabled by MEDIA_GEN_MCP_ALLOW_FETCH_LAST_N_VIDEOS");
          }

          const root = primaryOutputDir;
          const entries = await fs.promises.readdir(root, { withFileTypes: true });
          const candidates: { path: string; mtimeMs: number }[] = [];

          for (const entry of entries) {
            if (!entry.isFile()) continue;
            if (!videoExtensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) continue;
            const absPath = path.resolve(root, entry.name);
            const stat = await fs.promises.stat(absPath);
            candidates.push({ path: absPath, mtimeMs: stat.mtimeMs });
          }

          candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
          activeSources = candidates.slice(0, n).map((c) => c.path);

          if (activeSources.length === 0) {
            return {
              content: [{ type: "text", text: `No videos found in ${root}` }],
              isError: true,
            };
          }
        } else if (hasIds) {
          const root = primaryOutputDir;
          const idList = ids ?? [];
          const resolved = await resolveFilesByIds({ rootDir: root, ids: idList, allowedExtensions: videoExtensions });
          activeSources = resolved.orderedFiles;
          idLookupErrors = resolved.missingIds.map((id) => `No videos found for id: ${id}`);
          if (activeSources.length === 0) {
            return {
              content: [{ type: "text", text: `No videos found for ids in ${root}` }],
              isError: true,
            };
          }
        } else if (hasSources) {
          activeSources = sources;
        } else {
          throw new Error("Either 'sources', 'ids', or 'n' must be provided");
        }

        const resolvedBasePath = file ? resolvePathInPrimaryRoot(file) : undefined;
        if (resolvedBasePath) {
          await validateOutputDirectory(resolvedBasePath);
        }

        const results = await Promise.allSettled(
          activeSources.map(async (source, idx) => {
            // 1) Prefer reuse of existing local files mapped from public URL prefixes (or direct paths)
            const mappedLocal = resolveSourceToLocalPathIfExisting(source);
            if (mappedLocal) {
              const ext = path.extname(mappedLocal).toLowerCase();
              if (!videoExtensions.includes(ext)) {
                throw new Error(`Unsupported video file extension: ${ext || "<none>"}`);
              }
              const httpUrl = buildPublicUrlForFile(mappedLocal);
              const fileUri = `file://${mappedLocal}`;
              const uri = httpUrl ?? fileUri;
              const resourceLink: ResourceLink = {
                type: "resource_link",
                uri,
                name: path.basename(mappedLocal),
                mimeType: inferVideoMimeTypeFromExt(ext),
              };
              return {
                source,
                filePath: mappedLocal,
                fileUri,
                uri,
                mimeType: resourceLink.mimeType ?? "application/octet-stream",
                resourceLink,
                downloaded: false,
              };
            }

            // 2) Download from URL
            if (!isHttpUrl(source)) {
              const resolvedSource = resolvePathInPrimaryRoot(source);
              if (!isPathInAllowedDirs(resolvedSource)) {
                throw new Error("Video path is outside allowed MEDIA_GEN_DIRS roots");
              }
              const ext = path.extname(resolvedSource).toLowerCase();
              if (!videoExtensions.includes(ext)) {
                throw new Error(`Unsupported video file extension: ${ext || "<none>"}`);
              }
              await fs.promises.stat(resolvedSource);

              const httpUrl = buildPublicUrlForFile(resolvedSource);
              const fileUri = `file://${resolvedSource}`;
              const uri = httpUrl ?? fileUri;
              const resourceLink: ResourceLink = {
                type: "resource_link",
                uri,
                name: path.basename(resolvedSource),
                mimeType: inferVideoMimeTypeFromExt(ext),
              };
              return {
                source,
                filePath: resolvedSource,
                fileUri,
                uri,
                mimeType: resourceLink.mimeType ?? "application/octet-stream",
                resourceLink,
                downloaded: false,
              };
            }

            if (!isUrlAllowedByEnv(source)) {
              throw new Error("Video URL is not allowed by MEDIA_GEN_URLS");
            }

            const { buffer, contentType } = await fetchBinaryFromUrl(source);
            const ext = inferVideoExtFromUrlOrContentType(source, contentType);
            const outPath = resolvedBasePath
              ? buildIndexedOutputPath(resolvedBasePath, idx, ext, activeSources.length)
              : path.join(primaryOutputDir, `${buildDefaultOutputBaseName({ methodName: "fetch-videos", id: crypto.randomUUID() })}${ext}`);

            await validateOutputDirectory(outPath);
            await fs.promises.writeFile(outPath, buffer);

            const httpUrl = buildPublicUrlForFile(outPath);
            const fileUri = `file://${outPath}`;
            const uri = httpUrl ?? fileUri;
            const mimeType = normalizeContentType(contentType ?? null) ?? inferVideoMimeTypeFromExt(ext);

            const resourceLink: ResourceLink = {
              type: "resource_link",
              uri,
              name: path.basename(outPath),
              mimeType,
            };

            return {
              source,
              filePath: outPath,
              fileUri,
              uri,
              mimeType,
              resourceLink,
              downloaded: true,
            };
          }),
        );

        const ok: Array<{
          source: string;
          uri: string;
          file: string;
          mimeType: string;
          name: string;
          downloaded: boolean;
        }> = [];
        const content: ContentBlock[] = [];
        const errors: string[] = [];

        errors.push(...idLookupErrors);

	        for (let i = 0; i < results.length; i++) {
	          const result = results[i];
	          if (result?.status === "fulfilled") {
	            if (tool_result === "resource") {
	              content.push(
	                await buildEmbeddedResourceFromFile({
	                  filePath: result.value.filePath,
	                  uri: result.value.uri,
	                  mimeType: result.value.mimeType,
	                }),
	              );
	            } else {
	              content.push(result.value.resourceLink);
	            }
	            ok.push({
	              source: result.value.source,
	              uri: result.value.uri,
	              file: result.value.fileUri,
	              mimeType: result.value.mimeType,
	              name: path.basename(result.value.filePath),
	              downloaded: result.value.downloaded,
	            });
	          } else if (result?.status === "rejected") {
	            const reason = result.reason;
	            const message = reason instanceof Error ? reason.message : String(reason);
	            errors.push(`[${i}] ${activeSources[i]}: ${message}`);
	          }
	        }

        if (ok.length === 0) {
          return {
            content: [{ type: "text", text: `All fetches failed:\n${errors.join("\n")}` }],
            isError: true,
          };
        }

        if (errors.length > 0) {
          content.push({ type: "text", text: `Errors (${errors.length}/${activeSources.length}):\n${errors.join("\n")}` });
        }

        const structured = {
          data: ok,
          ...(errors.length > 0 ? { errors } : {}),
        };
        content.push({ type: "text", text: JSON.stringify(structured, null, 2) });

        log.child("fetch-videos").info("processed", { success: ok.length, total: activeSources.length });

        return {
          content,
          structuredContent: toStructuredContentRecord(structured),
        };
      } catch (err) {
        return buildErrorResult(err, "fetch-videos");
      }
    },
  );

  // ---------------------------------------------------------------------------
  // test-images: Debug MCP result format with predictable sample images
  // ---------------------------------------------------------------------------
  // Enabled only when MEDIA_GEN_MCP_TEST_SAMPLE_DIR is set. Does NOT create new
  // files; instead it enumerates existing sample files and maps them into
  // placements so the MCP client behavior can be inspected.

  const testSampleDir = process.env["MEDIA_GEN_MCP_TEST_SAMPLE_DIR"];

  log.child("test-images").info("MEDIA_GEN_MCP_TEST_SAMPLE_DIR resolved", {
    isSet: !!testSampleDir,
    testSampleDir,
  });

  if (testSampleDir) {
    log.child("test-images").info("registering test-images", { testSampleDir });

    server.registerTool(
      "test-images",
      {
        title: "Test Images",
        description: `Debug MCP result format using existing sample files from ${testSampleDir}. Reads up to 10 images and returns MCP CallToolResult with content[] (ResourceLink or ImageContent based on tool_result param) and structuredContent (OpenAI ImagesResponse format with data[].url or data[].b64_json based on response_format param). No new files are created.`,
        inputSchema: testImagesSchema.shape,
        annotations: localToolAnnotations,
      },
      async (args: TestImagesArgs) => {
        try {
          debugLogRawArgs("test-images", args);
          const { tool_result = "resource_link", response_format = "url", compression } = testImagesSchema.parse(args);

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

          log.child("test-images").info("enumerated sample images", {
            count: imageFiles.length,
            tool_result,
            response_format,
          });

          return buildImageToolResult(
            images,
            processedResult,
            revisedPromptItems,
            "test-images",
            tool_result,
            response_format,
            mockApiResponse,
          );
        } catch (err) {
          return buildErrorResult(err, "test-images");
        }
      },
    );

    log.info("test-images enabled", { sample: testSampleDir });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
