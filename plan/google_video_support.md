# Google (Gemini / Veo) Video Support Plan

This document outlines the spec-first steps required to add **Google video generation** support (Veo 2 / Veo 3) to the `media-gen-mcp` server, following the same design goals as the existing OpenAI tools:

- **Spec-aligned inputs** via Zod schemas (TypeScript inference + unit tests).
- **`structuredContent` returns provider-native types** (so clients can rely on stable shapes).
- **Large outputs are file-first** via MCP `resource_link` (no inline base64 for videos).
- **Safety model stays consistent**: local reads/writes limited to `MEDIA_GEN_DIRS`, remote fetches gated by `MEDIA_GEN_URLS` (when configured), and public URLs via `MEDIA_GEN_MCP_URL_PREFIXES`.

**Docs (Google GenAI JS SDK):**

- Main docs: https://googleapis.github.io/js-genai/
- `GoogleGenAI` class: https://googleapis.github.io/js-genai/release_docs/classes/client.GoogleGenAI.html
- `GoogleGenAIOptions`: https://googleapis.github.io/js-genai/release_docs/interfaces/client.GoogleGenAIOptions.html
- `ai.models.generateVideos(...)`: https://googleapis.github.io/js-genai/release_docs/classes/models.Models.html#generateVideos
- `ai.operations.getVideosOperation(...)`: https://googleapis.github.io/js-genai/release_docs/classes/operations.Operations.html#getVideosOperation
- `types.GenerateVideosParameters`: https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateVideosParameters.html
- `types.GenerateVideosConfig`: https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateVideosConfig.html
- `types.GenerateVideosOperation`: https://googleapis.github.io/js-genai/release_docs/classes/types.GenerateVideosOperation.html
- `types.GenerateVideosResponse`: https://googleapis.github.io/js-genai/release_docs/classes/types.GenerateVideosResponse.html
- `types.GeneratedVideo`: https://googleapis.github.io/js-genai/release_docs/interfaces/types.GeneratedVideo.html
- `PersonGeneration` enum: https://googleapis.github.io/js-genai/release_docs/enums/types.PersonGeneration.html

Reference (Google GenAI SDK):

```ts
import { GoogleGenAI, PersonGeneration } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
let op = await ai.models.generateVideos({
  model: "veo-3.1-generate-001",
  // Either pass top-level prompt/image/video:
  prompt,
  // ...or use the nested `source` object (also supported by the SDK):
  // source: { prompt },
  config: { /* GenerateVideosConfig */ },
});
op = await ai.operations.getVideosOperation({ operation: op });
```

---

## 0. Prerequisites / Dependencies

- [x] Add runtime dependency: `@google/genai`
- [x] Ensure Node version supports global `fetch` (Node 18+) or reuse existing HTTP helpers for downloads
- [x] Document + validate new env var:
  - [x] `GEMINI_API_KEY` (required for Google video tools)
  - [x] Also supported by the SDK:
    - [x] Gemini Developer API: `GOOGLE_API_KEY`
    - [x] Vertex AI: `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`

Optional follow-ups:
- [x] Mask `GEMINI_API_KEY` in startup config logging (similar to `OPENAI_API_KEY`)
- [x] Add `env.sample` entry
- [x] Add README docs for `secrets.yaml` / `--secrets-file`
- [x] (Implemented in server startup) Support `secrets.yaml` (file overrides env vars):
  - `google.api_key` → sets `GOOGLE_API_KEY` and `GEMINI_API_KEY`
  - `google.vertex_ai.enabled/project_id/location` → sets `GOOGLE_GENAI_USE_VERTEXAI/GOOGLE_CLOUD_PROJECT/GOOGLE_CLOUD_LOCATION`

---

## 1. Tools to add (MCP)

### 1.1 `google-videos-generate`

- [x] **Purpose:** Start a Google video generation operation (`ai.models.generateVideos`) and optionally wait+download results when done.

**Input schema (Zod):**

- `prompt` (string, optional) — text prompt describing the video.
  - Required unless `input_reference` (image) or `input_video_reference` (video extension) is provided.
