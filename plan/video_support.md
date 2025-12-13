# OpenAI Videos Support Plan

This document outlines the minimal, spec-first steps required to add **OpenAI Videos API** support to the `media-gen-mcp` server, following the same design goals as the existing image tools (`openai-images-generate`, `openai-images-edit`):

- **Spec-aligned inputs** via Zod schemas (TypeScript inference + unit tests).
- **`structuredContent` returns OpenAI API types** (so clients can rely on stable shapes).
- **Large outputs are file-first** via MCP `resource_link` (no inline base64 for videos).

The OpenAI Node SDK API surface used here:
- `client.videos.create(body)`
- `client.videos.remix(video_id, body)`
- `client.videos.list(query)`
- `client.videos.retrieve(video_id)`
- `client.videos.delete(video_id)`
- `client.videos.downloadContent(video_id, { variant })` (REST: `videos.download_content`)

Per the OpenAI SDK types (`openai/resources/videos`):
- `model`: `"sora-2" | "sora-2-pro"`
- `seconds`: `"4" | "8" | "12"`
- `size`: `"720x1280" | "1280x720" | "1024x1792" | "1792x1024"`
- `status`: `"queued" | "in_progress" | "completed" | "failed"`

---

## 1. Tools to add (MCP)

### 1.1 `openai-videos-create`

**Purpose:** Start a new video generation job (`client.videos.create`) and optionally wait+download assets when the job completes.

**Input schema (Zod):**

- `prompt` (string, required) — text prompt describing the video.
- `input_reference` (string, optional) — image reference to guide generation:
  - Accept the same “image source” formats as `openai-images-edit`: HTTP(S) URL, base64 / `data:image/...` URL, or file path.
  - If it is a URL: enforce `MEDIA_GEN_URLS` allowlist and fetch/convert to `data:image/...;base64,...` before uploading.
  - Convert to OpenAI `Uploadable` via `toFile(...)` (same approach as edit tool).
- `model` (enum, optional) — `"sora-2" | "sora-2-pro"` (default: `"sora-2"`).
- `seconds` (enum, optional) — `"4" | "8" | "12"` (default: omit).
- `size` (enum, optional) — `"720x1280" | "1280x720" | "1024x1792" | "1792x1024"` (default: omit).

**Async control (Zod):**

- `wait_for_completion` (boolean, optional, default: `false`)
  - `false`: return job metadata immediately; no download.
  - `true`: poll `client.videos.retrieve(id)` until `status` is `completed`/`failed` or timeout.
- `timeout_ms` (int, optional, default: `300000`) — max time to wait when `wait_for_completion=true`.
- `poll_interval_ms` (int, optional, default: `2000`) — poll interval when waiting.

**Download options (Zod):**

- `download_variants` (array enum, optional, default: `["video"]`)
  - Allowed values: `"video" | "thumbnail" | "spritesheet"`.
- `file` (string, optional)
  - Base output path (absolute or resolved relative to `MEDIA_GEN_DIRS[0]`, consistent with existing tools).
  - If multiple variants are requested, suffix filenames (e.g. `_video.mp4`, `_thumbnail.png`, `_spritesheet.zip`).

**Output:**

- `structuredContent`: OpenAI `Videos.Video` object (the job state returned by create; if `wait_for_completion=true`, the final retrieved state).
- `content`:
  - `resource_link` entries for downloaded assets (when available), with `mimeType` inferred from response headers and `uri` using HTTPS when `MEDIA_GEN_MCP_URL_PREFIXES` are configured.
  - A `text` block with serialized JSON of the `structuredContent` object for backward compatibility.

**Behavior notes:**

- Initial implementation should be **file-first** (no embedded blobs).
- If `AZURE_OPENAI_API_KEY` is set (Azure client), fail early with a clear message unless Azure explicitly supports `/videos` in your deployment.

---

### 1.2 `openai-videos-remix`

**Purpose:** Create a remix job from an existing video (`client.videos.remix`).

**Input schema:**

- `video_id` (string, required)
- `prompt` (string, required) — updated text prompt that directs the remix.
- `wait_for_completion` (boolean, optional, default: `false`) — same semantics as `openai-videos-create`.
- `timeout_ms` (int, optional, default: `300000`) — same semantics as `openai-videos-create`.
- `poll_interval_ms` (int, optional, default: `2000`) — same semantics as `openai-videos-create`.
- `download_variants` (array enum, optional, default: `["video"]`) — same semantics as `openai-videos-create`.
- `file` (string, optional) — same semantics as `openai-videos-create`.

