# AGENTS.md

## Project Overview

**media-gen-mcp** is a Model Context Protocol (MCP) server providing:

- OpenAI Images tools (`gpt-image-1.5`, `gpt-image-1`) for image generation and edits/inpainting.
- OpenAI Videos (Sora) job tooling (`sora-2`, `sora-2-pro`) for video generation and asset downloads.
- Local/URL fetching for images, videos, and documents with optional compression and video input preprocessing via `sharp`.

The server is designed for production use with strict TypeScript compilation, comprehensive error handling, and flexible output formatting for different MCP clients.

## Architecture

```
src/
├── index.ts              # MCP server entry point + tool registrations
└── lib/
    ├── compression.ts    # Image compression + format detection (sharp-based)
    ├── env.ts            # Env parsing + dir/url allowlists (+ glob support)
    ├── helpers.ts        # URL/path validation, output resolution, result building
    ├── logger.ts         # Structured logger + truncation helpers
    └── schemas.ts        # Zod schemas for all tools (exported for tests)
test/
├── compression.test.ts
├── env.test.ts
├── fetch-images.integration.test.ts
├── helpers.test.ts
├── logger.test.ts
└── schemas.test.ts
```

## Tools

| Tool | Purpose | OpenAI API |
|------|---------|------------|
| `openai-images-generate` | Generate images from text prompts | `images.generate` |
| `openai-images-edit` | Edit/inpaint/outpaint images (1–16 inputs) | `images.edit` |
| `openai-videos-create` | Create a video job | `videos.create` |
| `openai-videos-remix` | Remix an existing video job | `videos.remix` |
| `openai-videos-list` | List video jobs | `videos.list` |
| `openai-videos-retrieve` | Retrieve a video job | `videos.retrieve` |
| `openai-videos-delete` | Delete a video job | `videos.delete` |
| `openai-videos-retrieve-content` | Retrieve job assets (video/thumbnail/spritesheet) | `videos.downloadContent` |
| `fetch-images` | Fetch & compress images from URLs/files | None |
| `fetch-videos` | Fetch/list videos from URLs/files | None |
| `fetch-document` | Fetch documents from URLs/files | None |
| `test-images` | Debug MCP result format | None |

## Key Design Decisions

### 1. Mostly single-file server
Most server logic lives in `src/index.ts` for simplicity and ease of review. `src/lib/*` contains small, focused helpers and shared schemas.

### 2. Tool result format (MCP-first)
Tools return MCP `CallToolResult` with:

- `content[]` blocks (`text`, `image`, `resource_link`, `resource`)
- optional `structuredContent` for machine-readable OpenAI responses
- `isError: true` with a single `text` block for failures

For image tools, two parameters standardize output shapes:

- **`tool_result`** (`resource_link` | `image`, default: `resource_link`): Controls `content[]` shape
  - `resource_link`: Emits `ResourceLink` items with `file://` or `https://` URIs
  - `image`: Emits base64 `ImageContent` blocks

- **`response_format`** (`url` | `b64_json`, default: `url`): Controls `structuredContent` shape
  - `structuredContent` always contains OpenAI ImagesResponse format
  - `url`: `data[].url` contains file URLs
  - `b64_json`: `data[].b64_json` contains base64 data

For video download tools, `tool_result` controls `content[]` shape:

- **`tool_result`** (`resource_link` | `resource`, default: `resource_link`)
  - `resource_link`: Emits `ResourceLink` items with `file://` or `https://` URIs
  - `resource`: Emits `EmbeddedResource` blocks with base64 `resource.blob`

For document downloads (`fetch-document`), `tool_result` mirrors video behavior:

- **`tool_result`** (`resource_link` | `resource`, default: `resource_link`)
  - `resource_link`: Emits `ResourceLink` items with `file://` or `https://` URIs
  - `resource`: Emits `EmbeddedResource` blocks with base64 `resource.blob`

For Google video tools, `response_format` controls `structuredContent.response.generatedVideos[].video` fields (`uri` vs `videoBytes`).

