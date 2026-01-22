# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Video download tools now support `tool_result=resource` to emit MCP `resource` (EmbeddedResource) blocks with base64 `resource.blob`.
- Google video tools now support `response_format` (`url` | `b64_json`) to control `structuredContent.response.generatedVideos[].video` fields (`uri` vs `videoBytes`).

### Changed
- Default OpenAI Images model is now `gpt-image-1.5` (still supports `gpt-image-1`).
- Pricing estimate rates updated for `gpt-image-1.5`.
- Default `timeout_ms` for video `wait_for_completion` is now `900000` (15 minutes).

### Fixed
- Google video tools now log operation ids at `info` level and avoid emitting huge base64 payloads in JSON `text` blocks.

## 2026-01-22

### PROBLEM SOLVED
- Needed a reliable way to persist Telegram file URLs locally for MCP workflows; added a download tool that saves files under `MEDIA_GEN_DIRS` and returns `resource_link`/`resource`.

### FEATURE IMPLEMENTED
- Added `fetch-document` for downloading generic files from URLs or reusing local paths with `tool_result=resource_link|resource` outputs.

### CHANGES
- Implemented document MIME/extension inference and tool registration in `src/index.ts`.
- Updated README/AGENTS documentation to cover fetch-document behavior and output formats.

## [1.0.1] - 2025-12-21

### Changed
- Documented model-specific size constraints and default sizing behavior for `openai-videos-create`.

## [1.0.0] - 2025-12-13

### Added
- `fetch-videos` tool to list local videos (last N) or download remote video URLs to disk and return `resource_link` items.
- `ids` lookup for `fetch-images` and `fetch-videos` to retrieve existing local outputs by ID (filename match).

### Changed
- Default output filenames now follow `output_<time_t>_media-gen__<tool>_<id>.<ext>` (images use a generated UUID; videos use the OpenAI `video_id`).
- Removed the `file` parameter from OpenAI image/video tools (always writes under `MEDIA_GEN_DIRS[0]`).
- Renamed `test-tool` to `test-images`.
- Renamed `openai-videos-download-content` to `openai-videos-retrieve-content` (aligns with `videos/content`).
- Tool annotations: `openWorldHint=false` for `fetch-images`, `fetch-videos`, and `test-images`.

## [0.2.0] - 2025-12-13

### Added
- OpenAI Videos (Sora) MCP tools: `openai-videos-create`, `openai-videos-remix`, `openai-videos-list`, `openai-videos-retrieve`, `openai-videos-delete`, `openai-videos-download-content`.
- Optional `wait_for_completion` polling for video jobs and asset downloads (video/thumbnail/spritesheet).
- `input_reference_fit` and `input_reference_background` for video creation to handle image/video dimension mismatches (auto-fit via `sharp` when available).

### Fixed
- More robust handling of `input_reference` for videos (URL/base64/file), reducing “Unable to process image bytes” and size mismatch failures by preprocessing to the requested video resolution when configured.

### Changed
- Documentation updates: SemVer/versioning notes and expanded OpenAI Videos coverage.

## [0.1.0] - 2025-12-05

### Added
- Initial MCP server with OpenAI Images tooling (`openai-images-generate`, `openai-images-edit`).
- `fetch-images` tool for URL/file ingestion with optional compression and MCP-friendly outputs.
- `test-images` for validating MCP output shapes across different clients.