**Output:**

- `structuredContent`: OpenAI `Videos.Video` (job metadata; final state when `wait_for_completion=true`)
- `content`: `resource_link` entries when downloads are performed + JSON `text` block

---

### 1.3 `openai-videos-list`

**Purpose:** List video jobs (`client.videos.list`), for browsing and cursor-based pagination.

**Input schema:**

- `after` (string, optional) — cursor (video id) to list after.
- `limit` (int, optional) — page size.
- `order` ("asc" | "desc", optional) — sort order by timestamp.

**Output:**

- `structuredContent`: OpenAI `VideosPage` (`ConversationCursorPageResponse<Video>`): `{ data, has_more, last_id }`
- `content`: `text` block with serialized JSON (optionally include a short line like `returned N videos`)

---

### 1.4 `openai-videos-retrieve`

**Purpose:** Retrieve job status (`client.videos.retrieve(video_id)`), for polling workflows.

**Input schema:**
- `video_id` (string, required)

**Output:**
- `structuredContent`: OpenAI `Videos.Video`
- `content`: `text` block with serialized JSON (plus optionally a brief status string)

---

### 1.5 `openai-videos-delete`

**Purpose:** Delete a video job (`client.videos.delete(video_id)`).

**Input schema:**
- `video_id` (string, required)

**Output:**
- `structuredContent`: OpenAI `Videos.VideoDeleteResponse`
- `content`: `text` block with serialized JSON (plus optionally a short confirmation string)

---

### 1.6 `openai-videos-download-content`

**Purpose:** Download an asset for a completed job (`client.videos.downloadContent`, REST: `download_content`), write it under allowed `MEDIA_GEN_DIRS`, return an MCP `resource_link`.

**Input schema:**
- `video_id` (string, required)
- `variant` (enum, optional, default: `"video"`) — `"video" | "thumbnail" | "spritesheet"`
- `file` (string, optional) — base output path (same semantics as other tools)

**Output:**
- `structuredContent`: OpenAI `Videos.Video` (retrieve after download so `structuredContent` stays an OpenAI API type)
- `content`: `resource_link` item for the downloaded file + JSON `text` block

**File details:**
- Use `Response.headers.get("content-type")` to choose a file extension:
  - `video/mp4` → `.mp4`
  - `image/*` → `.png`/`.jpg` (or default `.png` when unknown)
  - otherwise fallback `.bin`

---

## 2. Zod schemas & exported types

Add schemas in `src/lib/schemas.ts` (mirroring existing image tool schema style):

- `openaiVideosCreateSchema`
- `openaiVideosRemixSchema`
- `openaiVideosListSchema`
- `openaiVideosRetrieveSchema`
- `openaiVideosDeleteSchema`
- `openaiVideosDownloadContentSchema`

And export input types:

- `OpenAIVideosCreateArgs`
- `OpenAIVideosRemixArgs`
- `OpenAIVideosListArgs`
- `OpenAIVideosRetrieveArgs`
- `OpenAIVideosDeleteArgs`
- `OpenAIVideosDownloadContentArgs`

Use these schemas in `src/index.ts` tool registrations so MCP `inputSchema` and validation stay in sync with tests.

---

## 3. Result formatting (MCP)

Follow the existing image tools’ “MCP + OpenAI schema” split:

- `structuredContent` is always the **OpenAI API response type** for the endpoint:
  - create/retrieve/remix/download → `Videos.Video`
  - list → `VideosPage`
  - delete → `Videos.VideoDeleteResponse`
- `content[]` carries the “client renderable” output:
  - `resource_link` entries for the generated MP4 and optional assets.
- Add a final `text` content block with serialized JSON (URLs/file URIs only, no base64), matching the existing backward compatibility behavior.

---

## 4. Polling + timeouts (when waiting)

When `wait_for_completion=true`:

1. Call `videos.create(...)` or `videos.remix(...)` → get `id`.
2. Loop:
   - `videos.retrieve(id)`
   - if `status === "completed"` → download assets and return success
   - if `status === "failed"` → return `isError: true` with `video.error?.message`
   - sleep `poll_interval_ms`
   - stop after `timeout_ms` with `isError: true` (include last known `status/progress`)

