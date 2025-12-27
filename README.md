# media-gen-mcp

<p align="center">
  <a href="https://www.npmjs.com/package/@strato-space/media-gen-mcp"><img src="https://img.shields.io/npm/v/@strato-space%2Fmedia-gen-mcp?label=@strato-space/media-gen-mcp&color=brightgreen" alt="@strato-space/media-gen-mcp"></a>
  <a href="https://www.npmjs.com/package/@modelcontextprotocol/sdk"><img src="https://img.shields.io/npm/v/@modelcontextprotocol/sdk?label=MCP%20SDK&color=blue" alt="MCP SDK"></a>
  <a href="https://www.npmjs.com/package/openai"><img src="https://img.shields.io/npm/v/openai?label=OpenAI%20SDK&color=blueviolet" alt="OpenAI SDK"></a>
  <a href="https://github.com/punkpeye/mcp-proxy"><img src="https://img.shields.io/github/stars/punkpeye/mcp-proxy?label=mcp-proxy&style=social" alt="mcp-proxy"></a>
  <a href="https://github.com/yjacquin/fast-mcp"><img src="https://img.shields.io/github/stars/yjacquin/fast-mcp?label=fast-mcp&style=social" alt="fast-mcp"></a>
  <a href="https://github.com/strato-space/media-gen-mcp/blob/main/LICENSE"><img src="https://img.shields.io/github/license/strato-space/media-gen-mcp?color=brightgreen" alt="License"></a>
  <a href="https://github.com/strato-space/media-gen-mcp/stargazers"><img src="https://img.shields.io/github/stars/strato-space/media-gen-mcp?style=social" alt="GitHub stars"></a>
  <a href="https://github.com/strato-space/media-gen-mcp/actions"><img src="https://img.shields.io/github/actions/workflow/status/strato-space/media-gen-mcp/main.yml?label=build&logo=github" alt="Build Status"></a>
</p>

---

**Media Gen MCP** is a **strict TypeScript** Model Context Protocol (MCP) server for OpenAI Images (`gpt-image-1.5`, `gpt-image-1`), OpenAI Videos (Sora), and Google GenAI Videos (Veo): generate/edit images, create/remix video jobs, and fetch media from URLs or disk with smart `resource_link` vs inline `image` outputs and optional `sharp` processing. Production-focused (full strict typecheck, ESLint + Vitest CI). Works with fast-agent, Claude Desktop, ChatGPT, Cursor, VS Code, Windsurf, and any MCP-compatible client.

**Design principle:** spec-first, type-safe image tooling – strict OpenAI Images API + MCP compliance with fully static TypeScript types and flexible result placements/response formats for different clients.

