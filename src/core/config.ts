import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface EnvironmentConfig {
  variables?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface ApiQuickConfig {
  defaultEnvironment?: string;
  environments?: Record<string, EnvironmentConfig>;
  globalHeaders?: Record<string, string>;
  timeoutMs?: number;
}

export function loadConfig(targetDir = process.cwd()): ApiQuickConfig | null {
  const localConfigPath = path.join(targetDir, ".api-quickrc.json");
  const homeConfigPath = path.join(os.homedir(), ".api-quickrc.json");

  if (fs.existsSync(localConfigPath)) {
    try {
      const content = fs.readFileSync(localConfigPath, "utf-8");
      return JSON.parse(content);
    } catch {
      // Return null on invalid json
    }
  }

  if (fs.existsSync(homeConfigPath)) {
    try {
      const content = fs.readFileSync(homeConfigPath, "utf-8");
      return JSON.parse(content);
    } catch {
      // Return null on invalid json
    }
  }

  return null;
}

export function interpolateVariables(text: string, vars: Record<string, string>): string {
  if (!text) return text;
  let result = text;

  // Double curly braces: {{VAR_NAME}}
  result = result.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, varName) => {
    return vars[varName] !== undefined ? vars[varName] : `{{${varName}}}`;
  });

  // Shell style: ${VAR_NAME}
  result = result.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_, varName) => {
    return vars[varName] !== undefined ? vars[varName] : `\${${varName}}`;
  });

  return result;
}

export function resolveEnvironmentVariables(config: ApiQuickConfig | null, envName?: string): Record<string, string> {
  const mergedVars: Record<string, string> = { ...process.env } as Record<string, string>;

  if (!config) return mergedVars;

  const targetEnv = envName || config.defaultEnvironment || "default";

  if (config.environments?.[targetEnv]?.variables) {
    Object.assign(mergedVars, config.environments[targetEnv].variables);
  }

  return mergedVars;
}
