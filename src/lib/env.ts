import path from "node:path";
import os from "node:os";
import { log } from "./logger.js";

const logger = log.child("env");

// ═══════════════════════════════════════════════════════════════════════════════
// Parsing & Defaults
// ═══════════════════════════════════════════════════════════════════════════════

export function parseEnvList(value: string | undefined): string[] {
  return value?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
}

export function getDefaultRootDir(opts: { platform?: NodeJS.Platform; temp?: string; tmp?: string; osTmpdir?: string } = {}): string {
  if ((opts.platform ?? process.platform) === "win32") {
    const base = opts.temp ?? process.env["TEMP"] ?? opts.tmp ?? process.env["TMP"] ?? opts.osTmpdir ?? os.tmpdir();
    return path.join(base, "media-gen-mcp");
  }
  return "/tmp/media-gen-mcp";
}

// ═══════════════════════════════════════════════════════════════════════════════
// Glob Pattern Support
// ═══════════════════════════════════════════════════════════════════════════════

/** Convert glob pattern to RegExp. `*` = segment, `**` = any depth (including zero). */
function globToRegex(pattern: string, sep: string): RegExp {
  // Warn about dangerous trailing wildcards
  if (/[*]+$/.test(pattern) && !pattern.endsWith(sep)) {
    logger.warn(`pattern "${pattern}" ends with wildcard without trailing "${sep}" — may expose entire subtrees`);
  }
  // First replace globs with placeholders, then escape regex chars, then substitute
  const sepPat = sep === "/" ? "/" : "/\\\\";
  let result = pattern
    .replace(/\*\*\//g, "\0GLOBSTAR_SEP\0")
    .replace(/\*\*/g, "\0GLOBSTAR\0")
    .replace(/\*/g, "\0STAR\0");
  // Escape regex special chars
  result = result.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  // Substitute placeholders with regex patterns
  result = result
    .replace(/\0GLOBSTAR_SEP\0/g, `(?:[^${sepPat}]+[${sepPat}])*`)
    .replace(/\0GLOBSTAR\0/g, ".*")
    .replace(/\0STAR\0/g, `[^${sepPat}]*`);
  return new RegExp(`^${result}`);
}

function isGlob(s: string): boolean {
  return s.includes("*");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Directory Context
// ═══════════════════════════════════════════════════════════════════════════════

export function normalizeDirectories(dirs: string[], label: string): string[] {
  return dirs.map(dir => {
    const base = dir.split("*")[0] ?? dir;
    // Glob patterns must have an absolute base segment to avoid surprising matches
    if (isGlob(dir)) {
      if (!path.isAbsolute(base)) throw new Error(`${label} glob entries must have absolute base. Invalid: ${dir}`);
      return dir;
    }
    // Plain directories may be absolute or relative; resolve relative ones against CWD
    return path.resolve(dir);
  });
}

export interface AllowedDirContext {
  allowedDirRoots: string[];
  primaryOutputDir: string;
  isPathInAllowedDirs: (filePath: string) => boolean;
}

export function createAllowedDirContext(baseDirs: string[], extraDirs: string[] = []): AllowedDirContext {
  if (!baseDirs.length) throw new Error("At least one base directory must be provided");
  const allowedDirRoots = [...new Set([...baseDirs, ...extraDirs])];
  const primaryOutputDir = baseDirs[0]!;

  // Pre-compile matchers
  const matchers = allowedDirRoots.map(root =>
    isGlob(root) ? globToRegex(root, path.sep) : null
  );

  const isPathInAllowedDirs = (filePath: string): boolean => {
    const resolved = path.resolve(filePath);
    return allowedDirRoots.some((root, i) => {
      const regex = matchers[i];
      if (regex) return regex.test(resolved);
      // Exact prefix match
      const norm = path.resolve(root);
      return resolved === norm || resolved.startsWith(norm + path.sep);
    });
  };

  return { allowedDirRoots, primaryOutputDir, isPathInAllowedDirs };
}

// ═══════════════════════════════════════════════════════════════════════════════
// URL Prefix Checker
// ═══════════════════════════════════════════════════════════════════════════════

export function createUrlPrefixChecker(prefixes: string[]): (url: string) => boolean {
  if (!prefixes.length) return () => true;

  const matchers = prefixes.map(p => (isGlob(p) ? globToRegex(p, "/") : null));

  return (url: string) =>
    prefixes.some((prefix, i) => {
      const regex = matchers[i];
      return regex ? regex.test(url) : url.startsWith(prefix);
    });
}

export function mapFileToPublicUrl(
  filePath: string,
  baseDirs: string[],
  urlPrefixes: string[],
): string | undefined {
  if (!urlPrefixes.length || !baseDirs.length) return undefined;

  const absPath = path.resolve(filePath);

  for (let i = 0; i < baseDirs.length; i++) {
    const root = baseDirs[i];
    const prefix = urlPrefixes[i];
    if (!root || !prefix) continue;

    const relative = path.relative(root, absPath);
    if (
      relative &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative)
    ) {
      const normalizedPrefix = prefix.replace(/\/$/, "");
      const urlPath = relative.split(path.sep).join("/");
      return `${normalizedPrefix}/${urlPath}`;
    }
  }

  return undefined;
}
