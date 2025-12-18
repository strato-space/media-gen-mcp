# Video URL / EmbeddedResource Output Plan

This document proposes a **spec-first** output strategy for video tools in `media-gen-mcp`.

Goal: keep default behavior **file-first** (MCP `resource_link`), but allow **inline binary** output in a strictly MCP‑spec way using `EmbeddedResource` (BlobResourceContents) behind an explicit `tool_result` parameter.

---

## Background: how it works for OpenAI images today

Image tools (`openai-images-generate`, `openai-images-edit`, `fetch-images`, `test-images`) support:

- `tool_result` (`resource_link` | `image`, default: `resource_link`)
  - `resource_link` → `content[]` contains `ResourceLink` items (`file://...` or `https://...`)
  - `image` → `content[]` contains `ImageContent` blocks (`{ type: "image", data: <base64>, mimeType: "image/..." }`)
- `response_format` (`url` | `b64_json`, default: `url`)
  - Controls `structuredContent` in **OpenAI ImagesResponse format** (`data[].url` vs `data[].b64_json`)

Notes:

- The server still writes outputs to disk; `resource_link` URIs are derived from:
  - `file://` paths, or
  - public HTTP prefixes configured via `MEDIA_GEN_MCP_URL_PREFIXES` matched to `MEDIA_GEN_DIRS`.
- A JSON `TextContent` block is included for backward compatibility (MCP 5.2.6), even when `structuredContent` exists.

---

## Problem statement (videos)

### 1) MCP has no `video` content block

MCP `ContentBlock` types include `text`, `image`, `audio`, `resource_link`, and `resource` (EmbeddedResource).
There is **no** `video` content type, so encoding video bytes as `ImageContent` is not spec-correct.

### 2) “Put binary into `text`” is not a correct binary transport

Placing large base64 payloads inside `TextContent.text` makes:

- sanitization/truncation unreliable (payload is inside a string),
- logs and clients unstable (huge JSON text blocks),
- binary transport semantically incorrect.

---

## Proposed MCP-spec output for videos: `tool_result`

Add `tool_result` to video tools and use it to control **`content[]` shape**.

### 1) New canonical video tool_result

For video tools, introduce:

- `tool_result` (`resource_link` | `resource`, default: `resource_link`)
  - `resource_link`: emit `ResourceLink` for downloaded files (file-first)
  - `resource`: emit `EmbeddedResource` blocks with `BlobResourceContents` (inline base64)

`EmbeddedResource` shape (spec):

```jsonc
{
  "type": "resource",
  "resource": {
    "uri": "file:///.../output_....mp4", // or a synthetic urn:... if not file-backed
    "mimeType": "video/mp4",
    "blob": "AAAA...." // base64
  }
}
```

### 2) Keep file-first default

Default stays `resource_link` for production:

- smallest MCP payloads
- best client compatibility
- no base64 explosion in logs / context windows

### 3) EmbeddedResource is opt-in

Inline base64 via `resource` is only returned when the caller explicitly requests it.

Recommended additional guardrails (optional):

- a max embedded size env (`MEDIA_GEN_MCP_MAX_EMBEDDED_BYTES`)
- or explicit per-call `max_bytes` limits

---

## Proposed structuredContent alignment: `response_format`

Introduce/standardize `response_format` for Google video tools to keep `structuredContent` aligned with the provider API and stable across environments.

### Google (Veo) – provider-native fields are `videoBytes` or `uri`

Add:

- `response_format` (`url` | `b64_json`, default: `url`)

Rules:

- `url`: `structuredContent.response.generatedVideos[].video.uri` is populated with a stable URL (public URL when possible, otherwise `file://...`), and `videoBytes` is removed/omitted.
- `b64_json`: `structuredContent.response.generatedVideos[].video.videoBytes` is populated (base64), and `uri` is removed/omitted.

This mirrors the **OpenAI ImagesResponse** model (`url` vs `b64_json`) but uses Google’s native field names (`uri` vs `videoBytes`).

### OpenAI videos

OpenAI’s video job objects do not have an `url`/`b64_json` equivalent in the API response; they are job metadata.
For OpenAI videos, `structuredContent` should remain the provider-native job object, while `tool_result` controls binary delivery via:

- `openai-videos-retrieve-content` (and the “wait+download” path in create/remix)

---

## Tool-by-tool changes (proposal)

### Google tools

1) `google-videos-generate`
   - Add `tool_result` (`resource_link` | `resource`, default: `resource_link`)
   - Add `response_format` (`url` | `b64_json`, default: `url`)
   - When `wait_for_completion=true`:
     - build `structuredContent` according to `response_format`
     - build `content[]` according to `tool_result`

2) `google-videos-retrieve-content`
   - Add `tool_result` (`resource_link` | `resource`, default: `resource_link`)
   - Add `response_format` (`url` | `b64_json`, default: `url`)
   - If `tool_result=resource`, emit `EmbeddedResource` (blob) instead of `ResourceLink`.

3) `google-videos-retrieve-operation`
   - Add `response_format` (`url` | `b64_json`, default: `url`) to control whether returned operation object is “bytes-first” or “url-first” when it contains completed results.

### OpenAI tools

1) `openai-videos-retrieve-content`
   - Add `tool_result` (`resource_link` | `resource`, default: `resource_link`)
   - `resource_link`: current behavior (download to disk, return `ResourceLink`)
   - `resource`: download to disk (or stream) and return as `EmbeddedResource` (`blob`)

2) `openai-videos-create` / `openai-videos-remix`
   - When `wait_for_completion=true`, reuse the same `tool_result` behavior for downloaded assets.

---

## Image tools: proposed `tool_result` rename

To align naming across media types and keep “binary as embedded resource” consistent:

- Change image tools from:
  - `tool_result` (`resource_link` | `image`)
- To:
  - `tool_result` (`resource_link` | `resource`)

Migration options:

1) **Breaking v2**: replace `image` with `resource` entirely.
2) **Compatibility** (recommended): accept all of:
   - `resource_link` | `image` | `resource`
   - Document `image` as deprecated; recommend `resource` going forward.

---

## Logging implications

`EmbeddedResource` base64 uses the field name `blob`.

If we emit `EmbeddedResource`, the structured logger should sanitize/truncate:

- `blob` (in addition to `data`, `b64_json`, `videoBytes`, etc.)

Otherwise debug/info logs may include multi‑MB base64 payloads.

---

## Open questions to confirm before implementation

1) Do we want to keep `ImageContent` mode for ChatGPT friendliness, or standardize on `EmbeddedResource` for all inline bytes?
2) For Google `response_format=url`, should the `uri` be:
   - `file://...` always, or
   - prefer public `https://...` when `MEDIA_GEN_MCP_URL_PREFIXES` matches?
3) Do we need hard caps on embedded blobs (recommended)?
4) Should `content[]` still include JSON `text` blocks for video tools, or should we rely on `structuredContent` + resource blocks only?