- **Generate images** from text prompts using OpenAI's `gpt-image-1.5` model (with `gpt-image-1` compatibility and DALL·E support planned in future versions).
- **Edit images** (inpainting, outpainting, compositing) from 1 up to 16 images at once, with advanced prompt control.
- **Generate videos** via OpenAI Videos (`sora-2`, `sora-2-pro`) with job create/remix/list/retrieve/delete and asset downloads.
- **Generate videos** via Google GenAI (Veo) with operation polling and file-first downloads.
- **Fetch & compress images** from HTTP(S) URLs or local file paths with smart size/quality optimization.
- **Debug MCP output shapes** with a `test-images` tool that mirrors production result placement (`content`, `structuredContent`, `toplevel`).
- **Integrates with**: [fast-agent](https://github.com/strato-space/fast-agent), [Windsurf](https://windsurf.com), [Claude Desktop](https://www.anthropic.com/claude/desktop), [Cursor](https://cursor.com), [VS Code](https://code.visualstudio.com/), and any MCP-compatible client.

---

## ✨ Features

- **Strict MCP spec support**  
  Tool outputs are first-class [`CallToolResult`](https://github.com/modelcontextprotocol/spec/blob/main/schema/2025-11-25/schema.json) objects from the latest MCP schema, including:
  `content` items (`text`, `image`, `resource_link`, `resource`), optional `structuredContent`, optional top-level `files`, and the `isError` flag for failures.

- **Full gpt-image-1.5 and sora-2/sora-2-pro parameters coverage (generate & edit)**  
  - [`openai-images-generate`](#openai-images-generate) mirrors the OpenAI Images [`create`](https://platform.openai.com/docs/api-reference/images/create) API for `gpt-image-1.5` (and `gpt-image-1`) (background, moderation, size, quality, output_format, output_compression, `n`, `user`, etc.).
  - [`openai-images-edit`](#openai-images-edit) mirrors the OpenAI Images [`createEdit`](https://platform.openai.com/docs/api-reference/images/createEdit) API for `gpt-image-1.5` (and `gpt-image-1`) (image, mask, `n`, quality, size, `user`).

- **OpenAI Videos (Sora) job tooling (create / remix / list / retrieve / delete / content)**  
  - [`openai-videos-create`](#openai-videos-create) mirrors [`videos/create`](https://platform.openai.com/docs/api-reference/videos/create) and can optionally wait for completion.
  - [`openai-videos-remix`](#openai-videos-remix) mirrors [`videos/remix`](https://platform.openai.com/docs/api-reference/videos/remix).
  - [`openai-videos-list`](#openai-videos-list) mirrors [`videos/list`](https://platform.openai.com/docs/api-reference/videos/list).
  - [`openai-videos-retrieve`](#openai-videos-retrieve) mirrors [`videos/retrieve`](https://platform.openai.com/docs/api-reference/videos/retrieve).
  - [`openai-videos-delete`](#openai-videos-delete) mirrors [`videos/delete`](https://platform.openai.com/docs/api-reference/videos/delete).
  - [`openai-videos-retrieve-content`](#openai-videos-retrieve-content) mirrors [`videos/content`](https://platform.openai.com/docs/api-reference/videos/content) and downloads `video` / `thumbnail` / `spritesheet` assets to disk, returning MCP `resource_link` (default) or embedded `resource` blocks (via `tool_result`).

- **Google GenAI (Veo) operations + downloads (generate / retrieve operation / retrieve content)**  
  - [`google-videos-generate`](#google-videos-generate) starts a long-running operation (`ai.models.generateVideos`) and can optionally wait for completion and download `.mp4` outputs. [Veo model reference](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/veo-video-generation)
  - [`google-videos-retrieve-operation`](#google-videos-retrieve-operation) polls an existing operation.
  - [`google-videos-retrieve-content`](#google-videos-retrieve-content) downloads an `.mp4` from a completed operation, returning MCP `resource_link` (default) or embedded `resource` blocks (via `tool_result`).

- **Fetch and process images from URLs or files**  
  [`fetch-images`](#fetch-images) tool loads images from HTTP(S) URLs or local file paths with optional, user-controlled compression (disabled by default). Supports parallel processing of up to 20 images.

- **Fetch videos from URLs or files**  
  [`fetch-videos`](#fetch-videos) tool lists local videos or downloads remote video URLs to disk and returns MCP `resource_link` (default) or embedded `resource` blocks (via `tool_result`).

- **Mix and edit up to 16 images**  
  [`openai-images-edit`](#openai-images-edit) accepts `image` as a single string or an array of 1–16 file paths/base64 strings, matching the OpenAI spec for GPT Image models (`gpt-image-1.5`, `gpt-image-1`) image edits.

- **Smart image compression**  
  Built-in compression using [sharp](https://sharp.pixelplumbing.com/) — iteratively reduces quality and dimensions to fit MCP payload limits while maintaining visual quality.

- **Resource-aware file output with `resource_link`**  
  - Automatic switch from inline base64 to `file` when the total response size exceeds a safe threshold.
  - Outputs are written to disk using `output_<time_t>_media-gen__<tool>_<id>.<ext>` filenames (images use a generated UUID; videos use the OpenAI `video_id`) and exposed to MCP clients via `content[]` depending on `tool_result` (`resource_link`/`image` for images, `resource_link`/`resource` for video downloads).

- **Built-in test-images tool for MCP client debugging**  
  [`test-images`](#test-images) reads sample images from a configured directory and returns them using the same result-building logic as production tools. Use `tool_result` and `response_format` parameters to test how different MCP clients handle `content[]` and `structuredContent`.

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
| `helpers` | 31 | URL/path validation, output resolution, result placement, resource links |
| `env` | 19 | Configuration parsing, env validation, defaults |
| `logger` | 10 | Structured logging + truncation safety |
| `pricing` | 5 | Sora pricing estimate helpers |
| `schemas` | 69 | Zod schema validation for all tools, type inference |
| `fetch-images` (integration) | 3 | End-to-end MCP tool call behavior |
| `fetch-videos` (integration) | 3 | End-to-end MCP tool call behavior |

**Test categories:**

- **compression** — `isCompressionAvailable`, `detectImageFormat`, `processBufferWithCompression`, `readAndProcessImage`
- **helpers** — `isHttpUrl`, `isAbsolutePath`, `isBase64Image`, `ensureDirectoryWritable`, `resolveOutputPath`, `getResultPlacement`, `buildResourceLinks`
- **env** — config loading and validation for `MEDIA_GEN_*` / `MEDIA_GEN_MCP_*` settings
- **logger** — truncation and error formatting behavior
- **schemas** — validation for `openai-images-*`, `openai-videos-*`, `fetch-images`, `fetch-videos`, `test-images` inputs, boundary testing (prompt length, image count limits, path validation)

```sh
npm run test
# ✓ test/compression.test.ts (12 tests)
# ✓ test/helpers.test.ts (31 tests)
# ✓ test/env.test.ts (19 tests)
# ✓ test/logger.test.ts (10 tests)
# ✓ test/pricing.test.ts (5 tests)
# ✓ test/schemas.test.ts (69 tests)
# ✓ test/fetch-images.integration.test.ts (3 tests)
# ✓ test/fetch-videos.integration.test.ts (3 tests)
# Tests: 152 passed
```

### Run directly via npx (no local clone)

You can also run the server straight from a remote repo using `npx`:

```sh
npx -y github:strato-space/media-gen-mcp --env-file /path/to/media-gen.env
```

The `--env-file` argument tells the server which env file to load (e.g. when you keep secrets outside the cloned directory). The file should contain `OPENAI_API_KEY`, optional Azure variables, and any `MEDIA_GEN_MCP_*` settings.

### `secrets.yaml` (optional)

You can keep API keys (and optional Google Vertex AI settings) in a `secrets.yaml` file (compatible with the fast-agent secrets template):

```yaml
openai:
  api_key: <your-api-key-here>
anthropic:
  api_key: <your-api-key-here>
google:
  api_key: <your-api-key-here>
  vertex_ai:
    enabled: true
    project_id: your-gcp-project-id
    location: europe-west4
```

`media-gen-mcp` loads `secrets.yaml` from the current working directory (or from `--secrets-file /path/to/secrets.yaml`) and applies it to env vars; values in `secrets.yaml` override env, and `<your-api-key-here>` placeholders are ignored.

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

### Logging and base64 truncation

To avoid flooding logs with huge image payloads, the built-in logger applies a
log-only sanitizer to structured `data` passed to `log.debug/info/warn/error`:

- Truncates configured string fields (e.g. `b64_json`, `base64`, string
  `data`, `image_url`) to a short preview controlled by
  `LOG_TRUNCATE_DATA_MAX` (default: 64 characters). The list of keys defaults
  to `LOG_SANITIZE_KEYS` inside `src/lib/logger.ts` and can be overridden via
  `MEDIA_GEN_MCP_LOG_SANITIZE_KEYS` (comma-separated list of field names).
- Sanitization is applied **only** to log serialization; tool results returned
  to MCP clients are never modified.

Control via environment:

- `MEDIA_GEN_MCP_LOG_SANITIZE_IMAGES` (default: `true`)
  - `1`, `true`, `yes`, `on` – enable truncation (default behaviour).
  - `0`, `false`, `no`, `off` – disable truncation and log full payloads.

Field list and limits are configured in `src/lib/logger.ts` via
`LOG_SANITIZE_KEYS` and `LOG_TRUNCATE_DATA_MAX`.

### Security and local file access

- **Allowed directories**: All tools are restricted to paths matching `MEDIA_GEN_DIRS`. If unset, defaults to `/tmp/media-gen-mcp` (or `%TEMP%/media-gen-mcp` on Windows).
- **Test samples**: `MEDIA_GEN_MCP_TEST_SAMPLE_DIR` adds a directory to the allowlist and enables the `test-images` tool.
- **Local reads**: `fetch-images` accepts file paths (absolute or relative). Relative paths are resolved against the first `MEDIA_GEN_DIRS` entry and must still match an allowed pattern.
- **Remote reads**: HTTP(S) fetches are filtered by `MEDIA_GEN_URLS` patterns. Empty = allow all.
- **Writes**: `openai-images-generate`, `openai-images-edit`, `fetch-images`, and `fetch-videos` write under the first entry of `MEDIA_GEN_DIRS`. `test-images` is read-only and does not create new files.

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

Image tools (`openai-images-*`, `fetch-images`, `test-images`) support two parameters that control the shape of the MCP tool result:

| Parameter | Values | Default | Description |
|-----------|--------|---------|-------------|
| `tool_result` | `resource_link`, `image` | `resource_link` | Controls `content[]` shape |
| `response_format` | `url`, `b64_json` | `url` | Controls `structuredContent` shape (OpenAI ImagesResponse format) |

Video download tools (`openai-videos-create` / `openai-videos-remix` when downloading, `openai-videos-retrieve-content`, `google-videos-generate` when downloading, `google-videos-retrieve-content`, `fetch-videos`) support:

| Parameter | Values | Default | Description |
|-----------|--------|---------|-------------|
| `tool_result` | `resource_link`, `resource` | `resource_link` | Controls `content[]` shape |

Google video tools (`google-videos-*`) also support:

| Parameter | Values | Default | Description |
|-----------|--------|---------|-------------|
| `response_format` | `url`, `b64_json` | `url` | Controls `structuredContent.response.generatedVideos[].video` shape (`uri` vs `videoBytes`) |

#### `tool_result` — controls `content[]`

- **Images** (`openai-images-*`, `fetch-images`, `test-images`)
  - **`resource_link`** (default): Emits `ResourceLink` items with `file://` or `https://` URIs
  - **`image`**: Emits base64 `ImageContent` blocks
- **Videos** (tools that download video data)
  - **`resource_link`** (default): Emits `ResourceLink` items with `file://` or `https://` URIs
  - **`resource`**: Emits `EmbeddedResource` blocks with base64 `resource.blob`

#### `response_format` — controls `structuredContent`

For OpenAI images, `structuredContent` always contains an OpenAI ImagesResponse-style object:

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

For Google videos, `response_format` controls whether `structuredContent.response.generatedVideos[].video` prefers:

- **`url`** (default): `video.uri` (and strips `video.videoBytes`)
- **`b64_json`**: `video.videoBytes` (and strips `video.uri`)

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
- `model` ("gpt-image-1.5" | "gpt-image-1", optional, default: "gpt-image-1.5")
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
- `quality` ("auto" | "high" | "medium" | "low", default: "high")
- `size` ("1024x1024" | "1536x1024" | "1024x1536" | "auto", default: "1024x1536")
- `user` (string, optional)
  - User identifier forwarded to OpenAI for monitoring.
- `response_format` ("url" | "b64_json", default: "url")
  - Response format (aligned with OpenAI Images API):
    - `"url"`: file/URL-based output (resource_link items, `image_url` fields, `data[].url` in `api` placement).
    - `"b64_json"`: inline base64 image data (image content, `data[].b64_json` in `api` placement).
  - `tool_result` ("resource_link" | "image", default: "resource_link")
    - Controls `content[]` shape:
      - `"resource_link"` emits ResourceLink items (file/URL-based)
      - `"image"` emits base64 ImageContent blocks

Behavior notes:

- The server uses OpenAI `gpt-image-1.5` by default (set `model: "gpt-image-1"` for legacy behavior).
- If the total size of all base64 images would exceed the configured payload
  threshold (default ~50MB via `MCP_MAX_CONTENT_BYTES`), the server
  automatically switches the **effective output mode** to file/URL-based and saves
  images to the first entry of `MEDIA_GEN_DIRS` (default: `/tmp/media-gen-mcp`).
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
  - For `gpt-image-1.5` and `gpt-image-1`, an additional `text` line is included with a pricing estimate (based on `structuredContent.usage`), and `structuredContent.pricing` contains the full pricing breakdown.

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
- `model` ("gpt-image-1.5" | "gpt-image-1", optional, default: "gpt-image-1.5")
- `n` (integer, optional)
  - Number of images to generate.
  - Min: 1, Max: 10.
- `quality` ("auto" | "high" | "medium" | "low", default: "high")
- `size` ("1024x1024" | "1536x1024" | "1024x1536" | "auto", default: "1024x1536")
- `user` (string, optional)
  - User identifier forwarded to OpenAI for monitoring.
- `response_format` ("url" | "b64_json", default: "url")
  - Response format (aligned with OpenAI Images API):
    - `"url"`: file/URL-based output (resource_link items, `image_url` fields, `data[].url` in `api` placement).
    - `"b64_json"`: inline base64 image data (image content, `data[].b64_json` in `api` placement).
- `tool_result` ("resource_link" | "image", default: "resource_link")
  - Controls `content[]` shape:
    - `"resource_link"` emits ResourceLink items (file/URL-based)
    - `"image"` emits base64 ImageContent blocks

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
  - For `gpt-image-1.5` and `gpt-image-1`, an additional `text` line is included with a pricing estimate (based on `structuredContent.usage`), and `structuredContent.pricing` contains the full pricing breakdown.

When `result_placement` includes `"api"`, `openai-images-edit` follows the **same raw API format** as `openai-images-generate` (top-level `created`, `data[]`, `background`, `output_format`, `size`, `quality` with `b64_json` for base64 output or `url` for file output).

Error handling (both tools):

- On errors inside the tool handler (validation, OpenAI API failures, I/O, etc.), the server returns a CallToolResult marked as an error:
  - `isError: true`
  - `content: [{ type: "text", text: <error message string> }]`
- The error message text is taken directly from the underlying exception message, without additional commentary from the server, while full details are logged to the server console.

### openai-videos-create

Create a video generation job using the OpenAI Videos API (`videos.create`).

Arguments (input schema):

- `prompt` (string, required) — text prompt describing the video (max 32K chars).
- `input_reference` (string, optional) — optional image reference (HTTP(S) URL, base64/data URL, or file path).
- `input_reference_fit` ("match" | "cover" | "contain" | "stretch", default: "contain")
  - How to fit `input_reference` to the requested video `size`:
    - `match`: require exact dimensions (fails fast on mismatch)
    - `cover`: resize + center-crop to fill
    - `contain`: resize + pad/letterbox to fit (default)
    - `stretch`: resize with distortion
- `input_reference_background` ("blur" | "black" | "white" | "#RRGGBB" | "#RRGGBBAA", default: "blur")
  - Padding background used when `input_reference_fit="contain"`.
- `model` ("sora-2" | "sora-2-pro", default: "sora-2-pro")
- `seconds` ("4" | "8" | "12", optional)
- `size` ("720x1280" | "1280x720" | "1024x1792" | "1792x1024", optional)
  - `1024x1792` and `1792x1024` require `sora-2-pro`.
  - If `input_reference` is omitted and `size` is omitted, the API default is used.
- `wait_for_completion` (boolean, default: true)
  - When true, the server polls `openai-videos-retrieve` until `completed` or `failed` (or timeout), then downloads assets.
- `timeout_ms` (integer, default: 900000)
- `poll_interval_ms` (integer, default: 2000)
- `download_variants` (string[], default: ["video"])
  - Allowed values: `"video" | "thumbnail" | "spritesheet"`.
- `tool_result` (`"resource_link"` | `"resource"`, default: `"resource_link"`)
  - Controls `content[]` shape for downloaded assets:
    - `"resource_link"` emits ResourceLink items (file/URL-based)
    - `"resource"` emits EmbeddedResource blocks with base64 `resource.blob`

Output (MCP CallToolResult):

- `structuredContent`: OpenAI `Video` object (job metadata; final state when `wait_for_completion=true`).
- `content`: includes `resource_link` (default) or embedded `resource` blocks for downloaded assets (when requested) and text blocks with JSON.
  - Includes a summary JSON block: `{ "video_id": "...", "pricing": { "currency": "USD", "model": "...", "size": "...", "seconds": 4, "price": 0.1, "cost": 0.4 } | null }` (and when waiting: `{ "video_id": "...", "assets": [...], "pricing": ... }`).

### openai-videos-remix

Create a remix job from an existing `video_id` (`videos.remix`).

Arguments (input schema):

- `video_id` (string, required)
- `prompt` (string, required)
- `wait_for_completion`, `timeout_ms`, `poll_interval_ms`, `download_variants`, `tool_result` — same semantics as `openai-videos-create` (default wait is true).

### openai-videos-list

List video jobs (`videos.list`).

Arguments (input schema):

- `after` (string, optional) — cursor (video id) to list after.
- `limit` (integer, optional)
- `order` ("asc" | "desc", optional)

Output:

- `structuredContent`: OpenAI list response shape `{ data, has_more, last_id }`.
- `content`: a text block with serialized JSON.

### openai-videos-retrieve

Retrieve job status (`videos.retrieve`).

- `video_id` (string, required)

### openai-videos-delete

Delete a video job (`videos.delete`).

- `video_id` (string, required)

### openai-videos-retrieve-content

Retrieve an asset for a completed job (`videos.downloadContent`, REST `GET /videos/{video_id}/content`), write it under allowed `MEDIA_GEN_DIRS`, and return MCP `resource_link` (default) or embedded `resource` blocks (via `tool_result`).

Arguments (input schema):

- `video_id` (string, required)
- `variant` ("video" | "thumbnail" | "spritesheet", default: "video")
- `tool_result` (`"resource_link"` | `"resource"`, default: `"resource_link"`)

Output (MCP CallToolResult):

- `structuredContent`: OpenAI `Video` object.
- `content`: a `resource_link` (or embedded `resource`), a summary JSON block `{ video_id, variant, uri, pricing }`, plus the full video JSON.

### google-videos-generate

Create a Google video generation operation using the Google GenAI SDK (`@google/genai`) `ai.models.generateVideos`.

Arguments (input schema):

- `prompt` (string, optional)
- `input_reference` (string, optional) — image-to-video input (HTTP(S) URL, base64/data URL, or file path under `MEDIA_GEN_DIRS`)
- `input_reference_mime_type` (string, optional) — override for `input_reference` MIME type (must be `image/*`)
- `input_video_reference` (string, optional) — video-extension input (HTTP(S) URL or file path under `MEDIA_GEN_DIRS`; mutually exclusive with `input_reference`)
- `model` (string, default: `"veo-3.1-generate-001"`)
- `number_of_videos` (integer, default: `1`)
- `aspect_ratio` (`"16:9" | "9:16"`, optional)
- `duration_seconds` (integer, optional)
  - Veo 2 models: 5–8 seconds (default: 8)
  - Veo 3 models: 4, 6, or 8 seconds (default: 8)
  - When using `referenceImages`: 8 seconds
- `person_generation` (`"DONT_ALLOW" | "ALLOW_ADULT" | "ALLOW_ALL"`, optional)
- `wait_for_completion` (boolean, default: `true`)
- `timeout_ms` (integer, default: `900000`)
- `poll_interval_ms` (integer, default: `10000`)
- `download_when_done` (boolean, optional; defaults to `true` when waiting)
- `tool_result` (`"resource_link"` | `"resource"`, default: `"resource_link"`)
  - Controls `content[]` shape when downloading generated videos.
- `response_format` (`"url"` | `"b64_json"`, default: `"url"`)
  - Controls `structuredContent.response.generatedVideos[].video` fields:
    - `"url"` prefers `video.uri` (and strips `video.videoBytes`)
    - `"b64_json"` prefers `video.videoBytes` (and strips `video.uri`)

Requirements:

- Gemini Developer API: set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), or `google.api_key` in `secrets.yaml`.
- Vertex AI: set `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT`, and `GOOGLE_CLOUD_LOCATION` (or `google.vertex_ai.*` in `secrets.yaml`).

Output:

- `structuredContent`: Google operation object (includes `name`, `done`, and `response.generatedVideos[]` when available).
- `content`: status text, optional `.mp4` `resource_link` (default) or embedded `resource` blocks (when downloaded), plus JSON text blocks for compatibility.

### google-videos-retrieve-operation

Retrieve/poll an existing Google video operation (`ai.operations.getVideosOperation`).

- `operation_name` (string, required)
- `response_format` (`"url"` | `"b64_json"`, default: `"url"`)

Output:

- `structuredContent`: Google operation object.
- `content`: JSON text blocks with a short summary + the full operation.

### google-videos-retrieve-content

Download `.mp4` content for a completed operation and return file-first MCP `resource_link` (default) or embedded `resource` blocks (via `tool_result`).

- `operation_name` (string, required)
- `index` (integer, default: `0`) — selects `response.generatedVideos[index]`
- `tool_result` (`"resource_link"` | `"resource"`, default: `"resource_link"`)
- `response_format` (`"url"` | `"b64_json"`, default: `"url"`)

Recommended workflow:

1) Call `google-videos-generate` with `wait_for_completion=true` (default) to get the completed operation and downloads; set to false only if you need the operation id immediately.
2) Poll `google-videos-retrieve-operation` until `done=true`.
3) Call `google-videos-retrieve-content` to download an `.mp4` and receive a `resource_link` (or embedded `resource`).

### fetch-images

Fetch and process images from URLs or local file paths with optional compression.

Arguments (input schema):

- `sources` (string[], optional)
  - Array of image sources: HTTP(S) URLs or file paths (absolute or relative to the first `MEDIA_GEN_DIRS` entry).
  - Min: 1, Max: 20 images.
  - Mutually exclusive with `ids` and `n`.
- `ids` (string[], optional)
  - Array of image IDs to fetch by local filename match under the primary `MEDIA_GEN_DIRS[0]` directory.
  - IDs must be safe (`[A-Za-z0-9_-]` only; no `..`, `*`, `?`, slashes).
  - Matches filenames containing `_{id}_` or `_{id}.` (supports both single outputs and multi-output suffixes like `_1.png`).
  - When `ids` is used, `compression` and `file` are not supported (no new files are created).
  - Mutually exclusive with `sources` and `n`.
- `n` (integer, optional)
  - When set, returns the last N image files from the primary `MEDIA_GEN_DIRS[0]` directory.
  - Files are sorted by modification time (most recently modified first).
  - Mutually exclusive with `sources` and `ids`.
- `compression` (object, optional)
  - `max_size` (integer, optional): Max dimension in pixels. Images larger than this will be resized.
  - `max_bytes` (integer, optional): Target max file size in bytes. Default: 819200 (800KB).
  - `quality` (integer, optional): JPEG/WebP quality 1-100. Default: 85.
  - `format` ("jpeg" | "png" | "webp", optional): Output format. Default: jpeg.
- `response_format` ("url" | "b64_json", default: "url")
  - Response format: file/URL-based (`url`) or inline base64 (`b64_json`).
- `tool_result` ("resource_link" | "image", default: "resource_link")
  - Controls `content[]` shape:
    - `"resource_link"` emits ResourceLink items (file/URL-based)
    - `"image"` emits base64 ImageContent blocks
- `file` (string, optional)
  - Base path for output files. If multiple images, index suffix is added.

Behavior notes:

- Images are processed in parallel for maximum throughput.
- Compression is **only** applied when `compression` options are provided.
- Compression uses [sharp](https://sharp.pixelplumbing.com/) with iterative quality/size reduction when enabled.
- Partial success: if some sources fail, successful images are still returned with errors listed in the response.
- When `n` is provided, it is only honored when the `MEDIA_GEN_MCP_ALLOW_FETCH_LAST_N_IMAGES` environment variable is set to `true`. Otherwise, the call fails with a validation error.
- Sometimes an MCP client (for example, ChargeGPT) may not wait for a response from `media-gen-mcp` due to a timeout. In creative environments where you need to quickly retrieve the latest `openai-images-generate` / `openai-images-edit` outputs, you can use `fetch-images` with the `n` argument. When the `MEDIA_GEN_MCP_ALLOW_FETCH_LAST_N_IMAGES=true` environment variable is set, `fetch-images` will return the last N files from `MEDIA_GEN_DIRS[0]` even if the original generation or edit operation timed out on the MCP client side.

### fetch-videos

Fetch videos from HTTP(S) URLs or local file paths.

Arguments (input schema):

- `sources` (string[], optional)
  - Array of video sources: HTTP(S) URLs or file paths (absolute or relative to the first `MEDIA_GEN_DIRS` entry).
  - Min: 1, Max: 20 videos.
  - Mutually exclusive with `ids` and `n`.
- `ids` (string[], optional)
  - Array of video IDs to fetch by local filename match under the primary `MEDIA_GEN_DIRS[0]` directory.
  - IDs must be safe (`[A-Za-z0-9_-]` only; no `..`, `*`, `?`, slashes).
  - Matches filenames containing `_{id}_` or `_{id}.` (supports both single outputs and multi-asset suffixes like `_thumbnail.webp`).
  - When `ids` is used, `file` is not supported (no downloads; returns existing files).
  - Mutually exclusive with `sources` and `n`.
- `n` (integer, optional)
  - When set, returns the last N video files from the primary `MEDIA_GEN_DIRS[0]` directory.
  - Files are sorted by modification time (most recently modified first).
  - Mutually exclusive with `sources` and `ids`.
- `tool_result` (`"resource_link"` | `"resource"`, default: `"resource_link"`)
  - Controls `content[]` shape:
    - `"resource_link"` emits ResourceLink items (file/URL-based)
    - `"resource"` emits EmbeddedResource blocks with base64 `resource.blob`
- `file` (string, optional)
  - Base path for output files (used when downloading from URLs). If multiple videos are downloaded, an index suffix is added.

Output:

- `content`: one `resource_link` (default) or embedded `resource` block per resolved video, plus an optional error summary text block.
- `structuredContent`: `{ data: [{ source, uri, file, mimeType, name, downloaded }], errors?: string[] }`.

Behavior notes:

- URL downloads are only allowed when the URL matches `MEDIA_GEN_URLS` (when set).
- When `n` is provided, it is only honored when the `MEDIA_GEN_MCP_ALLOW_FETCH_LAST_N_VIDEOS` environment variable is set to `true`. Otherwise, the call fails with a validation error.

### test-images

Debug tool for testing MCP result placement without calling OpenAI API.

**Enabled only when `MEDIA_GEN_MCP_TEST_SAMPLE_DIR` is set**. The tool reads existing images from this directory and does **not** create new files.

Arguments (input schema):

- `response_format` ("url" | "b64_json", default: "url")
- `result_placement` ("content" | "api" | "structured" | "toplevel" or array of these, optional)
  - Override `MEDIA_GEN_MCP_RESULT_PLACEMENT` for this call.
- `compression` (object, optional)
  - Same logical tuning knobs as `fetch-images`, but using camelCase keys:
- `tool_result` ("resource_link" | "image", default: "resource_link")
  - Controls `content[]` shape:
    - `"resource_link"` emits ResourceLink items (file/URL-based)
    - `"image"` emits base64 ImageContent blocks
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

#### Debug CLI helpers for `test-images`

For local debugging there are two helper scripts that call `test-images` directly:

- `npm run test-images` – uses `debug/debug-call.ts` and prints the validated
  `CallToolResult` as seen by the MCP SDK client. Usage:

  ```sh
  npm run test-images -- [placement] [--response_format url|b64_json]
  # examples:
  # npm run test-images -- structured --response_format b64_json
  # npm run test-images -- structured --response_format url
  ```

- `npm run test-images:raw` – uses `debug/debug-call-raw.ts` and prints the raw
  JSON-RPC `result` (the underlying `CallToolResult` without extra wrapping). Same
  CLI flags as above.

Both scripts truncate large fields for readability:

- `image_url` → first 80 characters, then `...(N chars)`;
- `b64_json` and `data` (when it is a base64 string) → first 25 characters, then `...(N chars)`.

---

## 🧩 Version policy

### Semantic Versioning (SemVer)

This package follows **SemVer**: `MAJOR.MINOR.PATCH` (x.y.z).

- `MAJOR` — breaking changes (tool names, input schemas, output shapes).
- `MINOR` — new tools or backward-compatible additions (new optional params, new fields in responses).
- `PATCH` — bug fixes and internal refactors with no intentional behavior change.

Since `1.0.0`, this project follows **standard SemVer rules**: breaking changes bump **MAJOR** (npm’s `^1.0.0` allows `1.x`, but not `2.0.0`).

### Dependency policy

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

All tools (`openai-images-*`, `openai-videos-*`, `fetch-images`, `fetch-videos`, `test-images`) follow this pattern.

---

## 🧩 Tool annotations

This MCP server exposes the following tools with annotation hints:

| Tool | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
|------|----------------|-------------------|------------------|-----------------|
| **openai-images-generate** | `true` | `false` | `false` | `true` |
| **openai-images-edit** | `true` | `false` | `false` | `true` |
| **openai-videos-create** | `true` | `false` | `false` | `true` |
| **openai-videos-remix** | `true` | `false` | `false` | `true` |
| **openai-videos-list** | `true` | `false` | `false` | `true` |
| **openai-videos-retrieve** | `true` | `false` | `false` | `true` |
| **openai-videos-delete** | `true` | `false` | `false` | `true` |
| **openai-videos-retrieve-content** | `true` | `false` | `false` | `true` |
| **fetch-images** | `true` | `false` | `false` | `false` |
| **fetch-videos** | `true` | `false` | `false` | `false` |
| **test-images** | `true` | `false` | `false` | `false` |

These hints help MCP clients understand that these tools:
- may invoke external APIs or read external resources (open world),
- do not modify existing project files or user data; they only create new media files (images/videos) in configured output directories,
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
│       ├── env.ts            # Env parsing + allowlists (+ glob support)
│       ├── helpers.ts        # URL/path validation, result building
│       ├── logger.ts         # Structured logging + truncation helpers
│       └── schemas.ts        # Zod schemas for all tools
├── test/
│   ├── compression.test.ts             # 12 tests
│   ├── env.test.ts                     # 19 tests
│   ├── fetch-images.integration.test.ts# 2 tests
│   ├── fetch-videos.integration.test.ts# 2 tests
│   ├── helpers.test.ts                 # 31 tests
│   ├── logger.test.ts                  # 10 tests
│   └── schemas.test.ts                 # 64 tests
├── debug/                    # Local debug helpers (MCP client scripts)
├── plan/                     # Design notes / plans
├── dist/                     # Compiled output
├── tsconfig.json
├── vitest.config.ts
├── package.json
├── CHANGELOG.md
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
  [`images.create` / `gpt-image-1.5`](https://platform.openai.com/docs/api-reference/images/create):
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

  In this mode the tool result matches the `images.create` / `gpt-image-1.5`
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
- **Default File Location:** If you do not specify a `file` path, outputs are saved under `MEDIA_GEN_DIRS[0]` (default: `/tmp/media-gen-mcp`) using names like `output_<time_t>_media-gen__<tool>_<id>.<ext>`.
- **Environment Variables:**
  - `MEDIA_GEN_DIRS`: Set this to control where outputs are saved. Example: `export MEDIA_GEN_DIRS=/your/desired/dir`. This directory may coincide with your public static directory if you serve files directly from it.
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
  - [Images generate (gpt-image-1.5)](https://platform.openai.com/docs/api-reference/images/create)
  - [Images edit (`createEdit`)](https://platform.openai.com/docs/api-reference/images/createEdit)
  - [Tools guide: image generation & revised_prompt](https://platform.openai.com/docs/guides/tools-image-generation)

- **OpenAI Videos**
  - [Videos API overview](https://platform.openai.com/docs/api-reference/videos)

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
