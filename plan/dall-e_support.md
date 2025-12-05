# DALL·E Support Plan

This document outlines the minimal steps required to add support for DALL·E models to the `media-gen-mcp` server.

## 1. Model options

- **Extend schemas** for both image tools (`openai-images-generate` and `openai-images-edit`):
  - Today, as documented in README, `model` is a literal `"gpt-image-1"` with default `"gpt-image-1"` for both tools.
  - Plan: allow `model` to be one of:
    - `"gpt-image-1"`
    - `"dall-e-2"`
    - `"dall-e-3"` (generate only, at first).
  - Keep `gpt-image-1` as the default, preserving current behavior when `model` is omitted.

## 2. openai-images-generate: model-specific params

- **gpt-image-1** (current behavior):
  - Keep `background`, `moderation`, `output_format`, `output_compression`, `quality`, `size`, `user`.
- **dall-e-2**:
  - Supported:
    - `prompt`, `n`, `size (256x256 | 512x512 | 1024x1024)`, `user`, `response_format`.
  - Not supported / should be ignored:
    - `background`, `moderation`, `output_format`, `output_compression`, `quality`.
  - Implementation:
    - Build `imageParams` branch when `model === "dall-e-2"`.
    - Always set `response_format: "b64_json"` to reuse existing base64/file logic.
- **dall-e-3** (generate only):
  - Supported:
    - `prompt`, `n=1`, `size (1024x1024 | 1792x1024 | 1024x1792)`, `quality (standard | hd)`, `style (vivid | natural)`, `user`, `response_format`.
  - Implementation:
    - Add optional `style` and restricted `quality`/`size` in schema for `dall-e-3`.
    - Always set `response_format: "b64_json"`.

## 3. edit-image: model-specific behavior

- **gpt-image-1** (current behavior, see README "openai-images-edit"):
  - `image: string | string[]` (1–16), `mask` optional, `n`, `quality`, `size`, `user`.
- **dall-e-2**:
  - Only **one** `image` is allowed.
  - `mask` optional, must be PNG, < 4MB, same dimensions as `image`.
  - No multi-image edit; `image` must be normalized to a single `Uploadable`.
  - Implementation:
    - In handler, when `model === "dall-e-2"`:
      - Reject `imageInputs.length > 1` with a clear error.
      - Build `editParams` without gpt-image-1-only fields.
      - Set `response_format: "b64_json"`.
- **dall-e-3**:
  - Initially **not** supported for edit to keep scope small.
  - If requested with `openai-images-edit`, return a clear `isError: true` message.

## 4. Response handling

- Reuse existing logic documented in README for `openai-images-generate` / `openai-images-edit`:
  - Expect `b64_json` in `result.data[].b64_json` for all models when `response_format === "b64_json"`.
  - For base64 mode: return `content` with `image` items and optional `text` items containing revised prompts (`revised_prompt`), exactly as for `gpt-image-1` today.
  - For file mode: write images to disk and return `resource_link` items in `content`; `structuredContent` remains an OpenAI ImagesResponse-style object with `created` and `data[]` entries where each entry contains either `b64_json` (base64 mode) or `url` (file/URL mode), as described in README.
- For DALL·E models:
  - Default `mimeType` to `image/png`.

## 5. Validation and errors

- Update Zod schemas to:
  - Restrict sizes and qualities per model where practical.
  - At minimum, enforce:
    - `dall-e-2`: `n` between 1 and 10, `size` in the 256/512/1024 set.
    - `dall-e-3`: `n = 1`, `size` in the 3-value set, `quality` in `standard | hd`.
- Add clear error messages when unsupported combinations are requested, e.g.:
  - `edit-image` with `model === "dall-e-3"`.
  - `edit-image` with `model === "dall-e-2"` and multiple images.

## 6. README updates

- Document supported models per tool, using the actual tool names:
  - `openai-images-generate`: `gpt-image-1`, `dall-e-2`, `dall-e-3 (generate only)`.
  - `openai-images-edit`: `gpt-image-1`, `dall-e-2`.
- Describe model-specific options and limitations (sizes, qualities, style, edit constraints) in the tool signatures sections.
- Clarify that DALL·E support is experimental if desired.
