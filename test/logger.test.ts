import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log } from "../src/lib/logger.js";

describe("logger", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("exports a default logger instance", () => {
    expect(log).toBeDefined();
    expect(typeof log.info).toBe("function");
    expect(typeof log.debug).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
    expect(typeof log.child).toBe("function");
  });

  it("creates child loggers with scoped names", () => {
    const child = log.child("test-scope");
    expect(child).toBeDefined();
    expect(typeof child.info).toBe("function");
  });

  it("logs messages to stderr via console.error", () => {
    log.info("test message");
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("test message");
  });

  it("includes scope in log output", () => {
    const child = log.child("my-tool");
    child.warn("warning message");
    const output = consoleSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("my-tool");
    expect(output).toContain("warning message");
  });

  it("supports structured data", () => {
    log.info("with data", { count: 42, name: "test" });
    const output = consoleSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("42");
  });

  it("serializes Error objects properly in JSON mode", () => {
    const prevFormat = process.env["MEDIA_GEN_MCP_LOG_FORMAT"];
    process.env["MEDIA_GEN_MCP_LOG_FORMAT"] = "json";

    const err = new Error("test error");
    log.error("failed", { error: err });
    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.error.message).toBe("test error");
    expect(parsed.error.name).toBe("Error");

    if (prevFormat === undefined) {
      delete process.env["MEDIA_GEN_MCP_LOG_FORMAT"];
    } else {
      process.env["MEDIA_GEN_MCP_LOG_FORMAT"] = prevFormat;
    }
  });

  it("handles undefined data without throwing", () => {
    expect(() => log.info("no data")).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("truncates configured keys to a 64-char preview in JSON mode", () => {
    const prevFormat = process.env["MEDIA_GEN_MCP_LOG_FORMAT"];
    process.env["MEDIA_GEN_MCP_LOG_FORMAT"] = "json";

    const long = "A".repeat(200);
    log.info("with base64", { b64_json: long });

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);

    expect(typeof parsed.b64_json).toBe("string");
    // Preview starts with first 64 chars and contains the total length suffix
    expect(parsed.b64_json.startsWith("A".repeat(64))).toBe(true);
    expect(parsed.b64_json).toContain("...(200 chars)");

    if (prevFormat === undefined) {
      delete process.env["MEDIA_GEN_MCP_LOG_FORMAT"];
    } else {
      process.env["MEDIA_GEN_MCP_LOG_FORMAT"] = prevFormat;
    }
  });

  it("respects MEDIA_GEN_MCP_LOG_SANITIZE_IMAGES=0 (no truncation)", async () => {
    const prevFormat = process.env["MEDIA_GEN_MCP_LOG_FORMAT"];
    const prevSanitize = process.env["MEDIA_GEN_MCP_LOG_SANITIZE_IMAGES"];
    const prevKeys = process.env["MEDIA_GEN_MCP_LOG_SANITIZE_KEYS"];

    process.env["MEDIA_GEN_MCP_LOG_FORMAT"] = "json";
    process.env["MEDIA_GEN_MCP_LOG_SANITIZE_IMAGES"] = "0";
    delete process.env["MEDIA_GEN_MCP_LOG_SANITIZE_KEYS"];

    vi.resetModules();
    const { log: freshLog } = await import("../src/lib/logger.js");

    const long = "A".repeat(200);
    freshLog.info("no sanitize", { b64_json: long });

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.b64_json).toBe(long);

    if (prevFormat === undefined) {
      delete process.env["MEDIA_GEN_MCP_LOG_FORMAT"];
    } else {
      process.env["MEDIA_GEN_MCP_LOG_FORMAT"] = prevFormat;
    }
    if (prevSanitize === undefined) {
      delete process.env["MEDIA_GEN_MCP_LOG_SANITIZE_IMAGES"];
    } else {
      process.env["MEDIA_GEN_MCP_LOG_SANITIZE_IMAGES"] = prevSanitize;
    }
    if (prevKeys === undefined) {
      delete process.env["MEDIA_GEN_MCP_LOG_SANITIZE_KEYS"];
    } else {
      process.env["MEDIA_GEN_MCP_LOG_SANITIZE_KEYS"] = prevKeys;
    }
  });

  it("uses MEDIA_GEN_MCP_LOG_SANITIZE_KEYS override for key selection", async () => {
    const prevFormat = process.env["MEDIA_GEN_MCP_LOG_FORMAT"];
    const prevSanitize = process.env["MEDIA_GEN_MCP_LOG_SANITIZE_IMAGES"];
    const prevKeys = process.env["MEDIA_GEN_MCP_LOG_SANITIZE_KEYS"];

    process.env["MEDIA_GEN_MCP_LOG_FORMAT"] = "json";
    process.env["MEDIA_GEN_MCP_LOG_SANITIZE_IMAGES"] = "1";
    process.env["MEDIA_GEN_MCP_LOG_SANITIZE_KEYS"] = "custom_field";

    vi.resetModules();
    const { log: freshLog } = await import("../src/lib/logger.js");

    const long = "A".repeat(200);
    freshLog.info("override keys", { b64_json: long, custom_field: long });

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);

    // b64_json is not in override list, should remain intact
    expect(parsed.b64_json).toBe(long);
    // custom_field is configured, should be truncated
    expect(typeof parsed.custom_field).toBe("string");
    expect(parsed.custom_field.startsWith("A".repeat(64))).toBe(true);
    expect(parsed.custom_field).toContain("...(200 chars)");

    if (prevFormat === undefined) {
      delete process.env["MEDIA_GEN_MCP_LOG_FORMAT"];
    } else {
      process.env["MEDIA_GEN_MCP_LOG_FORMAT"] = prevFormat;
    }
    if (prevSanitize === undefined) {
      delete process.env["MEDIA_GEN_MCP_LOG_SANITIZE_IMAGES"];
    } else {
      process.env["MEDIA_GEN_MCP_LOG_SANITIZE_IMAGES"] = prevSanitize;
    }
    if (prevKeys === undefined) {
      delete process.env["MEDIA_GEN_MCP_LOG_SANITIZE_KEYS"];
    } else {
      process.env["MEDIA_GEN_MCP_LOG_SANITIZE_KEYS"] = prevKeys;
    }
  });
});
