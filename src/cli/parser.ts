import { interpolateVariables, loadConfig, resolveEnvironmentVariables } from "../core/config.js";
import type { CliArguments, HttpMethod, JsonAssertion, TranspileTarget } from "../types/index.js";

const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

export function parseCliArgs(args: string[]): CliArguments {
  if (args.length === 0) {
    throw new Error("No URL or command provided. Usage: api-quick [METHOD] <URL> [params...]");
  }

  // 1. Detect --env parameter first to load target environment variables
  let targetEnv: string | undefined;
  const envIdx = args.indexOf("--env");
  if (envIdx !== -1 && envIdx + 1 < args.length) {
    targetEnv = args[envIdx + 1];
  }

  const config = loadConfig();
  const envVars = resolveEnvironmentVariables(config, targetEnv);

  // 2. Interpolate all raw arguments with environment variables
  const processedArgs = args.map((arg) => interpolateVariables(arg, envVars));

  let method: HttpMethod = "GET";
  let url = "";
  let startIndex = 0;

  const firstArgUpper = processedArgs[0].toUpperCase() as HttpMethod;
  if (HTTP_METHODS.includes(firstArgUpper)) {
    method = firstArgUpper;
    url = processedArgs[1];
    startIndex = 2;
  } else {
    url = processedArgs[0];
    startIndex = 1;
  }

  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
    if (url && (url.startsWith("localhost") || url.startsWith("127.0.0.1"))) {
      url = `http://${url}`;
    } else if (url && !url.includes("://")) {
      url = `https://${url}`;
    } else {
      throw new Error(`Invalid URL specified: "${url}"`);
    }
  }

  const headers: Record<string, string> = { ...config?.globalHeaders };
  const params: Record<string, string> = {};
  const jsonBody: Record<string, any> = {};
  let transpileTarget: TranspileTarget | undefined;
  let expectStatus: number | undefined;
  let expectMaxTimeMs: number | undefined;
  const expectHeaders: Record<string, string> = {};
  const expectAssertions: JsonAssertion[] = [];

  for (let i = startIndex; i < processedArgs.length; i++) {
    const arg = processedArgs[i];

    if (arg === "--env" && i + 1 < processedArgs.length) {
      i++; // Skip value
      continue;
    }

    if (arg === "--to" && i + 1 < processedArgs.length) {
      transpileTarget = processedArgs[++i] as TranspileTarget;
      continue;
    }

    if (arg === "--expect-status" && i + 1 < processedArgs.length) {
      expectStatus = parseInt(processedArgs[++i], 10);
      continue;
    }

    if (arg === "--expect-max-time" && i + 1 < processedArgs.length) {
      const rawTime = processedArgs[++i];
      if (rawTime.endsWith("ms")) {
        expectMaxTimeMs = parseInt(rawTime.slice(0, -2), 10);
      } else if (rawTime.endsWith("s")) {
        expectMaxTimeMs = parseFloat(rawTime.slice(0, -1)) * 1000;
      } else {
        expectMaxTimeMs = parseInt(rawTime, 10);
      }
      continue;
    }

    if (arg === "--expect-header" && i + 1 < processedArgs.length) {
      const headerPair = processedArgs[++i];
      const idx = headerPair.indexOf("=");
      if (idx !== -1) {
        expectHeaders[headerPair.slice(0, idx).toLowerCase()] = headerPair.slice(idx + 1);
      }
      continue;
    }

    if (arg === "--expect-json" && i + 2 < processedArgs.length) {
      const jsonPath = processedArgs[++i];
      const opAndVal = processedArgs[++i];
      expectAssertions.push({
        jsonPath,
        operator: "=",
        expectedValue: opAndVal,
      });
      continue;
    }

    // Header syntax: Header-Name:Header-Value
    if (arg.includes(":") && !arg.includes(":=")) {
      const idx = arg.indexOf(":");
      const key = arg.slice(0, idx).trim();
      const val = arg.slice(idx + 1).trim();
      headers[key] = val;
      continue;
    }

    // Typed JSON value body syntax: key:=value
    if (arg.includes(":=")) {
      const idx = arg.indexOf(":=");
      const key = arg.slice(0, idx).trim();
      const valStr = arg.slice(idx + 2).trim();
      try {
        jsonBody[key] = JSON.parse(valStr);
      } catch {
        jsonBody[key] = valStr;
      }
      continue;
    }

    // String body or URL param syntax: key=value
    if (arg.includes("=")) {
      const idx = arg.indexOf("=");
      const key = arg.slice(0, idx).trim();
      const val = arg.slice(idx + 1).trim();
      if (method === "GET" || method === "HEAD") {
        params[key] = val;
      } else {
        jsonBody[key] = val;
      }
    }
  }

  // Append query params to URL if GET/HEAD
  if (Object.keys(params).length > 0) {
    const urlObj = new URL(url);
    for (const [k, v] of Object.entries(params)) {
      urlObj.searchParams.append(k, v);
    }
    url = urlObj.toString();
  }

  return {
    method,
    url,
    headers,
    params,
    jsonBody: Object.keys(jsonBody).length > 0 ? jsonBody : undefined,
    transpileTarget,
    expectStatus,
    expectMaxTimeMs,
    expectHeaders: Object.keys(expectHeaders).length > 0 ? expectHeaders : undefined,
    expectAssertions,
  };
}
