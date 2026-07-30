import { parseCliArgs } from "./cli/parser.js";
import { CoreHttpEngine } from "./core/http.js";
import { formatError, formatResponse } from "./cli/formatter.js";
import { evaluateAssertions, POSIX_EXIT_CODES } from "./cli/assertions.js";
import { transpileToCode } from "./core/transpiler.js";

async function main() {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
    console.log(`
\x1b[1m\x1b[36m⚡ api-quick\x1b[0m - \x1b[90mHigh-Performance Multi-Interface HTTP Engine & API Workbench\x1b[0m

\x1b[1mUSAGE:\x1b[0m
  api-quick [METHOD] <URL> [headers...] [params/body...] [options...]
  api-quick <command> [options...]

\x1b[1mCOMMANDS:\x1b[0m
  \x1b[33mtui\x1b[0m                     Launch full interactive Terminal UI workbench
  \x1b[33mweb\x1b[0m [--port 4000]       Launch React Web UI with CORS bypass proxy
  \x1b[33mmock\x1b[0m --file <spec>      Launch zero-latency local mock API server
  \x1b[33mdiff\x1b[0m <url1> <url2>      Visual structural JSON diffing engine
  \x1b[33msniff\x1b[0m [dir]             Scan local source code AST for API routes
  \x1b[33mbench\x1b[0m <url> -n 1000     Run high-throughput HTTP load benchmark

\x1b[1mOPTIONS:\x1b[0m
  \x1b[32m-X, --method <METHOD>\x1b[0m   Specify HTTP method explicitly (GET, POST, PUT, DELETE, etc.)
  \x1b[32m-H, --header <K:V>\x1b[0m      Add custom request header
  \x1b[32m-b, --bearer <TOKEN>\x1b[0m    Inject Bearer Authorization token
  \x1b[32m-u, --auth <U:P>\x1b[0m        Inject Basic Authorization credentials
  \x1b[32m-m, --timeout <ms>\x1b[0m      Request timeout in milliseconds (default: 10000)
  \x1b[32m-k, --insecure\x1b[0m          Disable TLS/SSL certificate verification
  \x1b[32m-o, --output <file>\x1b[0m     Save response body directly to output file

\x1b[1mCODE GENERATION & CI ASSERTIONS:\x1b[0m
  \x1b[35m--to <lang>\x1b[0m             Transpile CLI request to target code (\x1b[33mcurl\x1b[0m, \x1b[33mfetch-ts\x1b[0m, \x1b[33mpython\x1b[0m, \x1b[33mgo\x1b[0m, \x1b[33mrust\x1b[0m)
  \x1b[35m--expect-status <code>\x1b[0m  Assert HTTP status code (e.g. 200)
  \x1b[35m--expect-max-time <ms>\x1b[0m  Assert max response time (e.g. 150ms, 1s)
  \x1b[35m--expect-header <k=v>\x1b[0m  Assert response header value
  \x1b[35m--expect-json <path=v>\x1b[0m Assert JSONPath value (e.g. $.status = OK)

\x1b[1mEXAMPLES:\x1b[0m
  api-quick GET https://api.github.com/repos/SKJUV/api-quick
  api-quick POST https://api.stripe.com/v1/charges amount=2000 currency=usd
  api-quick POST https://api.example.com/users name:="Alice" role:="ADMIN"
  api-quick GET https://api.example.com/users --to python
  api-quick GET https://api.example.com/health --expect-status 200 --expect-max-time 200ms
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
