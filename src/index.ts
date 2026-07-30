import net from "node:net";
import { parseCliArgs } from "./cli/parser.js";
import { CoreHttpEngine } from "./core/http.js";
import { formatError, formatResponse } from "./cli/formatter.js";
import { evaluateAssertions, POSIX_EXIT_CODES } from "./cli/assertions.js";
import { transpileToCode } from "./core/transpiler.js";
import { launchTuiMode } from "./cli/tui.js";
import { createWebServer } from "./server/app.js";
import { serve } from "@hono/node-server";
import { sniffProjectRoutes } from "./core/ast-sniffer.js";
import { createMockServer } from "./core/mock.js";
import { compareJsonStructures } from "./core/diff.js";
import { BenchmarkEngine } from "./core/benchmark.js";

async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

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
  \x1b[33mmock\x1b[0m [--port 8080]      Launch zero-latency local AST mock API server
  \x1b[33mdiff\x1b[0m <url1> <url2>      Visual structural JSON diffing engine
  \x1b[33msniff\x1b[0m [dir]             Scan local source code AST for API routes
  \x1b[33mbench\x1b[0m <url> -n 100 -c 10  Run high-throughput HTTP load benchmark

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

  const firstCommand = rawArgs[0].toLowerCase();

  // Subcommand Routing
  if (firstCommand === "tui") {
    await launchTuiMode();
    return;
  }

  if (firstCommand === "web") {
    let requestedPort = 4000;
    const portIdx = rawArgs.indexOf("--port");
    if (portIdx !== -1 && rawArgs[portIdx + 1]) {
      requestedPort = parseInt(rawArgs[portIdx + 1], 10);
    }

    const availablePort = await findAvailablePort(requestedPort);

    if (availablePort !== requestedPort) {
      console.log(`\x1b[33m⚠️ Port ${requestedPort} is already in use. Automatically switching to port ${availablePort}...\x1b[0m`);
    }

    const app = createWebServer(availablePort);
    console.log(`\n\x1b[1m\x1b[36m⚡ Launching api-quick Web Workbench & CORS Proxy Server...\x1b[0m`);
    console.log(`\x1b[32m✔ Server running at:\x1b[0m \x1b[1mhttp://localhost:${availablePort}\x1b[0m`);
    console.log(`\x1b[90m(Press Ctrl+C to stop)\x1b[0m\n`);

    serve({
      fetch: app.fetch,
      port: availablePort
    });
    return;
  }

  if (firstCommand === "mock") {
    let mockPort = 8080;
    const portIdx = rawArgs.indexOf("--port");
    if (portIdx !== -1 && rawArgs[portIdx + 1]) {
      mockPort = parseInt(rawArgs[portIdx + 1], 10);
    }

    console.log(`\n\x1b[1m\x1b[33m⚡ Launching api-quick Zero-Latency AST Mock Server on http://localhost:${mockPort}...\x1b[0m`);
    createMockServer(mockPort);
    return;
  }

  if (firstCommand === "sniff") {
    const targetDir = rawArgs[1] || process.cwd();
    console.log(`\n\x1b[1m\x1b[32m⚡ Scanning AST Routes in ${targetDir}...\x1b[0m\n`);
    const routes = sniffProjectRoutes(targetDir);

    if (routes.length === 0) {
      console.log(`\x1b[33mNo routes detected in this directory.\x1b[0m`);
      return;
    }

    console.log(`\x1b[1mDiscovered ${routes.length} AST Routes:\x1b[0m\n`);
    routes.forEach((r) => {
      const secTag = r.requiresAuth ? `\x1b[31m[Auth]\x1b[0m` : `\x1b[32m[Public]\x1b[0m`;
      console.log(`\x1b[36m${r.method.padEnd(6)}\x1b[0m \x1b[1m${r.path.padEnd(40)}\x1b[0m ${secTag} \x1b[90m(${r.framework} - ${r.file}:${r.line})\x1b[0m`);
    });
    console.log("");
    return;
  }

  if (firstCommand === "bench") {
    const url = rawArgs[1];
    if (!url) {
      console.error(`\x1b[31mError: Please specify target URL for benchmark. Usage: api-quick bench <url> -n 100 -c 10\x1b[0m`);
      process.exit(1);
    }

    let totalRequests = 100;
    let concurrency = 10;

    const nIdx = rawArgs.indexOf("-n");
    if (nIdx !== -1 && rawArgs[nIdx + 1]) totalRequests = parseInt(rawArgs[nIdx + 1], 10);

    const cIdx = rawArgs.indexOf("-c");
    if (cIdx !== -1 && rawArgs[cIdx + 1]) concurrency = parseInt(rawArgs[cIdx + 1], 10);

    console.log(`\n\x1b[1m\x1b[31m⚡ Running High-Throughput Load Benchmark on ${url} (${totalRequests} requests, ${concurrency} workers)...\x1b[0m\n`);
    
    const benchEngine = new BenchmarkEngine();
    const result = await benchEngine.runBenchmark({
      url,
      totalRequests,
      concurrency
    });

    console.log(`\x1b[1m\x1b[32m✔ BENCHMARK COMPLETE:\x1b[0m`);
    console.log(`  Requests Per Second : \x1b[1m\x1b[33m${result.requestsPerSecond} req/s\x1b[0m`);
    console.log(`  Total Duration      : ${result.totalDurationMs} ms`);
    console.log(`  Successful / Failed : \x1b[32m${result.successCount}\x1b[0m / \x1b[31m${result.failureCount}\x1b[0m`);
    console.log(`  Latency Percentiles : p50: ${result.p50Ms}ms | p95: ${result.p95Ms}ms | p99: ${result.p99Ms}ms`);
    console.log(`  Min / Avg / Max     : ${result.minMs}ms / ${result.avgMs}ms / ${result.maxMs}ms\n`);
    return;
  }

  if (firstCommand === "diff") {
    const url1 = rawArgs[1];
    const url2 = rawArgs[2];

    if (!url1 || !url2) {
      console.error(`\x1b[31mError: Usage: api-quick diff <url1> <url2>\x1b[0m`);
      process.exit(1);
    }

    console.log(`\n\x1b[1m\x1b[35m⚡ Structural JSON Diffing Engine: Comparing ${url1} vs ${url2}...\x1b[0m\n`);
    
    const httpEngine = new CoreHttpEngine();
    try {
      const [res1, res2] = await Promise.all([
        httpEngine.execute({ url: url1, method: "GET", headers: {}, timeoutMs: 10000, followRedirects: true, tlsVerify: true }),
        httpEngine.execute({ url: url2, method: "GET", headers: {}, timeoutMs: 10000, followRedirects: true, tlsVerify: true })
      ]);

      const json1 = JSON.parse(res1.body);
      const json2 = JSON.parse(res2.body);

      const diff = compareJsonStructures(json1, json2);

      if (diff.isIdentical) {
        console.log(`\x1b[32m✔ Structures are 100% identical!\x1b[0m\n`);
      } else {
        if (diff.addedKeys.length > 0) {
          console.log(`\x1b[32m+ Added Keys in URL 2:\x1b[0m`, diff.addedKeys);
        }
        if (diff.removedKeys.length > 0) {
          console.log(`\x1b[31m- Missing Keys in URL 2:\x1b[0m`, diff.removedKeys);
        }
        if (diff.modifiedKeys.length > 0) {
          console.log(`\x1b[33m~ Modified Value Types:\x1b[0m`, diff.modifiedKeys);
        }
        console.log("");
      }
    } catch (err: any) {
      console.error(formatError(err.message));
    }
    return;
  }

  // Direct HTTP Request Execution
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
