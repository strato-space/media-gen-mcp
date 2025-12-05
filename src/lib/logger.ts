/**
 * Minimal structured logger for MCP servers.
 * - All output goes to stderr (stdout is reserved for MCP protocol)
 * - Log level controlled by MEDIA_GEN_MCP_LOG_LEVEL env var
 * - JSON mode via MEDIA_GEN_MCP_LOG_FORMAT=json
 */

type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

function parseLogLevel(raw: string | undefined): LogLevel {
  const normalized = raw?.toLowerCase();
  if (normalized && normalized in LEVELS) return normalized as LogLevel;
  return "info";
}

const minLevel = LEVELS[parseLogLevel(process.env["MEDIA_GEN_MCP_LOG_LEVEL"])];
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

function serializeData(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = serializeValue(value);
  }
  return result;
}

function formatMessage(lvl: LogLevel, scope: string, msg: string, data?: Record<string, unknown>): string {
  if (isJsonFormat()) {
    const serialized = data ? serializeData(data) : undefined;
    return JSON.stringify({ ts: new Date().toISOString(), level: lvl, scope, msg, ...serialized });
  }
  const prefix = `[${PREFIX}] [${lvl.toUpperCase()}]${scope ? ` [${scope}]` : ""}`;
  const suffix = data ? ` ${JSON.stringify(serializeData(data))}` : "";
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
