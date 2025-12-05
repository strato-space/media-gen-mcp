# media-gen-mcp

<p align="center">
  <a href="https://www.npmjs.com/package/media-gen-mcp"><img src="https://img.shields.io/npm/v/media-gen-mcp?label=media-gen-mcp&color=brightgreen" alt="media-gen-mcp"></a>
  <a href="https://www.npmjs.com/package/@modelcontextprotocol/sdk"><img src="https://img.shields.io/npm/v/@modelcontextprotocol/sdk?label=MCP%20SDK&color=blue" alt="MCP SDK"></a>
  <a href="https://www.npmjs.com/package/openai"><img src="https://img.shields.io/npm/v/openai?label=OpenAI%20SDK&color=blueviolet" alt="OpenAI SDK"></a>
  <a href="https://github.com/punkpeye/mcp-proxy"><img src="https://img.shields.io/github/stars/punkpeye/mcp-proxy?label=mcp-proxy&style=social" alt="mcp-proxy"></a>
  <a href="https://github.com/yjacquin/fast-mcp"><img src="https://img.shields.io/github/stars/yjacquin/fast-mcp?label=fast-mcp&style=social" alt="fast-mcp"></a>
  <a href="https://github.com/strato-space/media-gen-mcp/blob/main/LICENSE"><img src="https://img.shields.io/github/license/strato-space/media-gen-mcp?color=brightgreen" alt="License"></a>
  <a href="https://github.com/strato-space/media-gen-mcp/stargazers"><img src="https://img.shields.io/github/stars/strato-space/media-gen-mcp?style=social" alt="GitHub stars"></a>
  <a href="https://github.com/strato-space/media-gen-mcp/actions"><img src="https://img.shields.io/github/actions/workflow/status/strato-space/media-gen-mcp/main.yml?label=build&logo=github" alt="Build Status"></a>
</p>

---

A Model Context Protocol (MCP) tool server for OpenAI's gpt-image-1 image generation and editing API, with ongoing work towards DALL·E support.

**Design principle:** spec-first, type-safe image tooling – strict OpenAI Images API + MCP compliance with fully static TypeScript types and flexible result placements/response formats for different clients.

