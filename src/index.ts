import { parseCliArgs } from "./cli/parser.js";
import { CoreHttpEngine } from "./core/http.js";
import { formatError, formatResponse } from "./cli/formatter.js";
import { evaluateAssertions, POSIX_EXIT_CODES } from "./cli/assertions.js";
import { transpileToCode } from "./core/transpiler.js";

async function main() {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
    console.log(`
⚡ api-quick - High-Performance Multi-Interface HTTP Engine & API Workbench

Usage:
  api-quick [METHOD] <URL> [headers...] [params/body...] [options...]

Examples:
  api-quick GET https://api.github.com/repos/SKJUV/api-quick
  api-quick POST https://api.stripe.com/v1/charges amount=2000 currency=usd
  api-quick POST https://api.example.com/users name:="Alice" role:="ADMIN"
  api-quick GET https://api.example.com/users --to python
  api-quick GET https://api.example.com/health --expect-status 200 --expect-max-time 200ms

Options:
  --to <lang>             Transpile CLI request to target code (curl, fetch-ts, python, go)
  --expect-status <code}  Assert HTTP status code (e.g. 200)
  --expect-max-time <ms>  Assert max response time in ms or s (e.g. 150ms, 1s)
  --expect-header <k=v>   Assert response header value
  --expect-json <path=v>  Assert JSONPath value (e.g. $.status = OK)
`);
    process.exit(POSIX_EXIT_CODES.EXIT_SUCCESS);
  }

  try {
    const cliArgs = parseCliArgs(rawArgs);

    // Code Transpilation Mode (--to)
    if (cliArgs.transpileTarget) {
      const code = transpileToCode(cliArgs, cliArgs.transpileTarget);
      console.log(code);
      process.exit(POSIX_EXIT_CODES.EXIT_SUCCESS);
    }

    // Execution Mode
    const httpEngine = new CoreHttpEngine();
    const response = await httpEngine.execute({
      url: cliArgs.url,
      method: cliArgs.method,
      headers: cliArgs.headers,
      body: cliArgs.jsonBody ? JSON.stringify(cliArgs.jsonBody) : cliArgs.rawBody,
      timeoutMs: 10000,
      followRedirects: true,
      tlsVerify: true
    });

    // Format & Output Response
    console.log(formatResponse(response));

    // Evaluate Assertions if present
    const exitCode = evaluateAssertions(cliArgs, response);
    process.exit(exitCode);

  } catch (err: any) {
    console.error(formatError(err.message));
    if (err.message.includes("timed out") || err.message.includes("fetch failed")) {
      process.exit(POSIX_EXIT_CODES.EXIT_NETWORK_TIMEOUT);
    }
    process.exit(POSIX_EXIT_CODES.EXIT_SYNTAX_ERROR);
  }
}

main();