Per MCP spec 5.2.6, a `TextContent` block with serialized JSON (URLs in `data[]`) is also included for backward compatibility.

### 3. Directory + URL safety model
- Local reads/writes are restricted to `MEDIA_GEN_DIRS` (supports glob patterns).
- Remote downloads are restricted by `MEDIA_GEN_URLS` when set.
- Public URLs for `resource_link` are derived from `MEDIA_GEN_MCP_URL_PREFIXES` matched positionally to `MEDIA_GEN_DIRS`.

### 4. Output file naming
When a tool writes outputs, the default naming is:

`output_<time_t>_media-gen__<tool>_<id>.<ext>`

- Images and `fetch-images` use a generated UUID for `<id>`.
- Videos use the OpenAI `video_id` for `<id>`.
- Documents use a generated UUID for `<id>` (default naming) or the supplied `file` base path.

`fetch-images` and `fetch-videos` also support an `ids` input to retrieve existing local outputs by ID (matching filenames containing `_{id}_` or `_{id}.` under `MEDIA_GEN_DIRS[0]`). IDs are validated to avoid path/glob injection (no `..`, `*`, `?`, or slashes).

For output location overrides:
- OpenAI tools always write under `MEDIA_GEN_DIRS[0]` (no `file` parameter).
- `fetch-images` / `fetch-videos` / `fetch-document` can still accept `file` when downloading from URLs.

### 5. Optional sharp dependency
The `sharp` library is an optional dependency for image compression and video `input_reference` preprocessing. If unavailable, compression features gracefully degrade and video `input_reference` auto-fit requires `input_reference_fit=match` (caller must provide correctly sized images).

### 6. Strict TypeScript
All strict checks are enabled in `tsconfig.json` and used by `npm run build` / `npm run typecheck`:
- `strict: true`
- `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, `useUnknownInCatchVariables`, `alwaysStrict`
- `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`
- `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes* | OpenAI API key (Images + Videos). |
| `AZURE_OPENAI_API_KEY` | No | Azure OpenAI key (enables AzureOpenAI client; videos tools are not supported when set). |
| `AZURE_OPENAI_ENDPOINT` | No | Azure endpoint URL (required when using Azure). |
| `MEDIA_GEN_DIRS` | No | Comma-separated allowed base directories (default: `/tmp/media-gen-mcp` or `%TEMP%/media-gen-mcp`). First entry is the primary output dir. Supports glob patterns. |
| `MEDIA_GEN_URLS` | No | Comma-separated allowed URL prefixes (or globs) for HTTP(S) inputs (when set, other URLs are rejected). |
| `MEDIA_GEN_MCP_URL_PREFIXES` | No | Comma-separated public HTTPS prefixes matched positionally to `MEDIA_GEN_DIRS` for building public `resource_link` URLs. |
| `MEDIA_GEN_MCP_TEST_SAMPLE_DIR` | No | Enables `test-images` and adds extra allowed read-only dirs (supports glob patterns). |
| `MEDIA_GEN_MCP_ALLOW_FETCH_LAST_N_IMAGES` | No | If `true`, allows `fetch-images` to use `n` to return the last N files from `MEDIA_GEN_DIRS[0]`. |
| `MEDIA_GEN_MCP_ALLOW_FETCH_LAST_N_VIDEOS` | No | If `true`, allows `fetch-videos` to use `n` to return the last N video files from `MEDIA_GEN_DIRS[0]`. |
| `MEDIA_GEN_MCP_DEBUG` | No | If `true`, enables verbose startup/config logging. |

*Required for OpenAI tools.

## Build & Test

```bash
# Install dependencies
npm install

# Strict build with full type checking (tsc, all strict flags enabled, skipLibCheck: false)
# Uses incremental builds (.tsbuildinfo) for faster recompilation
npm run build

# Fast bundling via esbuild (no type checking)
npm run esbuild

# Lint (ESLint with typescript-eslint)
npm run lint

# Strict type checks without emit
npm run typecheck

# Unit tests (vitest)
npm run test

# Full CI check (lint + typecheck + test)
npm run ci

# Development mode (tsx, no build step)
npm run dev
```

