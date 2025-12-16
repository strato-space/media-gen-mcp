import fs from "node:fs";
import path from "node:path";

type JsonObject = Record<string, unknown>;

const API_KEY_HINT_TEXT = "<your-api-key-here>";

function stripInlineComment(value: string): string {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === "\"" && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === "#" && !inSingle && !inDouble) {
      return value.slice(0, i).trimEnd();
    }
  }

  return value;
}

function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";

  const lower = trimmed.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  if (lower === "null") return null;

  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number.parseFloat(trimmed);

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"") && trimmed.length >= 2)
    || (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function parseSimpleYamlMapping(input: string): JsonObject {
  const root: JsonObject = {};
  const stack: Array<{ indent: number; obj: JsonObject }> = [{ indent: -1, obj: root }];

  const lines = input.split(/\r?\n/);
  for (const lineRaw of lines) {
    const line = lineRaw.replace(/\t/g, "  "); // normalize tabs to spaces
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;

    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1]!.obj;

    const colonIndex = trimmedLine.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmedLine.slice(0, colonIndex).trim();
    if (!key) continue;

    const rest = trimmedLine.slice(colonIndex + 1);
    const valuePart = stripInlineComment(rest).trim();

    if (!valuePart) {
      const next: JsonObject = {};
      current[key] = next;
      stack.push({ indent, obj: next });
      continue;
    }

    current[key] = parseScalar(valuePart);
  }

  return root;
}

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asSecretString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed === API_KEY_HINT_TEXT) return undefined;
  if (trimmed.startsWith("<your-") && trimmed.endsWith("-here>")) return undefined;
  return trimmed;
}

export type SecretsYaml = {
  openai?: { api_key?: string };
  anthropic?: { api_key?: string };
  google?: {
    api_key?: string;
    vertex_ai?: {
      enabled?: boolean;
      project_id?: string;
      location?: string;
    };
  };
  azure?: {
    api_key?: string;
    base_url?: string;
    azure_deployment?: string;
    api_version?: string;
  };
};

export function resolveSecretsFilePath(argv: string[], cwd: string = process.cwd()): string | undefined {
  const secretsFileIndex = argv.indexOf("--secrets-file");
  const secretsFileArg = secretsFileIndex !== -1 ? argv[secretsFileIndex + 1] : undefined;
  if (typeof secretsFileArg === "string" && secretsFileArg.trim().length > 0) {
    return path.resolve(cwd, secretsFileArg);
  }

  const defaultPath = path.join(cwd, "secrets.yaml");
  return fs.existsSync(defaultPath) ? defaultPath : undefined;
}

export function loadSecretsYaml(filePath: string): SecretsYaml {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = parseSimpleYamlMapping(raw);

  const secrets: SecretsYaml = {};

  const openai = asObject(parsed["openai"]);
  if (openai) {
    const apiKey = asSecretString(openai["api_key"]);
    if (apiKey) secrets.openai = { api_key: apiKey };
  }

  const anthropic = asObject(parsed["anthropic"]);
  if (anthropic) {
    const apiKey = asSecretString(anthropic["api_key"]);
    if (apiKey) secrets.anthropic = { api_key: apiKey };
  }

  const google = asObject(parsed["google"]);
  if (google) {
    const googleSecrets: NonNullable<SecretsYaml["google"]> = {};

    const apiKey = asSecretString(google["api_key"]);
    if (apiKey) googleSecrets.api_key = apiKey;

    const vertex = asObject(google["vertex_ai"]);
    if (vertex) {
      const enabled = asBoolean(vertex["enabled"]);
      const projectId = asSecretString(vertex["project_id"]);
      const location = asSecretString(vertex["location"]);

      const vertexSecrets: NonNullable<NonNullable<SecretsYaml["google"]>["vertex_ai"]> = {};
      if (enabled !== undefined) vertexSecrets.enabled = enabled;
      if (projectId) vertexSecrets.project_id = projectId;
      if (location) vertexSecrets.location = location;

      if (Object.keys(vertexSecrets).length > 0) {
        googleSecrets.vertex_ai = vertexSecrets;
      }
    }

    if (Object.keys(googleSecrets).length > 0) {
      secrets.google = googleSecrets;
    }
  }

  const azure = asObject(parsed["azure"]);
  if (azure) {
    const azureSecrets: NonNullable<SecretsYaml["azure"]> = {};
    const apiKey = asSecretString(azure["api_key"]);
    if (apiKey) {
      azureSecrets.api_key = apiKey;
      const baseUrl = asSecretString(azure["base_url"]);
      if (baseUrl) azureSecrets.base_url = baseUrl;
      const deployment = asSecretString(azure["azure_deployment"]);
      if (deployment) azureSecrets.azure_deployment = deployment;
      const apiVersion = asSecretString(azure["api_version"]);
      if (apiVersion) azureSecrets.api_version = apiVersion;
    }

    if (Object.keys(azureSecrets).length > 0) {
      secrets.azure = azureSecrets;
    }
  }

  return secrets;
}

export function applySecretsToEnv(secrets: SecretsYaml): string[] {
  const applied: string[] = [];

  if (secrets.openai?.api_key) {
    process.env["OPENAI_API_KEY"] = secrets.openai.api_key;
    applied.push("OPENAI_API_KEY");
  }

  if (secrets.anthropic?.api_key) {
    process.env["ANTHROPIC_API_KEY"] = secrets.anthropic.api_key;
    applied.push("ANTHROPIC_API_KEY");
  }

  const vertex = secrets.google?.vertex_ai;
  if (vertex?.enabled === true) {
    process.env["GOOGLE_GENAI_USE_VERTEXAI"] = "true";
    applied.push("GOOGLE_GENAI_USE_VERTEXAI");
    if (vertex.project_id) {
      process.env["GOOGLE_CLOUD_PROJECT"] = vertex.project_id;
      applied.push("GOOGLE_CLOUD_PROJECT");
    }
    if (vertex.location) {
      process.env["GOOGLE_CLOUD_LOCATION"] = vertex.location;
      applied.push("GOOGLE_CLOUD_LOCATION");
    }
  }

  if (secrets.google?.api_key) {
    process.env["GOOGLE_API_KEY"] = secrets.google.api_key;
    applied.push("GOOGLE_API_KEY");
    process.env["GEMINI_API_KEY"] = secrets.google.api_key;
    applied.push("GEMINI_API_KEY");
  }

  if (secrets.azure?.api_key) {
    process.env["AZURE_OPENAI_API_KEY"] = secrets.azure.api_key;
    applied.push("AZURE_OPENAI_API_KEY");
    if (secrets.azure.base_url) {
      process.env["AZURE_OPENAI_ENDPOINT"] = secrets.azure.base_url;
      applied.push("AZURE_OPENAI_ENDPOINT");
    }
    if (secrets.azure.api_version) {
      process.env["OPENAI_API_VERSION"] = secrets.azure.api_version;
      applied.push("OPENAI_API_VERSION");
    }
    if (secrets.azure.azure_deployment) {
      process.env["AZURE_OPENAI_DEPLOYMENT"] = secrets.azure.azure_deployment;
      applied.push("AZURE_OPENAI_DEPLOYMENT");
    }
  }

  return applied;
}
