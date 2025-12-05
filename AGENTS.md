# AGENTS.md

## Project Overview

**media-gen-mcp** is a Model Context Protocol (MCP) server providing image generation and processing tools via OpenAI's gpt-image-1 API. The server is designed for production use with strict TypeScript compilation, comprehensive error handling, and flexible output formatting for different MCP clients.

## Architecture

```
src/
├── index.ts              # MCP server entry point + tool registrations
└── lib/
    ├── compression.ts    # Image compression (sharp-based)
    ├── helpers.ts        # URL/path validation, result building
    └── schemas.ts        # Zod schemas for all tools
test/
├── compression.test.ts   # Compression module tests
├── helpers.test.ts       # Helper function tests
└── schemas.test.ts       # Schema validation tests
```

## Tools

| Tool | Purpose | OpenAI API |
|------|---------|------------|
| `openai-images-generate` | Generate images from text prompts | `images.generate` |
| `openai-images-edit` | Edit/inpaint images (1-16 inputs) | `images.edit` |
| `fetch-images` | Fetch & compress images from URLs/files | None |
| `test-tool` | Debug MCP result format | None |

## Key Design Decisions

### 1. Single-File Architecture
All server logic in `src/index.ts` for simplicity and ease of review. No complex module structure — the entire MCP server is ~950 lines.

### 2. Tool Result Format
All image tools support two parameters that control the MCP tool result shape:

- **`tool_result`** (`resource_link` | `image`, default: `resource_link`): Controls `content[]` shape
  - `resource_link`: Emits `ResourceLink` items with `file://` or `https://` URIs
  - `image`: Emits base64 `ImageContent` blocks

- **`response_format`** (`url` | `b64_json`, default: `url`): Controls `structuredContent` shape
  - `structuredContent` always contains OpenAI ImagesResponse format
  - `url`: `data[].url` contains file URLs
  - `b64_json`: `data[].b64_json` contains base64 data

Per MCP spec 5.2.6, a `TextContent` block with serialized JSON (URLs in `data[]`) is also included for backward compatibility.

### 3. Optional Sharp Dependency
The `sharp` library is an optional dependency for image compression. If unavailable, compression features gracefully degrade. This allows deployment in environments where native modules are problematic.

### 4. Strict TypeScript
All strict checks are enabled in `tsconfig.json` and used by `npm run build` / `npm run typecheck`:
- `strict: true`
- `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, `useUnknownInCatchVariables`, `alwaysStrict`
- `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`
- `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes* | OpenAI API key |
| `AZURE_OPENAI_API_KEY` | No | Azure OpenAI key (alternative) |
| `AZURE_OPENAI_ENDPOINT` | No | Azure endpoint URL |
| `MEDIA_GEN_MCP_OUTPUT_DIR` | No | Output directory for generated files (default: `/tmp`). May coincide with your public static dir. |
| `MEDIA_GEN_MCP_URL_PREFIXES` | No | Optional comma-separated HTTPS prefixes for public URLs, matched positionally to `MEDIA_GEN_DIRS` entries. |
| `MEDIA_GEN_MCP_TEST_SAMPLE_DIR` | No | Enable test-tool: sample images dir |

*Required for `openai-images-generate` and `openai-images-edit` tools.

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
- Path validation: only absolute paths accepted
- Test tool requires explicit directory configuration
- No path traversal — exact matches only
- API keys loaded from environment, never hardcoded

## Testing Strategy

### Unit Tests
```bash
npm run test         # Run vitest once
npm run test:watch   # Watch mode
```

**86 tests** across 3 modules:
- `compression.test.ts` (12) — image format detection, buffer processing, file I/O
- `helpers.test.ts` (35) — URL/path validation, output resolution, result placement
- `schemas.test.ts` (39) — Zod validation for all 4 tools, boundary tests

### Manual Testing
1. Use `test-tool` with sample images to verify result placement
2. Test each `result_placement` value with target MCP client
3. Verify compression with large images (>800KB)

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
- `sharp` — Image compression (native module)

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

## License

MIT
