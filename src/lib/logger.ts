/**
 * Minimal structured logger for MCP servers.
 * - All output goes to stderr (stdout is reserved for MCP protocol)
 * - Log level controlled by MEDIA_GEN_MCP_LOG_LEVEL env var
 * - JSON mode via MEDIA_GEN_MCP_LOG_FORMAT=json
 * - Optional truncation for selected string fields in structured log data:
 *   - Enabled by default; controlled via MEDIA_GEN_MCP_LOG_SANITIZE_IMAGES
 *   - Truncation limit configured by LOG_TRUNCATE_DATA_MAX (default: 64
 *     characters)
 *   - Field list configured in LOG_SANITIZE_KEYS (e.g. b64_json, base64,
 *     data, image_url)
 *   - LOG-ONLY: sanitization alters only serialized log data, never the
 *     underlying tool results or protocol payloads.
 */

type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

function parseLogLevel(raw: string | undefined): LogLevel {
  const normalized = raw?.toLowerCase();
  if (normalized && normalized in LEVELS) return normalized as LogLevel;
  return "info";
}

const minLevel = LEVELS[parseLogLevel(process.env["MEDIA_GEN_MCP_LOG_LEVEL"])];
const LOG_SANITIZE_IMAGES = (() => {
  const raw = process.env["MEDIA_GEN_MCP_LOG_SANITIZE_IMAGES"];
  if (!raw) return true; // default: sanitize on
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
})();

const LOG_TRUNCATE_DATA_MAX = 64;

const DEFAULT_LOG_SANITIZE_KEYS: string[] = ["image_url", "b64_json", "base64", "data", "imageBytes", "videoBytes", "blob"];

// Keys in structured log data that should be truncated to LOG_TRUNCATE_DATA_MAX
// when sanitization is enabled. Can be overridden via
// MEDIA_GEN_MCP_LOG_SANITIZE_KEYS (comma-separated list).
const LOG_SANITIZE_KEYS: string[] = (() => {
  const raw = process.env["MEDIA_GEN_MCP_LOG_SANITIZE_KEYS"];
  if (!raw) return DEFAULT_LOG_SANITIZE_KEYS;
  const keys = raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  return keys.length > 0 ? keys : DEFAULT_LOG_SANITIZE_KEYS;
})();

function isJsonFormat(): boolean {
  return process.env["MEDIA_GEN_MCP_LOG_FORMAT"] === "json";
}
const PREFIX = "media-gen-mcp";

function shouldLog(lvl: LogLevel): boolean {
  return LEVELS[lvl] >= minLevel;
}

/** Serialize Error objects properly for JSON output */
function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

// Reuse the same truncation strategy as debug/debug-call-raw.ts so logs do not
// get flooded with large base64 payloads.
function truncateString(value: unknown, max: number): unknown {
  if (typeof value !== "string") return value;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...(${value.length} chars)`;
}

// LOG-ONLY sanitizer: recursively truncates base64-like/image fields for
// human-readable logs. Never use this in business logic or protocol
// serialization because it deliberately alters payload contents.
function truncateImageLikeFields(obj: unknown): unknown {
  if (!LOG_SANITIZE_IMAGES) return obj;
  if (obj instanceof Error) return obj;
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => truncateImageLikeFields(item));
  }

  const input = obj as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    const shouldTruncate = LOG_SANITIZE_KEYS.includes(key);

    if (shouldTruncate && typeof value === "string") {
      // Truncate all configured string fields to a unified preview length
      result[key] = truncateString(value, LOG_TRUNCATE_DATA_MAX);
    } else {
      // Recurse into nested objects/arrays so that inner fields are truncated
      result[key] = truncateImageLikeFields(value);
    }
  }

  return result;
}

// LOG-ONLY serializer: prepares structured data for logging. It **may
// truncate** base64/image fields via truncateImageLikeFields and should never
// be used for protocol payloads or persistence.
function serializeLogData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized = truncateImageLikeFields(data) as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sanitized)) {
    result[key] = serializeValue(value);
  }
  return result;
}

function formatMessage(lvl: LogLevel, scope: string, msg: string, data?: Record<string, unknown>): string {
  if (isJsonFormat()) {
    const serialized = data ? serializeLogData(data) : undefined;
    return JSON.stringify({ ts: new Date().toISOString(), level: lvl, scope, msg, ...serialized });
  }
  const prefix = `[${PREFIX}] [${lvl.toUpperCase()}]${scope ? ` [${scope}]` : ""}`;
  const suffix = data ? ` ${JSON.stringify(serializeLogData(data))}` : "";
  return `${prefix} ${msg}${suffix}`;
}

function write(lvl: LogLevel, scope: string, msg: string, data?: Record<string, unknown>): void {
  if (!shouldLog(lvl)) return;
  console.error(formatMessage(lvl, scope, msg, data));
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

function createLogger(scope = ""): Logger {
  return {
    debug: (msg, data) => write("debug", scope, msg, data),
    info: (msg, data) => write("info", scope, msg, data),
    warn: (msg, data) => write("warn", scope, msg, data),
    error: (msg, data) => write("error", scope, msg, data),
    child: (childScope) => createLogger(scope ? `${scope}:${childScope}` : childScope),
  };
}

export const log = createLogger();