- `input_reference` (string, optional) — optional image reference (image-to-video):
  - Accept the same “image source” formats as the existing OpenAI tools: HTTP(S) URL, base64 / `data:image/...` URL, or file path.
  - If it is a URL: enforce `MEDIA_GEN_URLS` allowlist and download bytes before sending to Google.
  - If it is a local path: resolve against `MEDIA_GEN_DIRS[0]` and enforce the allowed roots.
  - Convert to Google request shape: `image: { imageBytes: <base64>, mimeType: <image/*> }` (SDK type: `Image`).
  - Prefer **byte-sniffing** for `mimeType` (JPEG/PNG/WebP/GIF magic bytes) so this works even when `sharp` is not installed.
  - If `mimeType` cannot be determined reliably, fail with a clear message (“provide a data URL or specify mime type”).
- `input_reference_mime_type` (string, optional) — override for `mimeType` (e.g. `image/jpeg`) when `input_reference` is raw base64 without a `data:image/...` header.
- `input_video_reference` (string, optional) — optional input video for “video extension” use cases (SDK param: `video`).
  - Same source formats as `fetch-videos` / OpenAI tools: HTTP(S) URL or local file path under `MEDIA_GEN_DIRS`.
  - Mutually exclusive with `input_reference`.
- `model` (string/enum, optional) — default to Veo 2; allow Veo 3:
  - Recommended enum start: `"veo-3.1-generate-001"` (extend when new versions appear; confirm exact IDs against Google docs / SDK).
  - Alternative: accept any non-empty string + optional allowlist env var (safer for forward compatibility).

**Config (Zod):** map to Google `GenerateVideosConfig` (SDK: `generateVideos({ config: ... })`):

- `number_of_videos` (int, optional, default: `1`) — map to `numberOfVideos`.
- `aspect_ratio` (enum, optional) — `"16:9" | "9:16"` (per SDK docs/comments).
- `duration_seconds` (int, optional) — map to `durationSeconds` (confirm allowed range/values).
- `person_generation` (enum, optional) — map to `personGeneration` (SDK enum `PersonGeneration`):
  - `DONT_ALLOW | ALLOW_ADULT | ALLOW_ALL`

Optional follow-up config coverage (SDK supports):
- `fps`, `resolution`, `seed`, `negative_prompt`, `enhance_prompt`, `generate_audio`, `last_frame_reference`, `output_gcs_uri`, `reference_images`, `mask`, `compression_quality`

**Async control (Zod):**

- `wait_for_completion` (boolean, optional, default: `false`)
  - `false`: return operation metadata immediately; no download.
  - `true`: poll until done (or timeout) and optionally download.
- `timeout_ms` (int, optional, default: `900000`) — max wait time when waiting.
- `poll_interval_ms` (int, optional, default: `10000`) — polling interval (sample uses 10s).

**Download options (Zod):**

- `download_when_done` (boolean, optional, default: `true` when waiting, otherwise `false`)
  - When enabled and operation completes successfully: download generated videos into `MEDIA_GEN_DIRS[0]`.

**Output:**

- `structuredContent`:
  - When `wait_for_completion=false`: the initial operation object from `generateVideos`.
  - When `wait_for_completion=true`: the final polled operation object including `response.generatedVideos[]`.
- `content[]`:
  - A `text` block summarizing operation `name` + `done` + (if present) count of videos.
  - When downloads happen: `resource_link` blocks for each downloaded `.mp4`.
  - A final `text` block with serialized JSON for backward compatibility (same pattern as other tools).

---

### 1.2 `google-videos-retrieve-operation`

- [x] **Purpose:** Retrieve/poll an existing operation (Google long-running operation).

**Input schema (Zod):**

- `operation_name` (string, required) — the operation id/name.
  - Implementation detail: build a minimal operation reference object for the SDK call if the SDK requires the full operation object.

**Output:**

- `structuredContent`: the retrieved operation object.
- `content[]`: a `text` JSON block, optionally plus a short status line (`done=true/false`).

---

### 1.3 `google-videos-retrieve-content`

- [x] **Purpose:** Download the generated video(s) for a completed operation and return file-first MCP `resource_link`s.

