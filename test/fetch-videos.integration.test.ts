import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function callFetchVideos(
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
    { name: "fetch-videos-integration-test", version: "0.3.0" },
    { capabilities: { tools: { listChanged: false } } },
  );

  await client.connect(transport);

  try {
    const result = await client.callTool({
      name: "fetch-videos",
      arguments: args,
    });
    await client.close();
    return result;
  } catch (err) {
    await client.close();
    throw err;
  }
}

describe("fetch-videos integration", () => {
  it("returns error when n is used but gating env is not true", async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "media-gen-mcp-int-"));

    const result = await callFetchVideos(
      { n: 1 },
      {
        MEDIA_GEN_DIRS: tmpDir,
        MEDIA_GEN_MCP_URL_PREFIXES: "https://example.com/media",
      },
    );

    const res = result as { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
    expect(res.isError).toBe(true);
    const textBlock = res.content?.find((c) => c.type === "text");
    expect(textBlock?.text ?? "").toContain("Fetching last N videos is disabled");

    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("lists existing local videos when n is set", async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "media-gen-mcp-int-"));

    const first = path.join(tmpDir, "first.mp4");
    const second = path.join(tmpDir, "second.mp4");
    const third = path.join(tmpDir, "third.mp4");

    const dummyMp4 = Buffer.from("00000018667479706D703432", "hex");
    await fs.promises.writeFile(first, dummyMp4);
    await fs.promises.writeFile(second, dummyMp4);
    await fs.promises.writeFile(third, dummyMp4);

    const now = Date.now() / 1000;
    await fs.promises.utimes(first, now - 30, now - 30);
    await fs.promises.utimes(second, now - 20, now - 20);
    await fs.promises.utimes(third, now - 10, now - 10);

    const result = await callFetchVideos(
      { n: 2 },
      {
        MEDIA_GEN_DIRS: tmpDir,
        MEDIA_GEN_MCP_URL_PREFIXES: "https://example.com/media",
        MEDIA_GEN_MCP_ALLOW_FETCH_LAST_N_VIDEOS: "true",
      },
    );

    const res = result as { isError?: boolean; structuredContent?: { data?: Array<{ uri?: string }> } };
    expect(res.isError).not.toBe(true);

    const data = res.structuredContent?.data ?? [];
    const uris = data.map((d) => d.uri).filter((u): u is string => typeof u === "string");

    expect(uris.length).toBe(2);
    expect(uris.some((u) => u.endsWith("second.mp4"))).toBe(true);
    expect(uris.some((u) => u.endsWith("third.mp4"))).toBe(true);

    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("fetches existing local videos by ids", async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "media-gen-mcp-int-"));

    const id1 = "video_123";
    const id2 = "video_456";
    const first = path.join(tmpDir, `output_100_media-gen__openai-videos-create_${id1}.mp4`);
    const second = path.join(tmpDir, `output_101_media-gen__openai-videos-create_${id2}_video.mp4`);

    const dummyMp4 = Buffer.from("00000018667479706D703432", "hex");
    await fs.promises.writeFile(first, dummyMp4);
    await fs.promises.writeFile(second, dummyMp4);

    const result = await callFetchVideos(
      { ids: [id1, id2] },
      {
        MEDIA_GEN_DIRS: tmpDir,
        MEDIA_GEN_MCP_URL_PREFIXES: "https://example.com/media",
      },
    );

    const res = result as { isError?: boolean; structuredContent?: { data?: Array<{ uri?: string }> } };
    expect(res.isError).not.toBe(true);

    const data = res.structuredContent?.data ?? [];
    const uris = data.map((d) => d.uri).filter((u): u is string => typeof u === "string");

    expect(uris.some((u) => u.endsWith(path.basename(first)))).toBe(true);
    expect(uris.some((u) => u.endsWith(path.basename(second)))).toBe(true);

    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });
});
