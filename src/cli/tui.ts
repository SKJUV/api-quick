import readline from "readline";
import { CoreHttpEngine } from "../core/http.js";
import { HttpMethod } from "../types/index.js";
import { colorizeJson } from "./formatter.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";
const BG_BLUE = "\x1b[44m\x1b[37m";
const GRAY = "\x1b[90m";

export async function launchTuiMode(): Promise<void> {
  console.clear();

  let selectedMethod: HttpMethod = "GET";
  let targetUrl = "https://httpbin.org/get";
  let lastResponse: any = null;
  let statusMessage = "Press [R] to send request, [U] to edit URL, [M] to change method, [Q] to quit.";

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  renderScreen();

  process.stdin.on("keypress", async (str, key) => {
    if (!key) return;

    if (key.ctrl && key.name === "c") {
      process.exit(0);
    }

    if (key.name === "q") {
      console.clear();
      console.log(`${BOLD}${CYAN}Exited api-quick TUI workbench.${RESET}\n`);
      process.exit(0);
    }

    if (key.name === "m") {
      const methods: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
      const nextIdx = (methods.indexOf(selectedMethod) + 1) % methods.length;
      selectedMethod = methods[nextIdx];
      statusMessage = `Method changed to ${selectedMethod}`;
      renderScreen();
      return;
    }

    if (key.name === "u") {
      rl.question(`\n${BOLD}${YELLOW}Enter Target URL: ${RESET}`, (answer) => {
        if (answer.trim()) {
          targetUrl = answer.trim();
          if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
            targetUrl = "https://" + targetUrl;
          }
          statusMessage = `URL set to ${targetUrl}`;
        }
        renderScreen();
      });
      return;
    }

    if (key.name === "r") {
      statusMessage = `Sending ${selectedMethod} request to ${targetUrl}...`;
      renderScreen();
      
      const engine = new CoreHttpEngine();
      try {
        const res = await engine.execute({
          url: targetUrl,
          method: selectedMethod,
          headers: { "User-Agent": "api-quick-tui/0.1" },
          timeoutMs: 10000,
          followRedirects: true,
          tlsVerify: true
        });
        lastResponse = res;
        statusMessage = `Request finished in ${res.metrics.totalTimeMs}ms with Status ${res.status}`;
      } catch (err: any) {
        lastResponse = { error: err.message };
        statusMessage = `Request failed: ${err.message}`;
      }
      renderScreen();
      return;
    }
  });

  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
  }

  function renderScreen() {
    console.clear();
    console.log(`${BG_BLUE}${BOLD} ⚡ API-QUICK INTERACTIVE TERMINAL WORKBENCH (TUI v0.1) ${RESET}\n`);
    
    console.log(`${BOLD}Target Endpoint:${RESET} ${CYAN}${selectedMethod}${RESET} ${targetUrl}`);
    console.log(`${GRAY}────────────────────────────────────────────────────────────────────────────${RESET}`);

    if (lastResponse) {
      if (lastResponse.error) {
        console.log(`${BOLD}${RED}ERROR:${RESET} ${lastResponse.error}`);
      } else {
        const statusColor = lastResponse.status < 300 ? GREEN : RED;
        console.log(`${BOLD}STATUS:${RESET} ${statusColor}${lastResponse.status} ${lastResponse.statusText}${RESET}  ${GRAY}| Time: ${lastResponse.metrics.totalTimeMs}ms | Size: ${lastResponse.metrics.bytesReceived}B${RESET}\n`);
        
        console.log(`${BOLD}RESPONSE HEADERS:${RESET}`);
        for (const [k, v] of Object.entries(lastResponse.headers as Record<string, string>)) {
          console.log(`  ${CYAN}${k}${RESET}: ${v}`);
        }
        console.log(`\n${BOLD}RESPONSE BODY:${RESET}`);
        try {
          const parsed = JSON.parse(lastResponse.body);
          console.log(colorizeJson(JSON.stringify(parsed, null, 2)));
        } catch {
          console.log(lastResponse.body);
        }
      }
    } else {
      console.log(`${GRAY}[No response data yet. Press 'R' to execute request.]${RESET}`);
    }

    console.log(`\n${GRAY}────────────────────────────────────────────────────────────────────────────${RESET}`);
    console.log(`${BOLD}${YELLOW}INFO:${RESET} ${statusMessage}`);
    console.log(`${BOLD}SHORTCUTS:${RESET} [${BOLD}R${RESET}] Run Request | [${BOLD}M${RESET}] Switch Method | [${BOLD}U${RESET}] Edit URL | [${BOLD}Q${RESET}] Quit`);
  }
}