**Input schema (Zod):**

- `operation_name` (string, required)
- `index` (int, optional, default: `0`) — which `generatedVideos[index]` to download
  - Optional enhancement: accept `all=true` to download all generated videos.

**Behavior notes:**

- Validate the operation is done and has `response.generatedVideos`.
- Resolve the download URL from `generatedVideo.video.uri`.
  - Append `key=<GEMINI_API_KEY>` (use `?key=` or `&key=` depending on whether a query already exists).
  - Treat the download as an HTTP(S) fetch and enforce `MEDIA_GEN_URLS` allowlist when configured (so operators can restrict outbound fetch).
- Write files under `MEDIA_GEN_DIRS[0]` using the standard naming:
  - `output_<time_t>_media-gen__google-videos-generate_<operation-or-video-id>_<index>.mp4`
- Return `resource_link` entries with `file://` or `https://` (if `MEDIA_GEN_MCP_URL_PREFIXES` is configured for the output root).

**Output:**

- `structuredContent`: the retrieved operation object (provider-native type).
- `content[]`: `resource_link` items for downloaded files + a JSON `text` block.

---

## 2. Zod schemas & exported types

- [x] Add schemas in `src/lib/schemas.ts` (mirroring the existing style):
  - `googleVideosGenerateSchema`
  - `googleVideosRetrieveOperationSchema`
  - `googleVideosRetrieveContentSchema`
- [x] Export inferred input types:
  - `GoogleVideosGenerateArgs`
  - `GoogleVideosRetrieveOperationArgs`
  - `GoogleVideosRetrieveContentArgs`
- [x] Keep naming consistent with existing OpenAI schemas (snake_case inputs where current tools use them, e.g. `wait_for_completion`, `timeout_ms`).

---

## 3. Result formatting (MCP)

- [x] **File-first output**: always return video bytes as files + `resource_link` blocks (never inline base64).
- [x] `structuredContent` should be the **Google SDK operation object** so clients can:
  - store the `operation.name`
  - inspect `done`
  - read `response.generatedVideos[]` when available
- [x] Include a final `text` JSON block for backward compatibility (matching the OpenAI tools’ pattern).

---

## 4. Polling + timeouts (when waiting)

When `wait_for_completion=true`:

1. Call `ai.models.generateVideos(...)` → get initial operation (`name`, `done=false`).
2. Loop until `done`:
   - `ai.operations.getVideosOperation({ operation })` (or equivalent by name)
   - sleep `poll_interval_ms`
   - stop after `timeout_ms` and return `isError: true` with last known status
3. On completion:
   - if `response.generatedVideos` exists → optionally download
   - otherwise return `isError: true` with a clear message (operation done but no videos present)

Keep logs on stderr via the existing structured logger (stdout reserved for MCP protocol).

---

## 5. Tests & validation

- [x] `test/schemas.test.ts`
  - validate defaults (`wait_for_completion`, polling values, config defaults)
  - validate allowed model(s) (if using enums) and config field ranges
  - validate `input_reference` is optional and `input_reference_mime_type` accepts only `image/*` values (if enforced)
- [ ] New unit tests for:
  - output naming + directory enforcement (`MEDIA_GEN_DIRS`)
  - download URL assembly (`?key=` vs `&key=`) without leaking the key into logs/results
  - `MEDIA_GEN_URLS` allowlist enforcement for downloads
  - `input_reference` decoding and mime type inference (data URL vs raw base64 vs URL vs local file)
- [ ] Optional gated integration tests:
  - only run when `GEMINI_API_KEY` is set and an opt-in env var is true (video generation is slow/costly)

---

## 6. README updates (once implemented)

- [x] Add a new section under “Tool signatures”:
  - `google-videos-generate`
  - `google-videos-retrieve-operation`
  - `google-videos-retrieve-content`
- [x] Include a recommended workflow:
  1) `google-videos-generate` with `wait_for_completion=false` → get `operation_name`
  2) `google-videos-retrieve-operation` until `done=true`
  3) `google-videos-retrieve-content` to get an `.mp4` `resource_link`