### Memory Constraints

TypeScript compilation and ESLint with type-aware rules require significant memory. If you encounter OOM errors:

1. Use `npm run dev` for development (tsx runs TypeScript directly)
2. Run `npm run lint` and `npm run typecheck` separately
3. Increase Node.js heap: `NODE_OPTIONS="--max-old-space-size=4096" npm run build`

## Code Quality Standards

### TypeScript
- All functions have explicit return types where non-trivial
- No `any` types without justification (warnings enabled)
- Null checks enforced throughout
- Index access returns `T | undefined`

### Error Handling
- All tool handlers wrapped in try/catch
- Errors returned as MCP `CallToolResult` with `isError: true`
- Detailed logging to stderr for debugging
- Partial success supported (e.g., `fetch-images` with some failures)

### Security
- Path validation: absolute or relative paths are resolved against `MEDIA_GEN_DIRS[0]` and must match allowed `MEDIA_GEN_DIRS` roots (glob patterns supported)
- Test tool requires explicit directory configuration
- No path traversal — resolved paths are checked against the allowlist roots/patterns
- API keys loaded from environment, never hardcoded

## Testing Strategy

### Unit Tests
```bash
npm run test         # Run vitest once
npm run test:watch   # Watch mode
```

**155 tests** across 8 files:
- `compression.test.ts` (12) — image format detection, buffer processing, file I/O
- `helpers.test.ts` (31) — URL/path validation, output resolution, result building
- `env.test.ts` (19) — env parsing, glob handling, allowlist behavior
- `logger.test.ts` (10) — log formatting and truncation safety
- `schemas.test.ts` (69) — Zod validation for all tools, boundary tests
- `pricing.test.ts` (8) — pricing estimates for videos and images
- `fetch-images.integration.test.ts` (3) — end-to-end MCP tool call behavior
- `fetch-videos.integration.test.ts` (3) — end-to-end MCP tool call behavior

### Manual Testing
1. Use `test-images` with sample images to verify result placement
2. Test `tool_result` (images: `resource_link` vs `image`; videos: `resource_link` vs `resource`) and `response_format` (`url` vs `b64_json`) with your target MCP client
3. Verify compression with large images (>800KB)
4. For videos, validate `wait_for_completion` timeouts and `openai-videos-retrieve-content` outputs (video/thumbnail/spritesheet)

### Integration Testing
```bash
# Start server with test tool enabled
MEDIA_GEN_MCP_TEST_SAMPLE_DIR=./sample \
npm run dev
```

### Type Checking
```bash
npm run typecheck  # Strict TypeScript validation
npm run lint       # ESLint with strict rules
```

## MCP Protocol Compliance

This server implements MCP 2025-11-25 specification:
- `CallToolResult` with `content`, `structuredContent`, `isError`
- Content types: `TextContent`, `ImageContent`, `ResourceLink`
- Tool annotations: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`

## Dependencies

### Runtime
- `@modelcontextprotocol/sdk` — MCP server implementation
- `openai` — OpenAI API client
- `zod` — Schema validation
- `dotenv` — Environment loading

### Optional
- `sharp` — Image compression and video input_reference preprocessing (native module)

### Development
- `typescript` — Strict compilation
- `eslint` + `typescript-eslint` — Linting
- `tsx` — TypeScript execution
- `vitest` — Unit testing

## Contributing

1. Run `npm run ci` before committing (lint + typecheck + test)
2. Ensure no TypeScript errors with strict mode
3. Follow existing code style (single-file, minimal abstractions)
4. Document new environment variables in `env.sample`
5. Update `AGENTS.md` when tools/env/tests change
6. Update `CHANGELOG.md` for user-facing changes and version bumps

## License

MIT
