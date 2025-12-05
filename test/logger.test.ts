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
});
