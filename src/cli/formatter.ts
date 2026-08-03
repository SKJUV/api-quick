import type { NetworkResponseSpec } from "../types/index.js";

// ANSI Color Constants
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const GRAY = "\x1b[90m";

export function formatResponse(res: NetworkResponseSpec): string {
  const statusColor = res.status >= 200 && res.status < 300 ? GREEN : res.status >= 400 ? RED : YELLOW;

  let output = `${BOLD}${statusColor}HTTP/1.1 ${res.status} ${res.statusText}${RESET} ${GRAY}(${res.metrics.totalTimeMs}ms, ${res.metrics.bytesReceived} bytes)${RESET}\n`;

  // Headers
  for (const [k, v] of Object.entries(res.headers)) {
    output += `${CYAN}${k}${RESET}: ${v}\n`;
  }
  output += "\n";

  // Body formatting (JSON auto-detect)
  try {
    const parsed = JSON.parse(res.body);
    const prettyJson = JSON.stringify(parsed, null, 2);
    output += colorizeJson(prettyJson);
  } catch {
    output += res.body;
  }

  output += "\n";
  return output;
}

export function colorizeJson(jsonStr: string): string {
  return jsonStr
    .replace(/("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)/g, `${BLUE}$1${RESET}$3`) // Keys
    .replace(/(:\s*)("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")/g, `$1${GREEN}$2${RESET}`) // Strings
    .replace(/(:\s*)(true|false)/g, `$1${MAGENTA}$2${RESET}`) // Booleans
    .replace(/(:\s*)(null)/g, `$1${GRAY}$2${RESET}`) // Null
    .replace(/(:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, `$1${YELLOW}$2${RESET}`); // Numbers
}

export function formatError(msg: string): string {
  return `${BOLD}${RED}✖ ${msg}${RESET}\n`;
}

export function formatSuccess(msg: string): string {
  return `${BOLD}${GREEN}✔ ${msg}${RESET}\n`;
}
