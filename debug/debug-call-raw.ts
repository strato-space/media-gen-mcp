import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ResultSchema } from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

// New parameter types: tool_result and response_format
type ToolResultCli = "resource_link" | "image";
type ResponseFormatCli = "url" | "b64_json";

interface CliArgs {
  tool_result: ToolResultCli;
  response_format: ResponseFormatCli;
}

function parseCliArgs(args: string[]): CliArgs {
  let tool_result: ToolResultCli = "resource_link";
  let response_format: ResponseFormatCli = "url";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--tool_result") {
      const value = args[i + 1];
      if (value === "resource_link" || value === "image") {
        tool_result = value;
        i += 1;
      } else {
        throw new Error("Invalid --tool_result value. Allowed values: resource_link, image.");
      }
    } else if (arg === "--response_format") {
      const value = args[i + 1];
      if (value === "url" || value === "b64_json") {
        response_format = value;
        i += 1;
      } else {
        throw new Error("Invalid --response_format value. Allowed values: url, b64_json.");
      }
    }
  }

  return { tool_result, response_format };
}

function truncateString(value: unknown, max: number): unknown {
  if (typeof value !== "string") return value;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...(${value.length} chars)`;
}

function truncateImageFields(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => truncateImageFields(item));
  }

  const input = obj as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (key === "image_url") {
      result[key] = truncateString(value, 80);
    } else if (key === "b64_json") {
      // Always truncate raw base64 payloads in b64_json
      result[key] = truncateString(value, 25);
    } else if (key === "data" && typeof value === "string") {
      // In some structures (e.g. ChatGPT base64 source) data is itself a base64 string
      result[key] = truncateString(value, 25);
    } else {
      // Recurse into nested objects/arrays so that inner b64_json/image_url fields are truncated
      result[key] = truncateImageFields(value);
    }
  }

  return result;
}

async function main() {
  const sampleDir =
    process.env.MEDIA_GEN_MCP_TEST_SAMPLE_DIR ||
    path.resolve(process.cwd(), "media/samples/");

  const transport = new StdioClientTransport({
    command: "tsx",
    args: ["src/index.ts"],
    env: {
      ...(process.env as Record<string, string>),
      MEDIA_GEN_MCP_TEST_SAMPLE_DIR: sampleDir,
    },
  });

  const client = new Client(
    { name: "debug-client-raw", version: "0.1.0" },
    { capabilities: {} },
  );

  await client.connect(transport);

  const { tool_result, response_format } = parseCliArgs(process.argv.slice(2));

  // Send normal MCP tools/call request, validate only ResultSchema
  // to avoid CallToolResultSchema defaults (e.g. content: [])
  const raw = await client.request(
    {
      method: "tools/call",
      params: {
        name: "test-tool",
        arguments: {
          tool_result,
          response_format,
        },
      },
    } as any,
    ResultSchema as unknown as any,
  );

  // raw — это содержимое поля "result" JSON-RPC-ответа (CallToolResult),
  // пропущенное только через базовый ResultSchema без навешивания content: [].
  const truncated = truncateImageFields(raw);
  console.log(JSON.stringify(truncated, null, 2));

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
