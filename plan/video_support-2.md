# OpenAI Videos Support (implementation snapshot)

Current behavior is implemented in `src/index.ts` and `src/lib/schemas.ts`. All OpenAI Videos API tools are live with MCP wiring, file-first downloads, and schema-backed defaults.

## Tool surface

- [x] `openai-videos-create` — Uses `videos.create`. Required `prompt`; optional `input_reference` (URL/base64/data URL/file under `MEDIA_GEN_DIRS`). Defaults: `model` `sora-2`, `input_reference_fit` `contain`, `input_reference_background` `blur` (hex `#RRGGBB`/`#RRGGBBAA` allowed), `wait_for_completion` false, `timeout_ms` 300000, `poll_interval_ms` 2000, `download_variants` `["video"]`. `seconds`/`size` enums are optional; when `input_reference` is provided, `size` defaults to `720x1280` for both preprocessing and the API call (otherwise omitted). Azure is blocked (`AZURE_OPENAI_API_KEY` throws). No wait → progress text + summary JSON `{ video_id, pricing, usage }` + JSON of the create response; wait → polls, then downloads requested variants to `MEDIA_GEN_DIRS`, emits `resource_link` entries, an asset summary JSON block `{ video_id, assets, pricing, usage }`, and JSON of the final `Videos.Video` (`structuredContent`).
- [x] `openai-videos-remix` — Uses `videos.remix(video_id, { prompt })` with the same wait/poll/download defaults. No wait → progress text + summary JSON `{ video_id, pricing, usage }` + remix job JSON; wait → polls, then downloads variants, emits `resource_link` entries, an asset summary JSON block `{ video_id, assets, pricing, usage }`, and JSON of the final `Videos.Video` (`structuredContent`).
- [x] `openai-videos-list` — `after` cursor, `limit` 1–100, `order` `asc|desc`. Returns text JSON plus `structuredContent` `{ data, has_more, last_id }`.
- [x] `openai-videos-retrieve` — Requires `video_id`; returns text JSON and `structuredContent` `Videos.Video`.
- [x] `openai-videos-delete` — Requires `video_id`; returns delete response JSON and `structuredContent` `Videos.VideoDeleteResponse`.
- [x] `openai-videos-retrieve-content` — Requires `video_id`; `variant` defaults to `video`. Validates the job is `completed`, then downloads the asset to an allowed directory and returns a `resource_link`, a summary JSON `{ video_id, variant, uri, pricing, usage }`, and the retrieved `Videos.Video` in both text and `structuredContent`.
- [x] Utility: `fetch-videos` mirrors `fetch-images` for video files/URLs (with `sources`/`ids`/`n` and optional download), keeping results inside `MEDIA_GEN_DIRS` with `resource_link` output.

## Input preprocessing and guards

- [x] `loadImageBufferFromReference` accepts HTTP(S) URLs allowed by `MEDIA_GEN_URLS`, base64/data URLs, or local paths inside `MEDIA_GEN_DIRS`, detecting formats via `detectImageFormat` and preserving the best mime/extension.
- [x] `preprocessInputReferenceForVideo` uses `sharp` when available for `input_reference_fit` (`match|cover|contain|stretch`). `contain` defaults to a blurred background; `black`, `white`, or hex colors are supported. If resizing is needed but `sharp` is unavailable, the tool errors (unless `fit=match` with already matching dimensions).
- [x] File output paths are validated/writable via `validateOutputDirectory`; `resolveVideoBaseOutputPath` seeds names with the tool + video id; `buildPublicUrlForFile` swaps `file://` for HTTP when `MEDIA_GEN_MCP_URL_PREFIXES` maps a root.

## Downloads, content, and polling

- [x] Assets are fetched through `videos.downloadContent`, with extensions inferred from response headers or the requested variant (`.mp4`/`.png`/`.jpg`/`.webp`/`.zip`) and mime types normalized. Multiple variants get suffixed filenames.
- [x] `waitForVideoCompletion` polls `videos.retrieve` until `completed` (returns) or `failed/timeout` (throws with a clear message). `poll_interval_ms` and `timeout_ms` defaults come from the schemas.
- [x] `structuredContent` always carries the OpenAI object type for the endpoint; `content[]` mixes progress/status text, serialized JSON for backward compatibility, and `resource_link` blocks when downloads occur (no inline base64 for videos).
