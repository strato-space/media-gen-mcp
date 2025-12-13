# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
