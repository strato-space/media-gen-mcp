import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function callFetchImages(
  args: Record<string, unknown>,
  envOverrides: Record<string, string>,
): Promise<unknown> {
  const transport = new StdioClientTransport({
    command: "tsx",
    args: ["src/index.ts"],
    env: {
      ...(process.env as Record<string, string>),
      ...envOverrides,
    },
  });

  const client = new Client(
    { name: "fetch-images-integration-test", version: "0.2.0" },
    { capabilities: { tools: { listChanged: false } } },
  );

  await client.connect(transport);

  try {
    const result = await client.callTool({
      name: "fetch-images",
      arguments: args,
    });
    await client.close();
    return result;
  } catch (err) {
    await client.close();
    throw err;
  }
}

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_BASE64, "base64");

describe("fetch-images integration", () => {
  it("returns error when n is used but gating env is not true", async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "media-gen-mcp-int-"));

    const result = await callFetchImages(
      { n: 1 },
      {
        MEDIA_GEN_DIRS: tmpDir,
        MEDIA_GEN_MCP_URL_PREFIXES: "https://example.com/media",
      },
    );

    const res = result as { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
    expect(res.isError).toBe(true);
    const textBlock = res.content?.find((c) => c.type === "text");
    expect(textBlock?.text ?? "").toContain("Fetching last N images is disabled");

    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("reuses existing local files when n is set and compression is omitted", async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "media-gen-mcp-int-"));

    const first = path.join(tmpDir, "first.png");
    const second = path.join(tmpDir, "second.png");
    const third = path.join(tmpDir, "third.png");

    await fs.promises.writeFile(first, TINY_PNG_BUFFER);
    await fs.promises.writeFile(second, TINY_PNG_BUFFER);
    await fs.promises.writeFile(third, TINY_PNG_BUFFER);

    const now = Date.now() / 1000;
    await fs.promises.utimes(first, now - 30, now - 30);
    await fs.promises.utimes(second, now - 20, now - 20);
    await fs.promises.utimes(third, now - 10, now - 10);

    const result = await callFetchImages(
      { n: 2 },
      {
        MEDIA_GEN_DIRS: tmpDir,
        MEDIA_GEN_MCP_URL_PREFIXES: "https://example.com/media",
        MEDIA_GEN_MCP_ALLOW_FETCH_LAST_N_IMAGES: "true",
      },
    );

    const res = result as { isError?: boolean; structuredContent?: { data?: Array<{ url?: string }> } };
    expect(res.isError).not.toBe(true);

    const data = res.structuredContent?.data ?? [];
    const urls = data.map((d) => d.url).filter((u): u is string => typeof u === "string");

    expect(urls.length).toBe(2);
    const hasSecond = urls.some((u) => u.endsWith("second.png"));
    const hasThird = urls.some((u) => u.endsWith("third.png"));

    expect(hasSecond).toBe(true);
    expect(hasThird).toBe(true);

    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });
});