Keep logging to stderr via the existing logger (don’t write progress to stdout).

---

## 5. Tests & validation

Add unit tests (no real OpenAI calls required):

- `test/schemas.test.ts`
  - validate `model/seconds/size` enums
  - validate defaults (`wait_for_completion`, `download_variants`, etc.)
  - validate list params (`after`, `limit`, `order`) and delete/remix inputs
  - validate input_reference acceptance (base64/data-url/URL/path) and URL allowlist behavior at handler level
- New unit tests for “download-to-file + resource_link” result formatting
  - Given a mocked `Response` (with `content-type`) and bytes, ensure:
    - file is written under allowed roots
    - returned `resource_link.mimeType` matches header
    - `structuredContent` stays a `Videos.Video` object shape

Optional (manual/integration):
- A gated integration test that runs only when `OPENAI_API_KEY` is set and an opt-in env var is true (videos are slow/costly).

---

## 6. README updates (once implemented)

Add a new section under “Tool signatures”:

- `openai-videos-create`
- `openai-videos-remix`
- `openai-videos-list`
- `openai-videos-retrieve`
- `openai-videos-delete`
- `openai-videos-download-content`

Include a recommended workflow:

1) `openai-videos-create` with `wait_for_completion=false` → get `video_id`  
2) `openai-videos-retrieve` until `status=completed`  
3) `openai-videos-download-content` to get an MP4 `resource_link`

---

## 7. Image/video size mismatch (common failure) + fix

### What happens

When `input_reference` is provided to `videos.create`, the Videos API may require the **input image dimensions to exactly match** the requested `size` (width × height). If they don’t match, the API can fail with errors like:

- `400 Inpaint image must match the requested width and height`

This is easy to hit because:

- Videos sizes are fixed (e.g. `720x1280`, `1280x720`, `1024x1792`, `1792x1024`).
- `openai-images-edit` only supports `1024x1024`, `1536x1024`, `1024x1536`, `auto` — so it **cannot** output an exact `720x1280` canvas for portrait workflows.

### Recommended fix (server-side)

Add optional **input pre-processing** to `openai-videos-create` and `openai-videos-remix` so the server can transform `input_reference` to the exact requested video size before uploading:

**New input params (Zod)**

- `input_reference_fit` (enum, optional, default: `"match"`)
  - `"match"`: require exact dimensions; if mismatch, return a clear error explaining allowed video sizes and how to fix.
  - `"cover"`: resize + **center-crop** to target size (fills the frame; may crop edges).
  - `"contain"`: resize + **letterbox/pad** to target size (no crop; adds bars/padding).
  - `"stretch"`: resize with distortion (last resort).
- `input_reference_background` (optional, for `"contain"`, default: `"blur"`)
  - `"blur"` (recommended), `"black"`, `"white"`, or a hex color.

**Implementation approach**

- Avoid data URLs for uploads when possible:
  - Fetch URL → raw `Buffer`
  - Local file → raw `Buffer`
  - Base64/data URL → decode to `Buffer`
- Use `sharp` (already optional dependency) to:
  - Read image metadata (width/height)
  - If `size` is set and dimensions mismatch:
    - Apply `fit` strategy (cover/contain/stretch) to produce **exact** target size
    - Encode to PNG (most compatible) and upload via `toFile(buffer, ...)`
- If `sharp` is not available and a resize is needed, fail with a clear message:
  - “Install sharp or provide an image that already matches the requested size.”

### Fix for “Unable to process image bytes” (URL input_reference)

If `input_reference` is a URL and the server converts it into a `data:image/...;base64,...` URL, ensure the `Content-Type` is sanitized (strip `; charset=...`) or bypass data URLs entirely by uploading raw bytes. Otherwise, the server can accidentally base64-decode the entire data URL string and send corrupt bytes to OpenAI, resulting in:

- `400 Unable to process image bytes`

### Workarounds (client-side, today)

- Choose `size` that matches your image’s orientation (landscape vs portrait).
- Pre-resize to the exact target dimensions before calling videos:
  - `sharp` / `ffmpeg` / ImageMagick locally, then pass the local path as `input_reference`.
