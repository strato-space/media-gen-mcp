import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  parseEnvList,
  getDefaultRootDir,
  normalizeDirectories,
  createAllowedDirContext,
  createUrlPrefixChecker,
  mapFileToPublicUrl,
} from "../src/lib/env.js";

describe("env helpers", () => {
  describe("parseEnvList", () => {
    it("returns empty array for undefined/empty", () => {
      expect(parseEnvList(undefined)).toEqual([]);
      expect(parseEnvList("")).toEqual([]);
    });

    it("splits comma-separated entries and trims blanks", () => {
      expect(parseEnvList("/a,/b,/c")).toEqual(["/a", "/b", "/c"]);
      expect(parseEnvList("  /a ,, /b  ")).toEqual(["/a", "/b"]);
    });
  });

  describe("getDefaultRootDir", () => {
    it("returns POSIX default", () => {
      expect(getDefaultRootDir({ platform: "linux" })).toBe("/tmp/media-gen-mcp");
    });

    it("prefers TEMP on Windows", () => {
      expect(getDefaultRootDir({ platform: "win32", temp: "C:/Temp" }))
        .toBe(path.join("C:/Temp", "media-gen-mcp"));
    });

    it("falls back to TMP then osTmpdir on Windows", () => {
      expect(getDefaultRootDir({ platform: "win32", tmp: "D:/Tmp" }))
        .toBe(path.join("D:/Tmp", "media-gen-mcp"));
      expect(getDefaultRootDir({ platform: "win32", osTmpdir: "E:/Scratch" }))
        .toBe(path.join("E:/Scratch", "media-gen-mcp"));
    });
  });

  describe("normalizeDirectories", () => {
    it("resolves absolute and relative paths", () => {
      expect(normalizeDirectories(["/tmp", "/var/lib"], "TEST")).toEqual(["/tmp", "/var/lib"]);
      expect(normalizeDirectories(["relative", "./subdir"], "TEST")).toEqual([
        path.resolve("relative"),
        path.resolve("./subdir"),
      ]);
    });

    it("preserves glob patterns but requires absolute base", () => {
      expect(normalizeDirectories(["/home/*/media/"], "TEST")).toEqual(["/home/*/media/"]);
      expect(() => normalizeDirectories(["*/media/"], "TEST"))
        .toThrow("TEST glob entries must have absolute base");
    });
  });

  describe("createAllowedDirContext", () => {
    it("tracks allowed roots and validates membership", () => {
      const { allowedDirRoots, primaryOutputDir, isPathInAllowedDirs } = createAllowedDirContext(
        ["/tmp/root"],
        ["/tmp/extra"],
      );
      expect(allowedDirRoots).toEqual(["/tmp/root", "/tmp/extra"]);
      expect(primaryOutputDir).toBe("/tmp/root");
      expect(isPathInAllowedDirs("/tmp/root/file.png")).toBe(true);
      expect(isPathInAllowedDirs("/tmp/extra/subdir")).toBe(true);
      expect(isPathInAllowedDirs("/etc/passwd")).toBe(false);
    });

    it("supports single-segment glob (*)", () => {
      const { isPathInAllowedDirs } = createAllowedDirContext(["/home/*/media/"]);
      expect(isPathInAllowedDirs("/home/user1/media/file.png")).toBe(true);
      expect(isPathInAllowedDirs("/home/admin/media/sub/file.png")).toBe(true);
      expect(isPathInAllowedDirs("/home/user1/other/file.png")).toBe(false);
      // * should not cross directory boundaries
      expect(isPathInAllowedDirs("/home/a/b/media/file.png")).toBe(false);
    });

    it("supports multi-segment glob (**)", () => {
      const { isPathInAllowedDirs } = createAllowedDirContext(["/data/**/images/"]);
      expect(isPathInAllowedDirs("/data/images/file.png")).toBe(true);
      expect(isPathInAllowedDirs("/data/project/v1/images/file.png")).toBe(true);
      expect(isPathInAllowedDirs("/data/project/v1/docs/file.png")).toBe(false);
    });

    it("warns about dangerous trailing wildcards", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      createAllowedDirContext(["/home/user/*"]);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("may expose entire subtrees"));
      spy.mockRestore();
    });
  });

  describe("createUrlPrefixChecker", () => {
    it("allows any HTTP(S) URL when prefixes list is empty", () => {
      const checker = createUrlPrefixChecker([]);
      expect(checker("https://example.com/file")).toBe(true);
    });

    it("restricts URLs when prefixes are provided", () => {
      const checker = createUrlPrefixChecker(["https://allowed.com/static/", "http://cdn.local/"]);
      expect(checker("https://allowed.com/static/image.jpg")).toBe(true);
      expect(checker("http://cdn.local/asset.png")).toBe(true);
      expect(checker("https://malicious.example.com/file")).toBe(false);
    });

    it("supports subdomain wildcards", () => {
      const checker = createUrlPrefixChecker(["https://*.example.com/"]);
      expect(checker("https://cdn.example.com/file.png")).toBe(true);
      expect(checker("https://a.b.example.com/file.png")).toBe(true);
      expect(checker("https://evil.com/file.png")).toBe(false);
    });

    it("supports path wildcards", () => {
      const checker = createUrlPrefixChecker(["https://cdn.example.com/**/images/"]);
      expect(checker("https://cdn.example.com/images/file.png")).toBe(true);
      expect(checker("https://cdn.example.com/v1/v2/images/file.png")).toBe(true);
      expect(checker("https://cdn.example.com/docs/file.png")).toBe(false);
    });
  });

  describe("mapFileToPublicUrl", () => {
    it("returns undefined when no prefixes", () => {
      const result = mapFileToPublicUrl("/tmp/media/file.png", ["/tmp/media"], []);
      expect(result).toBeUndefined();
    });

    it("maps file inside first base dir to first prefix", () => {
      const baseDirs = ["/home/user/media", "/home/user/samples"];
      const prefixes = ["https://media.example.com/media", "https://media.example.com/samples"];
      const result = mapFileToPublicUrl("/home/user/media/author.jpg", baseDirs, prefixes);
      expect(result).toBe("https://media.example.com/media/author.jpg");
    });

    it("maps file inside second base dir to second prefix", () => {
      const baseDirs = ["/home/user/media", "/home/user/samples"];
      const prefixes = ["https://media.example.com/media", "https://media.example.com/samples"];
      const result = mapFileToPublicUrl("/home/user/samples/author.jpg", baseDirs, prefixes);
      expect(result).toBe("https://media.example.com/samples/author.jpg");
    });

    it("returns undefined for paths outside all base dirs", () => {
      const baseDirs = ["/home/user/media", "/home/user/samples"];
      const prefixes = ["https://media.example.com/media", "https://media.example.com/samples"];
      const result = mapFileToPublicUrl("/etc/passwd", baseDirs, prefixes);
      expect(result).toBeUndefined();
    });
  });
});