- **Generate images** from text prompts using OpenAI's `gpt-image-1` model (with DALL·E support planned in future versions).
- **Edit images** (inpainting, outpainting, compositing) from 1 up to 16 images at once, with advanced prompt control.
- **Fetch & compress images** from HTTP(S) URLs or local file paths with smart size/quality optimization.
- **Debug MCP output shapes** with a test tool that mirrors production result placement (`content`, `structuredContent`, `toplevel`).
- **Integrates with**: [fast-agent](https://github.com/strato-space/fast-agent), [Windsurf](https://windsurf.com), [Claude Desktop](https://www.anthropic.com/claude/desktop), [Cursor](https://cursor.com), [VS Code](https://code.visualstudio.com/), and any MCP-compatible client.

---

## ✨ Features

- **Strict MCP spec support**  
  Tool outputs are first-class [`CallToolResult`](https://github.com/modelcontextprotocol/spec/blob/main/schema/2025-11-25/schema.json) objects from the latest MCP schema, including:
  `content` items (`text`, `image`, `resource_link`), optional `structuredContent`, optional top-level `files`, and the `isError` flag for failures.

- **Full gpt-image-1 parameter coverage (generate & edit)**  
  - `openai-images-generate` mirrors the OpenAI Images *generate* API for `gpt-image-1` (background, moderation, size, quality, output_format, output_compression, `n`, `user`, etc.).
  - `openai-images-edit` mirrors the OpenAI Images [`createEdit`](https://platform.openai.com/docs/api-reference/images/createEdit) API for `gpt-image-1` (image, mask, `n`, quality, size, `user`).

- **Fetch and process images from URLs or files**  
  `fetch-images` tool loads images from HTTP(S) URLs or local file paths with optional, user-controlled compression (disabled by default). Supports parallel processing of up to 20 images.

- **Mix and edit up to 16 images**  
  `openai-images-edit` accepts `image` as a single string or an array of 1–16 file paths/base64 strings, matching the OpenAI spec for `gpt-image-1` image edits.

- **Smart image compression**  
  Built-in compression using [sharp](https://sharp.pixelplumbing.com/) — iteratively reduces quality and dimensions to fit MCP payload limits while maintaining visual quality.

- **Resource-aware file output with `resource_link`**  
  - Automatic switch from inline base64 to `file` when the total response size exceeds a safe threshold.
  - Images are written to disk with GUID-based filenames and consistent extensions, and exposed to MCP clients as `resource_link` or `image` items in `content[]` depending on `tool_result`, with OpenAI ImagesResponse format in `structuredContent`.

- **Built-in test tool for MCP client debugging**  
  `test-tool` reads sample images from a configured directory and returns them using the same result-building logic as production tools. Use `tool_result` and `response_format` parameters to test how different MCP clients handle `content[]` and `structuredContent`.

- **Structured MCP error handling**  
  All tool errors (validation, OpenAI API failures, I/O) are returned as MCP errors with
  `isError: true` and `content: [{ type: "text", text: <error message> }]`, making failures easy to parse and surface in MCP clients.

---

## 🚀 Installation

```sh
git clone https://github.com/strato-space/media-gen-mcp.git
cd media-gen-mcp

npm install
npm run build
```

Build modes:

- `npm run build` – strict TypeScript build with **all strict flags enabled**, including `skipLibCheck: false`. Incremental builds via `.tsbuildinfo` (~2-3s on warm cache).
- `npm run esbuild` – fast bundling via esbuild (no type checking, useful for rapid iteration).

### Development mode (no build required)

For development or when TypeScript compilation fails due to memory constraints:

```sh
npm run dev  # Uses tsx to run TypeScript directly
```

### Quality checks

```sh
npm run lint        # ESLint with typescript-eslint
npm run typecheck   # Strict tsc --noEmit
npm run test        # Unit tests (vitest)
npm run test:watch  # Watch mode for TDD
npm run ci          # lint + typecheck + test
```

### Unit tests

The project uses [vitest](https://vitest.dev/) for unit testing. Tests are located in `test/`.

**Covered modules:**

| Module | Tests | Description |
|--------|-------|-------------|
| `compression` | 12 | Image format detection, buffer processing, file I/O |
| `helpers` | 35 | URL/path validation, output resolution, result placement, resource links |
| `schemas` | 39 | Zod schema validation for all 4 tools, type inference |

**Test categories:**

- **compression** — `isCompressionAvailable`, `detectImageFormat`, `processBufferWithCompression`, `readAndProcessImage`
- **helpers** — `isHttpUrl`, `isAbsolutePath`, `isBase64Image`, `ensureDirectoryWritable`, `resolveOutputPath`, `getResultPlacement`, `buildResourceLinks`
- **schemas** — validation for `openai-images-generate`, `openai-images-edit`, `fetch-images`, `test-tool` inputs, boundary testing (prompt length, image count limits, path validation)

```sh
npm run test
# ✓ test/compression.test.ts (12 tests)
# ✓ test/helpers.test.ts (35 tests)
# ✓ test/schemas.test.ts (39 tests)
# Tests: 86 passed
```

### Run directly via npx (no local clone)

You can also run the server straight from a remote repo using `npx`:

```sh
npx -y github:strato-space/media-gen-mcp --env-file /path/to/media-gen.env
```

The `--env-file` argument tells the server which env file to load (e.g. when you keep secrets outside the cloned directory). The file should contain `OPENAI_API_KEY`, optional Azure variables, and any `MEDIA_GEN_MCP_*` settings.

---

## ⚡ Quick start (fast-agent & Windsurf)

### fast-agent

In fast-agent, MCP servers are configured in `fastagent.config.yaml` under the `mcp.servers` section (see the [fast-agent docs](https://github.com/strato-space/fast-agent)).

To add `media-gen-mcp` from GitHub via `npx` as an MCP server:

```yaml
# fastagent.config.yaml

mcp:
  servers:
    # your existing servers (e.g. fetch, filesystem, huggingface, ...)
    media-gen-mcp:
      command: "npx"
      args: ["-y", "github:strato-space/media-gen-mcp", "--env-file", "/path/to/media-gen.env"]
```

Put `OPENAI_API_KEY` and other settings into `media-gen.env` (see `.env.sample` in this repo).

### Windsurf

Add an MCP server that runs `media-gen-mcp` from GitHub via `npx` using the JSON format below (similar to Claude Desktop / VS Code):

```json
{
  "mcpServers": {
    "media-gen-mcp": {
      "command": "npx",
      "args": ["-y", "github:strato-space/media-gen-mcp", "--env-file", "/path/to/media-gen.env"]
    }
  }
}
```

---

## 🔑 Configuration

Add to your MCP client config (fast-agent, Windsurf, Claude Desktop, Cursor, VS Code):

```json
{
  "mcpServers": {
    "media-gen-mcp": {
      "command": "npx",
      "args": ["-y", "github:strato-space/media-gen-mcp"],
      "env": { "OPENAI_API_KEY": "sk-..." }
    }
  }
}
```

Also supports Azure deployments:

```json
{
  "mcpServers": {
    "media-gen-mcp": {
      "command": "npx",
      "args": ["-y", "github:strato-space/media-gen-mcp"],
      "env": {
        // "AZURE_OPENAI_API_KEY": "sk-...",
        // "AZURE_OPENAI_ENDPOINT": "my.endpoint.com",
        "OPENAI_API_VERSION": "2024-12-01-preview"
      }
    }
  }
}
```

Environment variables:

- Set `OPENAI_API_KEY` (and optionally `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `OPENAI_API_VERSION`) in the environment of the process that runs `node dist/index.js` (shell, systemd unit, Docker env, etc.).
- The server will **optionally** load a local `.env` file from its working directory if present (it does not override already-set environment variables).
- You can also pass `--env-file /path/to/env` when starting the server (including via `npx`); this file is loaded via `dotenv` before tools run, again without overriding already-set variables.

### Security and local file access

- **Allowed directories**: All tools are restricted to paths matching `MEDIA_GEN_DIRS`. If unset, defaults to `/tmp/media-gen-mcp` (or `%TEMP%/media-gen-mcp` on Windows).
- **Test samples**: `MEDIA_GEN_MCP_TEST_SAMPLE_DIR` adds a directory to the allowlist and enables the test tool.
- **Local reads**: `fetch-images` accepts file paths (absolute or relative). Relative paths are resolved against the first `MEDIA_GEN_DIRS` entry and must still match an allowed pattern.
- **Remote reads**: HTTP(S) fetches are filtered by `MEDIA_GEN_URLS` patterns. Empty = allow all.
- **Writes**: `openai-images-generate`, `openai-images-edit`, and `fetch-images` write under the first entry of `MEDIA_GEN_DIRS`. `test-tool` is read-only and does not create new files.

#### Glob patterns

Both `MEDIA_GEN_DIRS` and `MEDIA_GEN_URLS` support glob wildcards:

| Pattern | Matches | Example |
|---------|---------|---------|
| `*` | Any single segment (no `/`) | `/home/*/media/` matches `/home/user1/media/` |
| `**` | Any number of segments | `/data/**/images/` matches `/data/a/b/images/` |

URL examples:
```shell
MEDIA_GEN_URLS=https://*.cdn.example.com/,https://storage.example.com/**/assets/
```

Path examples:
```shell
MEDIA_GEN_DIRS=/home/*/media-gen/output/,/data/**/images/
```

⚠️ **Warning**: Trailing wildcards without a delimiter (e.g., `/home/user/*` or `https://cdn.com/**`) expose entire subtrees and trigger a console warning at startup.

#### Recommended mitigations

1. Run under a dedicated OS user with access only to allowed directories.
2. Keep allowlists minimal. Avoid `*` in home directories or system paths.
3. Use explicit `MEDIA_GEN_URLS` prefixes for remote fetches.
4. Monitor allowed directories via OS ACLs or backups.

### Tool Result Parameters: `tool_result` and `response_format`

All image tools support two parameters that control the shape of the MCP tool result:

| Parameter | Values | Default | Description |
|-----------|--------|---------|-------------|
| `tool_result` | `resource_link`, `image` | `resource_link` | Controls `content[]` shape |
| `response_format` | `url`, `b64_json` | `url` | Controls `structuredContent` shape (OpenAI ImagesResponse format) |

#### `tool_result` — controls `content[]`

- **`resource_link`** (default): Emits `ResourceLink` items with `file://` or `https://` URIs
- **`image`**: Emits base64 `ImageContent` blocks

#### `response_format` — controls `structuredContent`

`structuredContent` always contains an OpenAI ImagesResponse-style object:

```jsonc
{
  "created": 1234567890,
  "data": [
    { "url": "https://..." } // or { "b64_json": "..." } depending on response_format
  ]
}
```

- **`url`** (default): `data[].url` contains file URLs
- **`b64_json`**: `data[].b64_json` contains base64-encoded image data

#### Backward Compatibility (MCP 5.2.6)

Per MCP spec 5.2.6, a `TextContent` block with serialized JSON (always using URLs in `data[]`) is also included in `content[]` for backward compatibility with clients that don't support `structuredContent`.

Example tool result structure:

```jsonc
{
  "content": [
    // ResourceLink or ImageContent based on tool_result
    { "type": "resource_link", "uri": "https://...", "name": "image.png", "mimeType": "image/png" },
    // Serialized JSON for backward compatibility (MCP 5.2.6)
    { "type": "text", "text": "{ \"created\": 1234567890, \"data\": [{ \"url\": \"https://...\" }] }" }
  ],
  "structuredContent": {
    "created": 1234567890,
    "data": [{ "url": "https://..." }]
  }
}
```

**ChatGPT MCP client behavior (chatgpt.com, as of 2025-12-01):**

- ChatGPT currently ignores `content[]` image data in favor of `structuredContent`.
- For ChatGPT, use `response_format: "url"` and configure the first `MEDIA_GEN_MCP_URL_PREFIXES` entry as a public HTTPS prefix (for example `MEDIA_GEN_MCP_URL_PREFIXES=https://media-gen.example.com/media`).

For Anthropic clients (Claude Desktop, etc.), the default configuration works well.

### Network access via mcp-proxy (SSE)

For networked SSE access you can front `media-gen-mcp` with [`mcp-proxy`](https://github.com/modelcontextprotocol/servers/tree/main/src/proxy) or its equivalent. This setup has been tested with the TypeScript SSE proxy implementation [`punkpeye/mcp-proxy`](https://github.com/punkpeye/mcp-proxy).

For example, a one-line command looks like:

```sh
mcp-proxy --host=0.0.0.0 --port=99 --server=sse --sseEndpoint=/ --shell 'npx -y github:strato-space/media-gen-mcp --env-file /path/to/media-gen.env'
```

In production you would typically wire this up via a systemd template unit that loads `PORT`/`SHELL_CMD` from an `EnvironmentFile=` (see `server/mcp/mcp@.service` style setups).

---

## 🛠 Tool signatures

### openai-images-generate

Arguments (input schema):

- `prompt` (string, required)
  - Text prompt describing the desired image.
  - Max length: 32,000 characters.
- `background` ("transparent" | "opaque" | "auto", optional)
  - Background handling mode.
  - If `background` is `"transparent"`, then `output_format` must be `"png"` or `"webp"`.
- `model` (literal "gpt-image-1", optional, default: "gpt-image-1")
- `moderation` ("auto" | "low", optional)
  - Content moderation behavior, passed through to the Images API.
- `n` (integer, optional)
  - Number of images to generate.
  - Min: 1, Max: 10.
- `output_compression` (integer, optional)
  - Compression level (0–100).
  - Only applied when `output_format` is `"jpeg"` or `"webp"`.
- `output_format` ("png" | "jpeg" | "webp", optional)
  - Output image format.
  - If omitted, the server treats output as PNG semantics.
- `quality` ("auto" | "high" | "medium" | "low", default: "low")
- `size` ("1024x1024" | "1536x1024" | "1024x1536" | "auto", default: "1024x1024")
- `user` (string, optional)
  - User identifier forwarded to OpenAI for monitoring.
- `response_format` ("url" | "b64_json", default: "url")
  - Response format (aligned with OpenAI Images API):
    - `"url"`: file/URL-based output (resource_link items, `image_url` fields, `data[].url` in `api` placement).
    - `"b64_json"`: inline base64 image data (image content, `data[].b64_json` in `api` placement).
- `file` (string, optional)
  - Path to save the image file, **absolute or relative** to the first `MEDIA_GEN_DIRS` entry (or the default root).
  - When `n > 1`, an index suffix like `_1`, `_2` is appended to the filename.

Behavior notes:

- The server always uses OpenAI `gpt-image-1` under the hood.
- If the total size of all base64 images would exceed the configured payload
  threshold (default ~50MB via `MCP_MAX_CONTENT_BYTES`), the server
  automatically switches the **effective output mode** to file/URL-based and saves
  images to `file` or to the first entry of `MEDIA_GEN_DIRS` (default: `/tmp/media-gen-mcp`).
- Even when you explicitly request `response_format: "b64_json"`, the server still writes
  the files to disk (for static hosting, caching, or later reuse). Exposure of
  file paths / URLs in the tool result then depends on `MEDIA_GEN_MCP_RESULT_PLACEMENT`
  and per-call `result_placement` (see section below).

Output (MCP CallToolResult, when placement includes `"content"`):

- When the effective `output` mode is `"base64"`:
  - `content` is an array that may contain:
    - image items:
      - `{ type: "image", data: <base64 string>, mimeType: <"image/png" | "image/jpeg" | "image/webp"> }`
    - optional text items with revised prompts returned by the Images API (for models that support it, e.g. DALL·E 3):
      - `{ type: "text", text: <revised_prompt string> }`
- When the effective `output` mode is `"file"`:
  - `content` contains one `resource_link` item per file, plus the same optional `text` items with revised prompts:
    - `{ type: "resource_link", uri: "file:///absolute-path-1.png", name: "absolute-path-1.png", mimeType: <image mime> }`

When `result_placement` includes `"api"`, `openai-images-generate` instead returns an **OpenAI Images API-like object** without MCP wrappers:

```jsonc
{
  "created": 1764599500,
  "data": [
    { "b64_json": "..." } // or { "url": "https://.../media/file.png" } when output: "file"
  ],
  "background": "opaque",
  "output_format": "png",
  "size": "1024x1024",
  "quality": "high"
}
```

### openai-images-edit

Arguments (input schema):

- `image` (string or string[], required)
  - Either a single absolute path to an image file (`.png`, `.jpg`, `.jpeg`, `.webp`),
    a base64-encoded image string (optionally as a `data:image/...;base64,...` URL),
    **or an HTTP(S) URL** pointing to a publicly accessible image,
    **or** an array of 1–16 such strings (for multi-image editing).
  - When an HTTP(S) URL is provided, the server fetches the image and converts it to base64 before sending to OpenAI.
- `prompt` (string, required)
  - Text description of the desired edit.
  - Max length: 32,000 characters.
- `mask` (string, optional)
  - Absolute path, base64 string, or HTTP(S) URL for a mask image (PNG < 4MB, same dimensions
    as the source image). Transparent areas mark regions to edit.
- `model` (literal "gpt-image-1", optional, default: "gpt-image-1")
- `n` (integer, optional)
  - Number of images to generate.
  - Min: 1, Max: 10.
- `quality` ("auto" | "high" | "medium" | "low", default: "low")
- `size` ("1024x1024" | "1536x1024" | "1024x1536" | "auto", default: "1024x1024")
- `user` (string, optional)
  - User identifier forwarded to OpenAI for monitoring.
- `response_format` ("url" | "b64_json", default: "url")
  - Response format (aligned with OpenAI Images API):
    - `"url"`: file/URL-based output (resource_link items, `image_url` fields, `data[].url` in `api` placement).
    - `"b64_json"`: inline base64 image data (image content, `data[].b64_json` in `api` placement).
- `file` (string, optional)
  - Path where edited images will be written, **absolute or relative** to the first `MEDIA_GEN_DIRS` entry.
  - If multiple images are produced, an index suffix is appended before the
    extension (e.g. `_1.png`, `_2.png`).

Behavior notes:

- The server accepts `image` and `mask` as absolute paths, base64/data URLs, or HTTP(S) URLs.
- When an HTTP(S) URL is provided, the server fetches the image and converts it to a base64 data URL before calling OpenAI.
- For edits, the server always returns PNG semantics (mime type `image/png`)
  when emitting images.

Output (MCP CallToolResult):

- When the effective `output` mode is `"base64"`:
  - `content` is an array that may contain:
    - image items:
      - `{ type: "image", data: <base64 string>, mimeType: "image/png" }`
    - optional text items with revised prompts (when the underlying model returns them):
      - `{ type: "text", text: <revised_prompt string> }`
- When the effective `output` mode is `"file"`:
  - `content` contains one `resource_link` item per file, plus the same optional `text` items with revised prompts:
    - `{ type: "resource_link", uri: "file:///absolute-path-1.png", name: "absolute-path-1.png", mimeType: "image/png" }`

When `result_placement` includes `"api"`, `openai-images-edit` follows the **same raw API format** as `openai-images-generate` (top-level `created`, `data[]`, `background`, `output_format`, `size`, `quality` with `b64_json` for base64 output or `url` for file output).

Error handling (both tools):

- On errors inside the tool handler (validation, OpenAI API failures, I/O, etc.), the server returns a CallToolResult marked as an error:
  - `isError: true`
  - `content: [{ type: "text", text: <error message string> }]`
- The error message text is taken directly from the underlying exception message, without additional commentary from the server, while full details are logged to the server console.

### fetch-images

Fetch and process images from URLs or local file paths with optional compression.

Arguments (input schema):

- `sources` (string[], optional)
  - Array of image sources: HTTP(S) URLs or file paths (absolute or relative to the first `MEDIA_GEN_DIRS` entry).
  - Min: 1, Max: 20 images.
  - Mutually exclusive with `n`.
- `n` (integer, optional)
  - When set, returns the last N image files from the primary `MEDIA_GEN_DIRS[0]` directory.
  - Files are sorted by modification time (most recently modified first).
  - Mutually exclusive with `sources`.
- `compression` (object, optional)
  - `max_size` (integer, optional): Max dimension in pixels. Images larger than this will be resized.
  - `max_bytes` (integer, optional): Target max file size in bytes. Default: 819200 (800KB).
-  - `quality` (integer, optional): JPEG/WebP quality 1-100. Default: 85.
-  - `format` ("jpeg" | "png" | "webp", optional): Output format. Default: jpeg.
- `response_format` ("url" | "b64_json", default: "url")
  - Response format: file/URL-based (`url`) or inline base64 (`b64_json`).
- `file` (string, optional)
  - Base path for output files. If multiple images, index suffix is added.

Behavior notes:

- Images are processed in parallel for maximum throughput.
- Compression is **only** applied when `compression` options are provided.
- Compression uses [sharp](https://sharp.pixelplumbing.com/) with iterative quality/size reduction when enabled.
- Partial success: if some sources fail, successful images are still returned with errors listed in the response.
- When `n` is provided, it is only honored when the `MEDIA_GEN_MCP_ALLOW_FETCH_LAST_N_IMAGES` environment variable is set to `true`. Otherwise, the call fails with a validation error.
- Sometimes an MCP client (for example, ChargeGPT) may not wait for a response from `media-gen-mcp` due to a timeout. In creative environments where you need to quickly retrieve the latest `openai-images-generate` / `openai-images-edit` outputs, you can use `fetch-images` with the `n` argument. When the `MEDIA_GEN_MCP_ALLOW_FETCH_LAST_N_IMAGES=true` environment variable is set, `fetch-images` will return the last N files from `MEDIA_GEN_DIRS[0]` even if the original generation or edit operation timed out on the MCP client side.

### test-tool

Debug tool for testing MCP result placement without calling OpenAI API.

**Enabled only when `MEDIA_GEN_MCP_TEST_SAMPLE_DIR` is set**. The tool reads existing images from this directory and does **not** create new files.

Arguments (input schema):

- `response_format` ("url" | "b64_json", default: "url")
- `result_placement` ("content" | "api" | "structured" | "toplevel" or array of these, optional)
  - Override `MEDIA_GEN_MCP_RESULT_PLACEMENT` for this call.
- `compression` (object, optional)
  - Same logical tuning knobs as `fetch-images`, but using camelCase keys:
    - `maxSize` (integer, optional): max dimension in pixels.
    - `maxBytes` (integer, optional): target max file size in bytes.
    - `quality` (integer, optional): JPEG/WebP quality 1–100.
    - `format` ("jpeg" | "png" | "webp", optional): output format.

Behavior notes:

- Reads up to 10 images from the sample directory (no sorting — filesystem order).
- Uses the same result-building logic as `openai-images-generate` and `openai-images-edit` (including `result_placement` overrides).
- When `output == "base64"` and `compression` is provided, sample files are read and compressed **in memory** using `sharp`; original files on disk are never modified.
- Useful for testing how different MCP clients handle various result structures.

- When `result_placement` includes `"api"`, the tool returns a **mock OpenAI Images API-style object**:
  - Top level: `created`, `data[]`, `background`, `output_format`, `size`, `quality`.
  - For `response_format: "b64_json"` each `data[i]` contains `b64_json`.
  - For `response_format: "url"` each `data[i]` contains `url` instead of `b64_json`.

#### Debug CLI helpers for `test-tool`

For local debugging there are two helper scripts that call `test-tool` directly:

- `npm run test-tool` – uses `debug/debug-call.ts` and prints the validated
  `CallToolResult` as seen by the MCP SDK client. Usage:

  ```sh
  npm run test-tool -- [placement] [--response_format url|b64_json]
  # examples:
  # npm run test-tool -- structured --response_format b64_json
  # npm run test-tool -- structured --response_format url
  ```

- `npm run test-tool:raw` – uses `debug/debug-call-raw.ts` and prints the raw
  JSON-RPC `result` (the underlying `CallToolResult` without extra wrapping). Same
  CLI flags as above.

Both scripts truncate large fields for readability:

- `image_url` → first 80 characters, then `...(N chars)`;
- `b64_json` and `data` (when it is a base64 string) → first 25 characters, then `...(N chars)`.

---

## 🧩 Version policy

This repository aims to stay **closely aligned with current stable releases**:

- **MCP SDK**: targeting the latest stable `@modelcontextprotocol/sdk` and schema.
- **OpenAI SDK**: regularly updated to the latest stable `openai` package.
- **Zod**: using the Zod 4.x line (currently `^4.1.3`). In this project we previously ran on Zod 3.x and, in combination with the MCP TypeScript SDK typings, hit heavy TypeScript errors when passing `.shape` into `inputSchema` — in particular TS2589 (*"type instantiation is excessively deep and possibly infinite"*) and TS2322 (*schema shape not assignable to `AnySchema | ZodRawShapeCompat`*). We track the upstream discussion in [modelcontextprotocol/typescript-sdk#494](https://github.com/modelcontextprotocol/typescript-sdk/issues/494) and the related Zod typing work in [colinhacks/zod#5222](https://github.com/colinhacks/zod/pull/5222), and keep the stack on a combination that passes **full strict** compilation reliably.
- **Tooling stack** (Node.js, TypeScript, etc.): developed and tested against recent LTS / current releases, with a dedicated `tsconfig-strict.json` that enables all strict TypeScript checks (`strict`, `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, etc.).

You are welcome to pin or downgrade Node.js, TypeScript, the OpenAI SDK, Zod, or other pieces of the stack if your environment requires it, but please keep in mind:

- we primarily test and tune against the latest stack;
- issues that only reproduce on older runtimes / SDK versions may be harder for us to investigate and support;
- upstream compatibility is validated first of all against the latest MCP spec and OpenAI Images API.

This project is intentionally a bit **futuristic**: it tries to keep up with new capabilities as they appear in MCP and OpenAI tooling (in particular, robust multimodal/image support over MCP and in ChatGPT’s UI). A detailed real‑world bug report and analysis of MCP image rendering in ChatGPT is listed in the **References** section as a case study.

If you need a long-term-stable stack, pin exact versions in your own fork and validate them carefully in your environment.

---

## 🧩 Typed tool callbacks

All tool handlers use **strongly typed callback parameters** derived from Zod schemas via `z.input<typeof schema>`:

```typescript
// Schema definition
const openaiImagesGenerateBaseSchema = z.object({
  prompt: z.string().max(32000),
  background: z.enum(["transparent", "opaque", "auto"]).optional(),
  // ... more fields
});

// Type alias
type OpenAIImagesGenerateArgs = z.input<typeof openaiImagesGenerateBaseSchema>;

// Strictly typed callback
server.registerTool(
  "openai-images-generate",
  { inputSchema: openaiImagesGenerateBaseSchema.shape, ... },
  async (args: OpenAIImagesGenerateArgs, _extra: unknown) => {
    const validated = openaiImagesGenerateSchema.parse(args);
    // ... handler logic
  },
);
```

This pattern provides:

- **Static type safety** — IDE autocomplete and compile-time checks for all input fields.
- **Runtime validation** — Zod `.parse()` ensures all inputs match the schema before processing.
- **MCP SDK compatibility** — `inputSchema: schema.shape` provides the JSON Schema for tool registration.

All four tools (`openai-images-generate`, `openai-images-edit`, `fetch-images`, `test-tool`) follow this pattern.

---

## 🧩 Tool annotations

This MCP server exposes the following tools with annotation hints:

| Tool | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
|------|----------------|-------------------|------------------|-----------------|
| **openai-images-generate** | `true` | `false` | `false` | `true` |
| **openai-images-edit** | `true` | `false` | `false` | `true` |
| **fetch-images** | `true` | `false` | `false` | `true` |
| **test-tool** | `true` | `false` | `false` | `true` |

These hints help MCP clients understand that these tools:
- invoke external APIs or read external resources (open world),
- do not modify existing project files or user data; they only create new image files in configured output directories,
- may produce different outputs on each call, even with the same inputs.

Because `readOnlyHint` is set to `true` for most tools, MCP platforms (including chatgpt.com) can treat this server as logically read-only and usually will not show "this tool can modify your files" warnings.

---

## 📁 Project structure

```text
media-gen-mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   └── lib/
│       ├── compression.ts    # Image compression (sharp)
│       ├── helpers.ts        # URL/path validation, result building
│       └── schemas.ts        # Zod schemas for all tools
├── test/
│   ├── compression.test.ts   # 12 tests
│   ├── helpers.test.ts       # 35 tests
│   └── schemas.test.ts       # 39 tests
├── dist/                     # Compiled output
├── tsconfig.json
├── vitest.config.ts
├── package.json
├── README.md
└── AGENTS.md
```

---

## 📝 License

MIT

---

## 🩺 Troubleshooting

- Make sure your `OPENAI_API_KEY` is valid and has image API access.
- You must have a [verified OpenAI organization](https://platform.openai.com/account/organization). After verifying, it can take 15–20 minutes for image API access to activate.
- File paths [optional param] must be absolute.
  - **Unix/macOS/Linux**: Starting with `/` (e.g., `/path/to/image.png`)
  - **Windows**: Drive letter followed by `:` (e.g., `C:/path/to/image.png` or `C:\path\to\image.png`)
 - For file output, ensure the target directory is writable.
 - If you see errors about file types, check your image file extensions and formats.

---

## 🙏 Inspiration

This server was originally inspired by
[SureScaleAI/openai-gpt-image-mcp](https://github.com/SureScaleAI/openai-gpt-image-mcp),
but is now a separate implementation focused on **closely tracking the official
specifications**:

- **OpenAI Images API alignment** – The arguments for `openai-images-generate`
  and `openai-images-edit` mirror
  [`images.create` / `gpt-image-1`](https://platform.openai.com/docs/api-reference/images/create):
  `prompt`, `n`, `size`, `quality`, `background`, `output_format`,
  `output_compression`, `user`, plus `response_format` (`url` / `b64_json`) with
  the same semantics as the OpenAI Images API.
- **MCP Tool Result alignment (image + resource_link)** – With
  `result_placement = "content"`, the server follows the MCP **5.2 Tool Result**
  section
  ([5.2.2 Image Content](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#image-content),
  [5.2.4 Resource Links](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool-result))
  and emits strongly-typed `content[]` items:
  - `{ "type": "image", "data": "<base64>", "mimeType": "image/png" }` for
    `response_format = "b64_json"`;
  - `{ "type": "resource_link", "uri": "file:///..." | "https://...", "name": "...", "mimeType": "image/..." }`
    for file/URL-based output.
- **Raw OpenAI-style API output** – With `result_placement = "api"`, the tool
  result itself **is** an OpenAI Images-style object:
  `{ created, data: [...], background, output_format, size, quality, usage? }`,
  where each `data[]` entry contains either `b64_json` (for
  `response_format = "b64_json"`) or `url` (for `response_format = "url"`). No
  MCP wrapper fields (`content`, `structuredContent`, `files`, `urls`) are
  added in this mode.

In short, this library:

- tracks the OpenAI Images API for **arguments and result shape** when
  `result_placement = "api"` with `response_format = "url" | "b64_json"`, and
- follows the MCP specification for **tool result content blocks** (`image`,
  `resource_link`, `text`) when `result_placement = "content"`.

### Recommended presets for common clients

- **Default mode / Claude Desktop / strict MCP clients**  
  For clients that strictly follow the MCP spec, the recommended (and natural)
  configuration is:
  - `result_placement = content`
  - `response_format = b64_json`

  In this mode the server returns:
  - `content[]` with `type: "image"` (base64 image data) and
    `type: "resource_link"` (file/URL links), matching MCP section 5.2 (Image
    Content and Resource Links). This output works well for **direct
    integration** with Claude Desktop and any client that fully implements the
    2025‑11‑25 spec.

- **chatgpt.com Developer Mode**  
  For running this server as an MCP backend behind ChatGPT Developer Mode, the
  most practical configuration is the one that most closely matches the OpenAI
  Images API:
  - `result_placement = api`
  - `response_format = url`

  In this mode the tool result matches the `images.create` / `gpt-image-1`
  format (including `data[].url`), which simplifies consumption from backends
  and libraries that expect the OpenAI schema.

  However, **even with this OpenAI-native shape, the chatgpt.com client does
  not currently render images**. This behavior is documented in detail in the
  following report:  
  <https://github.com/strato-space/report/issues/1>
---

## ⚠️ Limitations & Large File Handling

- **Configurable payload safeguard:** By default this server uses a ~50MB budget (52,428,800 bytes) for inline `content` to stay within typical MCP client limits. You can override this threshold by setting the `MCP_MAX_CONTENT_BYTES` environment variable to a higher (or lower) value.
- **Auto-Switch to File Output:** If the total image base64 size exceeds the configured threshold, the tool automatically saves images to disk and returns file path(s) via `resource_link` instead of inline base64. This helps avoid client-side "payload too large" errors while still delivering full-resolution images.
- **Default File Location:** If you do not specify a `file` path, images will be saved to `/tmp` (or the directory set by the `MEDIA_GEN_MCP_OUTPUT_DIR` environment variable) with a unique filename.
- **Environment Variables:**
  - `MEDIA_GEN_MCP_OUTPUT_DIR`: Set this to control where large images and file outputs are saved. Example: `export MEDIA_GEN_MCP_OUTPUT_DIR=/your/desired/dir`. This directory may coincide with your public static directory if you serve files directly from it.
  - `MEDIA_GEN_MCP_URL_PREFIXES`: Optional comma-separated HTTPS prefixes for public URLs, matched positionally to `MEDIA_GEN_DIRS` entries. When set, the server builds public URLs as `<prefix>/<relative_path_inside_root>` and returns them alongside file paths (for example via `resource_link` URIs and `structuredContent.data[].url` when `response_format: "url"`). Example: `export MEDIA_GEN_MCP_URL_PREFIXES=https://media-gen.example.com/media,https://media-gen.example.com/samples`
- **Best Practice:** For large or production images, always use file output and ensure your client is configured to handle file paths. Configure `MEDIA_GEN_DIRS` and (optionally) `MEDIA_GEN_MCP_URL_PREFIXES` to serve images via a public web server (e.g., nginx).

---

## 🌐 Serving generated files over HTTPS

If you want ChatGPT (or any MCP client) to mention publicly accessible URLs alongside file paths:

1. Expose your image directory via HTTPS. For example, on nginx:

   ```nginx
   server {
       # listen 443 ssl http2;
       # server_name <server_name>;

       # ssl_certificate     <path>;
       # ssl_certificate_key <path>;

       location /media/ {
           alias /home/username/media-gen-mcp/media/;
           autoindex off;
           expires 7d;
           add_header Cache-Control "public, immutable";
       }
   }
   ```

2. Ensure the first entry in `MEDIA_GEN_DIRS` points to the same directory (e.g. `MEDIA_GEN_DIRS=/home/username/media-gen-mcp/media/` or `MEDIA_GEN_DIRS=media/` when running from the project root).
3. Set `MEDIA_GEN_MCP_URL_PREFIXES=https://media-gen.example.com/media` so the server returns matching HTTPS URLs in top-level `urls`, `resource_link` URIs, and `image_url` fields (for `response_format: "url"`).

Both `openai-images-generate` and `openai-images-edit` now attach `files` + `urls` for **base64** and **file** response modes, allowing clients to reference either the local filesystem path or the public HTTPS link. This is particularly useful while ChatGPT cannot yet render MCP image blocks inline.

---

## 📚 References

- **Model Context Protocol**
  - [MCP Specification](https://modelcontextprotocol.io/docs/getting-started/intro)
  - [MCP Schema (2025-11-25)](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-11-25/schema.json)

- **OpenAI Images**
  - [Images API overview](https://platform.openai.com/docs/api-reference/images)
  - [Images generate (gpt-image-1)](https://platform.openai.com/docs/api-reference/images/create)
  - [Images edit (`createEdit`)](https://platform.openai.com/docs/api-reference/images/createEdit)
  - [Tools guide: image generation & revised_prompt](https://platform.openai.com/docs/guides/tools-image-generation)

- **Case studies**
  - [MCP image rendering in ChatGPT (GitHub issue)](https://github.com/strato-space/report/issues/1)
    - **Symptoms:** ChatGPT often ignored or mishandled MCP `image` content blocks: empty tool results, raw base64 treated as text (huge token usage), or generic "I can't see the image" responses, while other MCP clients (Cursor, Claude) rendered the same images correctly.
    - **Root cause:** not a problem with the MCP spec itself, but with ChatGPT's handling/serialization of MCP `CallToolResult` image content blocks and media objects (especially around UI rendering and nested containers).
    - **Status & workarounds:** OpenAI has begun rolling out fixes for MCP image support in Codex/ChatGPT, but behavior is still inconsistent; this server uses file/resource_link + URL patterns and spec‑conformant `image` blocks so that tools remain usable across current and future MCP clients.

---

## 🙏 Credits

- Built with [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- Uses [openai](https://www.npmjs.com/package/openai) Node.js SDK 
- Refactoring and MCP spec alignment assisted by [Windsurf](https://windsurf.com) and [GPT-5 High Reasoning](https://openai.com).
