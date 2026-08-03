import { Hono } from "hono";
import { cors } from "hono/cors";
import { evaluateJsonAssertion } from "../cli/assertions.js";
import { sniffProjectRoutes } from "../core/ast-sniffer.js";
import { BenchmarkEngine, type BenchmarkOptions } from "../core/benchmark.js";
import { loadConfig, resolveEnvironmentVariables } from "../core/config.js";
import { compareJsonStructures } from "../core/diff.js";
import { transpileToCode } from "../core/transpiler.js";
import { WorkflowEngine, type WorkflowStep } from "../core/workflow.js";
import type { TranspileTarget } from "../types/index.js";

export interface ExecutionLog {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  responseSize: number;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
}

const executionLogs: ExecutionLog[] = [];

export function createWebServer(currentPort: number = 4000) {
  const app = new Hono();

  app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"] }));

  app.get("/api/health", (c) => c.json({ status: "ok", engine: "api-quick", version: "1.1.0" }));

  app.get("/api/routes", (c) => {
    const rawRoutes = sniffProjectRoutes();
    const seen = new Set<string>();
    const deduplicatedRoutes = rawRoutes.filter((r) => {
      const key = `${r.method}:${r.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return c.json({ routes: deduplicatedRoutes, count: deduplicatedRoutes.length });
  });

  // Polyglot Code Transpiler API
  app.post("/api/transpile", async (c) => {
    try {
      const body = await c.req.json();
      const target = (body.target || "curl") as TranspileTarget;
      const code = transpileToCode(
        {
          method: body.method || "GET",
          url: body.url || "",
          headers: body.headers || {},
          params: body.params || {},
          jsonBody: body.jsonBody,
          rawBody: body.rawBody,
          expectAssertions: [],
        },
        target,
      );
      return c.json({ code });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Structural JSON Diff API
  app.post("/api/diff", async (c) => {
    try {
      const body = await c.req.json();
      let json1 = body.json1;
      let json2 = body.json2;

      // If URLs passed instead of raw JSON
      if (body.url1 && body.url2) {
        const [res1, res2] = await Promise.all([fetch(body.url1), fetch(body.url2)]);
        json1 = await res1.json();
        json2 = await res2.json();
      }

      const diff = compareJsonStructures(json1, json2);
      return c.json({ diff });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Environment & Config API
  app.get("/api/config", (c) => {
    const config = loadConfig();
    const envName = c.req.query("env");
    const variables = resolveEnvironmentVariables(config, envName);
    return c.json({
      config: config || null,
      activeEnvironment: envName || config?.defaultEnvironment || "default",
      environments: config?.environments ? Object.keys(config.environments) : ["default"],
      variables,
    });
  });

  // Assertions Evaluation API
  app.post("/api/assertions/evaluate", async (c) => {
    try {
      const { responseBody, status, responseTimeMs, assertions, expectStatus, expectMaxTimeMs } = await c.req.json();
      let parsedBody: any = null;
      try {
        parsedBody = typeof responseBody === "string" ? JSON.parse(responseBody) : responseBody;
      } catch {
        // Non-JSON
      }

      const results: Array<{ passed: boolean; message: string }> = [];

      if (expectStatus !== undefined) {
        const passed = status === expectStatus;
        results.push({
          passed,
          message: passed ? `HTTP Status is ${status}` : `Expected HTTP status ${expectStatus}, got ${status}`,
        });
      }

      if (expectMaxTimeMs !== undefined) {
        const passed = responseTimeMs <= expectMaxTimeMs;
        results.push({
          passed,
          message: passed
            ? `Response time ${responseTimeMs}ms <= ${expectMaxTimeMs}ms`
            : `Response time ${responseTimeMs}ms > ${expectMaxTimeMs}ms`,
        });
      }

      if (Array.isArray(assertions)) {
        for (const a of assertions) {
          const res = evaluateJsonAssertion(parsedBody, a.jsonPath, a.expectedValue);
          results.push(res);
        }
      }

      const allPassed = results.every((r) => r.passed);
      return c.json({ results, allPassed });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // E2E Workflow Execution API
  app.post("/api/workflow/run", async (c) => {
    try {
      const body = await c.req.json();
      const steps: WorkflowStep[] = body.steps || [];
      const baseHost: string = body.baseHost || `http://localhost:${currentPort}`;

      const engine = new WorkflowEngine();
      const fullSteps = steps.map((s) => ({
        ...s,
        urlTemplate: s.urlTemplate.startsWith("http")
          ? s.urlTemplate
          : `${baseHost.replace(/\/$/, "")}${s.urlTemplate.startsWith("/") ? "" : "/"}${s.urlTemplate}`,
      }));

      const results = await engine.runWorkflow(fullSteps, body.initialContext || {});
      return c.json({ results });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // High-Throughput Load Benchmark API
  app.post("/api/benchmark/run", async (c) => {
    try {
      const body = await c.req.json();
      const options: BenchmarkOptions = {
        url: body.url,
        method: body.method || "GET",
        headers: body.headers || {},
        body: body.body,
        totalRequests: body.totalRequests || 100,
        concurrency: body.concurrency || 10,
      };

      const engine = new BenchmarkEngine();
      const result = await engine.runBenchmark(options);
      return c.json({ result });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.get("/api/openapi.json", (c) => {
    const routes = sniffProjectRoutes();
    const paths: Record<string, any> = {};

    for (const r of routes) {
      if (!paths[r.path]) paths[r.path] = {};
      const methodKey = r.method.toLowerCase();

      paths[r.path][methodKey] = {
        summary: `${r.method} ${r.path}`,
        description: r.description,
        tags: [r.tag],
        security: r.requiresAuth ? [{ BearerAuth: [] }] : [],
        responses: {
          "200": { description: "Successful response" },
          "401": { description: "Unauthorized / Missing Bearer Token" },
          "500": { description: "Internal Server Error" },
        },
      };
    }

    const openApiSpec = {
      openapi: "3.0.3",
      info: {
        title: "Discovered Project API Documentation",
        version: "1.1.0",
        description: "Auto-generated OpenAPI 3.0 specification from AST source code analysis by api-quick.",
      },
      components: {
        securitySchemes: {
          BearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      paths,
    };

    return c.json(openApiSpec);
  });

  app.get("/api/probe-ports", async (c) => {
    const candidatePorts = [3000, 4000, 5000, 8080, 8000, 3001, 5001, 9000, 3002];
    const activePorts: number[] = [];

    for (const port of candidatePorts) {
      if (port === currentPort) continue;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 250);
        const res = await fetch(`http://127.0.0.1:${port}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.status) activePorts.push(port);
      } catch {
        // Port not active
      }
    }
    return c.json({ activePorts, currentPort });
  });

  app.get("/api/logs", (c) => c.json({ logs: executionLogs, count: executionLogs.length }));

  app.delete("/api/logs", (c) => {
    executionLogs.length = 0;
    return c.json({ status: "cleared" });
  });

  app.all("/proxy/*", async (c) => {
    const targetUrl = c.req.header("X-Api-Quick-Target-Url");
    if (!targetUrl) {
      return c.json({ error: "Missing X-Api-Quick-Target-Url Header" }, 400);
    }

    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      return c.json({ error: "Security Error: Only HTTP/HTTPS target protocols are allowed." }, 400);
    }

    const incomingHeaders = new Headers(c.req.raw.headers);
    incomingHeaders.delete("host");
    incomingHeaders.delete("origin");
    incomingHeaders.delete("referer");

    const method = c.req.method;
    const requestBodyText = ["GET", "HEAD"].includes(method) ? undefined : await c.req.text();
    const body = requestBodyText ? new TextEncoder().encode(requestBodyText) : undefined;

    const startTime = performance.now();
    let status = 500;
    let statusText = "Internal Server Error";
    let responseText = "";
    let totalTime = 0;

    try {
      const proxyResponse = await fetch(targetUrl, {
        method,
        headers: incomingHeaders,
        body,
      });

      totalTime = Math.round((performance.now() - startTime) * 100) / 100;
      status = proxyResponse.status;
      statusText = proxyResponse.statusText;
      responseText = await proxyResponse.text();

      executionLogs.unshift({
        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toLocaleTimeString(),
        method,
        url: targetUrl,
        status,
        statusText,
        durationMs: totalTime,
        responseSize: Buffer.byteLength(responseText, "utf-8"),
        requestBody: requestBodyText,
        responseBody: responseText,
      });

      if (executionLogs.length > 100) executionLogs.pop();

      const responseHeaders = new Headers(proxyResponse.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Expose-Headers", "*");
      responseHeaders.set("X-Api-Quick-Time-Ms", String(totalTime));

      return new Response(responseText, {
        status: proxyResponse.status,
        headers: responseHeaders,
      });
    } catch (_err: any) {
      totalTime = Math.round((performance.now() - startTime) * 100) / 100;
      executionLogs.unshift({
        id: `log-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        method,
        url: targetUrl,
        status: 502,
        statusText: "Bad Gateway",
        durationMs: totalTime,
        responseSize: 0,
        responseBody: `Connection Refused to ${targetUrl}. Is your backend server running on this port?`,
      });

      return c.json(
        {
          error: `Proxy Request Failed: Connection Refused to ${targetUrl}. Is your backend server running on this port?`,
        },
        502,
      );
    }
  });

  app.get("*", (c) => c.html(getWebUiHtml()));

  return app;
}

function getWebUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>api-quick — Universal Web Workbench</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root[data-theme="dark"] {
      --bg-gradient: radial-gradient(circle at 50% 0%, #1e293b 0%, #0f172a 50%, #080c14 100%);
      --glass-panel: rgba(15, 23, 42, 0.65);
      --glass-card: rgba(30, 41, 59, 0.55);
      --glass-border: rgba(255, 255, 255, 0.08);
      --glass-border-hover: rgba(56, 189, 248, 0.35);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --accent: #38bdf8;
      --green: #10b981;
      --yellow: #f59e0b;
      --red: #f43f5e;
      --purple: #a855f7;
      --input-bg: rgba(15, 23, 42, 0.8);
      --shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.36);
    }
    :root[data-theme="light"] {
      --bg-gradient: radial-gradient(circle at 50% 0%, #e2e8f0 0%, #f1f5f9 50%, #f8fafc 100%);
      --glass-panel: rgba(255, 255, 255, 0.75);
      --glass-card: rgba(241, 245, 249, 0.7);
      --glass-border: rgba(0, 0, 0, 0.08);
      --glass-border-hover: rgba(2, 132, 199, 0.35);
      --text: #0f172a;
      --text-muted: #64748b;
      --primary: #0284c7;
      --primary-hover: #0369a1;
      --accent: #0284c7;
      --green: #059669;
      --yellow: #d97706;
      --red: #e11d48;
      --purple: #7c3aed;
      --input-bg: rgba(255, 255, 255, 0.9);
      --shadow: 0 8px 24px 0 rgba(0, 0, 0, 0.08);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; transition: background 0.2s, border-color 0.2s, box-shadow 0.2s; }
    body {
      background: var(--bg-gradient);
      color: var(--text);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .glass {
      background: var(--glass-panel);
      backdrop-filter: blur(16px) saturate(180%);
      -webkit-backdrop-filter: blur(16px) saturate(180%);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      box-shadow: var(--shadow);
    }
    
    header {
      margin: 12px 14px 0 14px;
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-radius: 12px;
    }
    .logo {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--accent);
      display: flex;
      align-items: center;
      gap: 10px;
      letter-spacing: -0.3px;
    }
    .badge {
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: var(--accent);
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 0.72rem;
      font-weight: 600;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .layout-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 12px 14px;
      gap: 12px;
      overflow: hidden;
    }

    .base-url-bar {
      padding: 10px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      font-size: 0.85rem;
    }
    .base-url-left {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
    }
    
    main {
      flex: 2;
      display: grid;
      grid-template-columns: 360px 1fr 1fr;
      gap: 12px;
      overflow: hidden;
    }

    .card {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .card-header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--glass-border);
      font-size: 0.85rem;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(0,0,0,0.12);
    }
    
    .search-input-box {
      padding: 10px 12px;
      border-bottom: 1px solid var(--glass-border);
      display: flex;
      gap: 8px;
    }
    .search-input-box input {
      flex: 1;
      background: var(--input-bg);
      border: 1px solid var(--glass-border);
      border-radius: 8px;
      padding: 7px 12px;
      color: var(--text);
      font-size: 0.8rem;
    }

    .route-list {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .route-item {
      background: var(--glass-card);
      border: 1px solid var(--glass-border);
      border-radius: 8px;
      padding: 10px 12px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .route-item:hover {
      border-color: var(--glass-border-hover);
      transform: translateY(-1px);
    }
    
    .method-badge {
      font-weight: 700;
      font-size: 0.65rem;
      padding: 2px 8px;
      border-radius: 20px;
      letter-spacing: 0.5px;
    }
    .method-GET { background: rgba(56, 189, 248, 0.15); color: var(--accent); border: 1px solid rgba(56, 189, 248, 0.3); }
    .method-POST { background: rgba(16, 185, 129, 0.15); color: var(--green); border: 1px solid rgba(16, 185, 129, 0.3); }
    .method-PUT { background: rgba(245, 158, 11, 0.15); color: var(--yellow); border: 1px solid rgba(245, 158, 11, 0.3); }
    .method-PATCH { background: rgba(168, 85, 247, 0.15); color: var(--purple); border: 1px solid rgba(168, 85, 247, 0.3); }
    .method-DELETE { background: rgba(244, 63, 94, 0.15); color: var(--red); border: 1px solid rgba(244, 63, 94, 0.3); }

    .request-bar {
      display: flex;
      gap: 8px;
      padding: 12px;
      border-bottom: 1px solid var(--glass-border);
    }
    select, input[type="text"], button, textarea {
      font-family: inherit;
      font-size: 0.85rem;
      border-radius: 8px;
      border: 1px solid var(--glass-border);
      background: var(--input-bg);
      color: var(--text);
      padding: 8px 12px;
      outline: none;
    }
    select { color: var(--accent); font-weight: 600; cursor: pointer; }
    input[type="text"] { flex: 1; font-family: 'JetBrains Mono', monospace; }
    input[type="text"]:focus { border-color: var(--accent); }
    button.btn-primary {
      background: var(--primary);
      color: white;
      font-weight: 600;
      padding: 8px 18px;
      cursor: pointer;
      border: none;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    button.btn-primary:hover { background: var(--primary-hover); }
    button.btn-secondary {
      background: var(--glass-card);
      border: 1px solid var(--glass-border);
      color: var(--text);
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 0.78rem;
    }

    .form-group {
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    label { font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; }
    textarea { height: 90px; font-family: 'JetBrains Mono', monospace; resize: vertical; }

    pre {
      font-family: 'JetBrains Mono', monospace;
      padding: 16px;
      font-size: 0.82rem;
      overflow: auto;
      flex: 1;
      white-space: pre-wrap;
      background: var(--input-bg);
      line-height: 1.5;
    }
    .status-tag {
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 0.78rem;
      font-family: 'JetBrains Mono', monospace;
    }
    .status-2xx { background: rgba(16, 185, 129, 0.15); color: var(--green); border: 1px solid rgba(16, 185, 129, 0.3); }
    .status-4xx, .status-5xx { background: rgba(244, 63, 94, 0.15); color: var(--red); border: 1px solid rgba(244, 63, 94, 0.3); }

    .activity-drawer {
      height: 160px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .log-list {
      flex: 1;
      overflow-x: auto;
      padding: 10px;
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .log-item {
      background: var(--glass-card);
      border: 1px solid var(--glass-border);
      border-radius: 8px;
      padding: 10px 12px;
      min-width: 270px;
      cursor: pointer;
    }

    .modal-backdrop {
      display: none;
      position: fixed;
      top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(12px);
      z-index: 999;
      align-items: center;
      justify-content: center;
    }
    .modal-box {
      width: 650px;
      max-width: 92vw;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .modal-body {
      padding: 18px;
      font-size: 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 14px;
      max-height: 75vh;
      overflow-y: auto;
    }
    svg.icon { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  </style>
</head>
<body>
  <!-- Header -->
  <header class="glass">
    <div class="logo">
      <svg class="icon" style="width:20px; height:20px; stroke: var(--accent);" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
      api-quick
      <span class="badge">v1.1.0 Liquid Workbench</span>
    </div>
    <div class="header-right">
      <button id="transpileModalBtn" class="btn-primary" style="background: var(--primary);">
        <svg class="icon" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
        Transpile Code
      </button>
      <button id="diffModalBtn" class="btn-primary" style="background: var(--purple);">
        <svg class="icon" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
        JSON Diff Engine
      </button>
      <button id="runBenchBtn" class="btn-primary" style="background: var(--yellow); color: #000;">
        <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        Load Benchmark
      </button>
      <a href="/api/openapi.json" target="_blank" class="btn-secondary" style="text-decoration:none;">
        OpenAPI 3.0
      </a>
      <button id="themeToggleBtn" class="btn-secondary">
        <span id="themeLabel">Dark</span>
      </button>
    </div>
  </header>

  <div class="layout-container">
    <div class="base-url-bar glass">
      <div class="base-url-left">
        <span style="color: var(--text-muted); font-weight: 600;">Environment:</span>
        <select id="envSelect" style="padding: 4px 8px; font-size: 0.8rem;">
          <option value="default">Default</option>
        </select>

        <span style="color: var(--text-muted); font-weight: 600; margin-left: 10px;">Target Host:</span>
        <input type="text" id="baseHostInput" value="http://localhost:4000" style="width: 200px; padding: 4px 10px; font-size: 0.82rem;" />

        <span style="color: var(--text-muted); font-weight: 600; margin-left: 10px;">Bearer Auth Token:</span>
        <input type="text" id="authTokenInput" placeholder="Paste JWT Bearer Token or run /sync..." style="flex: 1; padding: 4px 10px; font-size: 0.82rem; color: var(--accent);" />
      </div>
      <div id="activePortsNotice" style="color: var(--green); font-size: 0.8rem; font-weight: 500;"></div>
    </div>

    <main>
      <!-- Left Sidebar: Discovered Routes Catalog -->
      <div class="card glass">
        <div class="card-header">
          <span>Swagger Grouped Routes (<span id="routeCount">0</span>)</span>
          <button id="resniffBtn" class="btn-secondary">Refresh AST</button>
        </div>
        <div class="search-input-box">
          <input type="text" id="routeSearchInput" placeholder="Filter routes..." />
          <select id="secFilterSelect">
            <option value="all">All</option>
            <option value="auth">Auth Required</option>
            <option value="public">Public</option>
          </select>
        </div>
        <div id="routeList" class="route-list"></div>
      </div>

      <!-- Center: HTTP Request Builder & Assertions -->
      <div class="card glass">
        <div class="card-header">
          <span>HTTP Request Builder</span>
          <button id="openTranspileBtn" class="btn-secondary">Code Generator</button>
        </div>
        <div class="request-bar">
          <select id="methodSelect">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </select>
          <input type="text" id="urlInput" value="http://localhost:4000/api/v1/auth/sync" />
          <button class="btn-primary" id="sendBtn">Execute</button>
        </div>

        <div class="form-group">
          <label>Headers (JSON)</label>
          <textarea id="headersInput" placeholder='{ "X-Custom-Header": "value" }'></textarea>
        </div>

        <div class="form-group">
          <label>Request Body (JSON)</label>
          <textarea id="bodyInput" placeholder='{ "email": "user@example.com" }'></textarea>
        </div>

        <div class="form-group">
          <label>CI Assertions (Optional)</label>
          <div style="display: flex; gap: 8px;">
            <input type="text" id="expectStatusInput" placeholder="Status Code (e.g. 200)" style="width: 140px;" />
            <input type="text" id="expectMaxTimeInput" placeholder="Max Time ms (e.g. 200)" style="width: 150px;" />
            <input type="text" id="expectJsonInput" placeholder="JSONPath=Value (e.g. $.status=OK)" style="flex:1;" />
          </div>
        </div>
      </div>

      <!-- Right Panel: Response Viewer & Assertion Verification Results -->
      <div class="card glass">
        <div class="card-header">
          <span>Response Telemetry</span>
          <div id="metricsBadge" class="status-tag" style="display: none;"></div>
        </div>
        <div id="assertionResultsBox" style="display:none; padding: 10px 14px; border-bottom: 1px solid var(--glass-border); font-size: 0.78rem;"></div>
        <pre id="responseOutput">Send a request to see output telemetry...</pre>
      </div>
    </main>

    <!-- Bottom Log Drawer -->
    <div class="activity-drawer glass">
      <div class="card-header">
        <span>Execution Telemetry Logs</span>
        <button id="clearLogsBtn" class="btn-secondary">Clear Logs</button>
      </div>
      <div id="logList" class="log-list"></div>
    </div>
  </div>

  <!-- Transpile Modal -->
  <div id="transpileModal" class="modal-backdrop">
    <div class="modal-box glass">
      <div class="card-header">
        <span>Polyglot Code Generator</span>
        <button class="btn-secondary" onclick="document.getElementById('transpileModal').style.display='none'">✕ Close</button>
      </div>
      <div class="modal-body">
        <div style="display: flex; gap: 10px; align-items: center;">
          <label>Target Language:</label>
          <select id="transpileTargetSelect">
            <option value="curl">cURL (CLI)</option>
            <option value="fetch-ts">TypeScript (fetch)</option>
            <option value="python">Python (requests)</option>
            <option value="go">Go (net/http)</option>
            <option value="rust">Rust (reqwest)</option>
            <option value="java">Java (HttpClient)</option>
            <option value="csharp">C# (HttpClient)</option>
            <option value="php">PHP (curl)</option>
          </select>
          <button id="copyTranspileBtn" class="btn-secondary">Copy Code</button>
        </div>
        <pre id="transpileCodeOutput">Generating code...</pre>
      </div>
    </div>
  </div>

  <!-- JSON Diff Modal -->
  <div id="diffModal" class="modal-backdrop">
    <div class="modal-box glass">
      <div class="card-header">
        <span>Structural JSON Diff Engine</span>
        <button class="btn-secondary" onclick="document.getElementById('diffModal').style.display='none'">✕ Close</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>URL 1 or JSON Payload 1:</label>
          <input type="text" id="diffUrl1" placeholder="https://api.example.com/v1/users/1" />
        </div>
        <div class="form-group">
          <label>URL 2 or JSON Payload 2:</label>
          <input type="text" id="diffUrl2" placeholder="https://api.example.com/v2/users/1" />
        </div>
        <button id="runDiffBtn" class="btn-primary">Compare Structures</button>
        <pre id="diffOutput">Diff results will appear here...</pre>
      </div>
    </div>
  </div>

  <!-- Load Benchmark Modal -->
  <div id="benchModal" class="modal-backdrop">
    <div class="modal-box glass">
      <div class="card-header">
        <span>High-Throughput Load Benchmark</span>
        <button class="btn-secondary" onclick="document.getElementById('benchModal').style.display='none'">✕ Close</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Target URL:</label>
          <input type="text" id="benchUrlInput" value="http://localhost:4000/api/health" />
        </div>
        <div style="display: flex; gap: 10px;">
          <div class="form-group" style="flex:1;">
            <label>Total Requests (-n):</label>
            <input type="text" id="benchRequestsInput" value="100" />
          </div>
          <div class="form-group" style="flex:1;">
            <label>Concurrency (-c):</label>
            <input type="text" id="benchConcurrencyInput" value="10" />
          </div>
        </div>
        <button id="startBenchBtn" class="btn-primary" style="background: var(--yellow); color: #000;">Run Benchmark</button>
        <pre id="benchOutput">Benchmark metrics will be displayed here...</pre>
      </div>
    </div>
  </div>

  <script>
    const methodSelect = document.getElementById('methodSelect');
    const urlInput = document.getElementById('urlInput');
    const headersInput = document.getElementById('headersInput');
    const bodyInput = document.getElementById('bodyInput');
    const sendBtn = document.getElementById('sendBtn');
    const responseOutput = document.getElementById('responseOutput');
    const metricsBadge = document.getElementById('metricsBadge');
    const routeList = document.getElementById('routeList');
    const routeSearchInput = document.getElementById('routeSearchInput');
    const secFilterSelect = document.getElementById('secFilterSelect');
    const logList = document.getElementById('logList');
    const baseHostInput = document.getElementById('baseHostInput');
    const authTokenInput = document.getElementById('authTokenInput');
    const activePortsNotice = document.getElementById('activePortsNotice');
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const themeLabel = document.getElementById('themeLabel');
    const envSelect = document.getElementById('envSelect');

    let allRoutes = [];

    // Theme Switcher
    themeToggleBtn.addEventListener('click', () => {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      themeLabel.textContent = next.charAt(0).toUpperCase() + next.slice(1);
    });

    // Load Environments & Config
    async function loadConfigEnvs() {
      try {
        const res = await fetch('/api/config');
        const data = await res.json();
        if (data.environments && data.environments.length > 0) {
          envSelect.innerHTML = data.environments.map(e => \`<option value="\${e}">\${e}</option>\`).join('');
          envSelect.value = data.activeEnvironment;
        }
      } catch (e) { }
    }

    envSelect.addEventListener('change', async () => {
      const selected = envSelect.value;
      try {
        const res = await fetch('/api/config?env=' + selected);
        const data = await res.json();
        if (data.variables && data.variables.BASE_URL) {
          baseHostInput.value = data.variables.BASE_URL;
        }
      } catch (e) {}
    });

    // Transpiler Modal Trigger
    const openTranspileBtn = document.getElementById('openTranspileBtn');
    const transpileModalBtn = document.getElementById('transpileModalBtn');
    const transpileModal = document.getElementById('transpileModal');
    const transpileTargetSelect = document.getElementById('transpileTargetSelect');
    const transpileCodeOutput = document.getElementById('transpileCodeOutput');

    function showTranspileModal() {
      transpileModal.style.display = 'flex';
      updateTranspiledCode();
    }

    openTranspileBtn.addEventListener('click', showTranspileModal);
    transpileModalBtn.addEventListener('click', showTranspileModal);

    async function updateTranspiledCode() {
      const target = transpileTargetSelect.value;
      let jsonBody = undefined;
      try {
        if (bodyInput.value.trim()) jsonBody = JSON.parse(bodyInput.value.trim());
      } catch (e) {}

      let headers = {};
      try {
        if (headersInput.value.trim()) headers = JSON.parse(headersInput.value.trim());
      } catch (e) {}

      const res = await fetch('/api/transpile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: methodSelect.value,
          url: urlInput.value.trim(),
          headers,
          jsonBody,
          target
        })
      });
      const data = await res.json();
      transpileCodeOutput.textContent = data.code || data.error;
    }

    transpileTargetSelect.addEventListener('change', updateTranspiledCode);

    document.getElementById('copyTranspileBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(transpileCodeOutput.textContent);
      alert('Transpiled code copied to clipboard!');
    });

    // JSON Diff Modal Trigger
    const diffModalBtn = document.getElementById('diffModalBtn');
    const diffModal = document.getElementById('diffModal');
    const runDiffBtn = document.getElementById('runDiffBtn');
    const diffOutput = document.getElementById('diffOutput');

    diffModalBtn.addEventListener('click', () => {
      diffModal.style.display = 'flex';
    });

    runDiffBtn.addEventListener('click', async () => {
      const url1 = document.getElementById('diffUrl1').value.trim();
      const url2 = document.getElementById('diffUrl2').value.trim();
      if (!url1 || !url2) return alert('Please enter both URLs/JSONs to compare');

      diffOutput.textContent = 'Comparing structures...';

      let body = {};
      try {
        if (url1.startsWith('{') || url1.startsWith('[')) {
          body = { json1: JSON.parse(url1), json2: JSON.parse(url2) };
        } else {
          body = { url1, url2 };
        }
      } catch (e) {
        body = { url1, url2 };
      }

      const res = await fetch('/api/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();

      if (data.diff) {
        let text = data.diff.isIdentical ? '[Success] Structures are 100% identical!\\n' : '[Diff Detected]\\n';
        if (data.diff.addedKeys.length > 0) text += '\\n+ Added Keys:\\n  ' + data.diff.addedKeys.join('\\n  ');
        if (data.diff.removedKeys.length > 0) text += '\\n- Removed Keys:\\n  ' + data.diff.removedKeys.join('\\n  ');
        if (data.diff.modifiedKeys.length > 0) text += '\\n~ Modified Types:\\n  ' + JSON.stringify(data.diff.modifiedKeys, null, 2);
        diffOutput.textContent = text;
      } else {
        diffOutput.textContent = data.error || 'Failed to compare';
      }
    });

    // Benchmark Modal Trigger
    const runBenchBtn = document.getElementById('runBenchBtn');
    const benchModal = document.getElementById('benchModal');
    const startBenchBtn = document.getElementById('startBenchBtn');
    const benchOutput = document.getElementById('benchOutput');

    runBenchBtn.addEventListener('click', () => {
      benchModal.style.display = 'flex';
    });

    startBenchBtn.addEventListener('click', async () => {
      const url = document.getElementById('benchUrlInput').value.trim();
      const totalRequests = parseInt(document.getElementById('benchRequestsInput').value.trim(), 10) || 100;
      const concurrency = parseInt(document.getElementById('benchConcurrencyInput').value.trim(), 10) || 10;

      benchOutput.textContent = 'Running load benchmark...';

      const res = await fetch('/api/benchmark/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, totalRequests, concurrency })
      });
      const data = await res.json();
      if (data.result) {
        const r = data.result;
        benchOutput.textContent = \`[Benchmark Complete]
Requests Per Second : \${r.requestsPerSecond} req/s
Total Duration      : \${r.totalDurationMs} ms
Success / Failure   : \${r.successCount} / \${r.failureCount}
Percentiles         : p50: \${r.p50Ms}ms | p95: \${r.p95Ms}ms | p99: \${r.p99Ms}ms
Min / Avg / Max     : \${r.minMs}ms / \${r.avgMs}ms / \${r.maxMs}ms\`;
      } else {
        benchOutput.textContent = data.error || 'Benchmark failed';
      }
    });

    // Load Discovered Routes
    async function loadDiscoveredRoutes() {
      try {
        const res = await fetch('/api/routes');
        const data = await res.json();
        allRoutes = data.routes || [];
        document.getElementById('routeCount').textContent = data.count || 0;
        renderRoutes();
      } catch (err) {
        routeList.innerHTML = '<div style="padding:10px; color:var(--red);">Failed to load routes</div>';
      }
    }

    function renderRoutes() {
      const query = routeSearchInput.value.toLowerCase();
      const sec = secFilterSelect.value;

      const filtered = allRoutes.filter(r => {
        const matchesQuery = r.path.toLowerCase().includes(query) || r.tag.toLowerCase().includes(query) || r.method.toLowerCase().includes(query);
        const matchesSec = sec === 'all' || (sec === 'auth' ? r.requiresAuth : !r.requiresAuth);
        return matchesQuery && matchesSec;
      });

      if (filtered.length === 0) {
        routeList.innerHTML = '<div style="padding:16px; color:var(--text-muted);">No matching AST routes</div>';
        return;
      }

      routeList.innerHTML = filtered.map(r => \`
        <div class="route-item" onclick="selectRoute('\${r.method}', '\${r.path}')">
          <div class="route-top">
            <span class="method-badge method-\${r.method}">\${r.method}</span>
            <span class="sec-badge \${r.requiresAuth ? 'sec-auth' : 'sec-public'}">\${r.requiresAuth ? 'Auth' : 'Public'}</span>
          </div>
          <div class="route-path">\${r.path}</div>
          <div class="route-meta">
            <span>\${r.tag}</span>
            <span>\${r.framework}</span>
          </div>
        </div>
      \`).join('');
    }

    function selectRoute(method, path) {
      methodSelect.value = method;
      const host = baseHostInput.value.replace(/\\/$/, '');
      urlInput.value = path.startsWith('http') ? path : host + (path.startsWith('/') ? '' : '/') + path;
    }

    routeSearchInput.addEventListener('input', renderRoutes);
    secFilterSelect.addEventListener('change', renderRoutes);
    document.getElementById('resniffBtn').addEventListener('click', loadDiscoveredRoutes);

    // Execution Logs
    async function loadExecutionLogs() {
      try {
        const res = await fetch('/api/logs');
        const data = await res.json();
        renderLogs(data.logs || []);
      } catch (e) {}
    }

    function renderLogs(logs) {
      if (logs.length === 0) {
        logList.innerHTML = '<div style="padding:10px; color:var(--text-muted); font-size:0.8rem;">No execution logs yet</div>';
        return;
      }

      logList.innerHTML = logs.map(l => \`
        <div class="log-item" onclick="selectLog('\${encodeURIComponent(JSON.stringify(l))}')">
          <div class="log-top">
            <span class="method-badge method-\${l.method}">\${l.method}</span>
            <span class="status-tag \${l.status >= 200 && l.status < 300 ? 'status-2xx' : 'status-4xx'}">\${l.status} \${l.statusText}</span>
          </div>
          <div class="log-url">\${l.url}</div>
          <div class="log-meta">
            <span>\${l.durationMs}ms</span>
            <span>\${l.timestamp}</span>
          </div>
        </div>
      \`).join('');
    }

    function selectLog(encoded) {
      const l = JSON.parse(decodeURIComponent(encoded));
      methodSelect.value = l.method;
      urlInput.value = l.url;
      if (l.requestBody) bodyInput.value = l.requestBody;
      responseOutput.textContent = l.responseBody;
      metricsBadge.style.display = 'inline-block';
      metricsBadge.className = 'status-tag ' + (l.status >= 200 && l.status < 300 ? 'status-2xx' : 'status-4xx');
      metricsBadge.textContent = \`HTTP \${l.status} \${l.statusText} (\${l.durationMs}ms)\`;
    }

    document.getElementById('clearLogsBtn').addEventListener('click', async () => {
      await fetch('/api/logs', { method: 'DELETE' });
      loadExecutionLogs();
    });

    // Execute Request
    sendBtn.addEventListener('click', async () => {
      let url = urlInput.value.trim();
      const method = methodSelect.value;
      
      if (!url) return alert('Please enter a target URL');

      responseOutput.textContent = 'Executing request via CORS proxy...';
      metricsBadge.style.display = 'none';

      let headers = {};
      try {
        if (headersInput.value.trim()) headers = JSON.parse(headersInput.value);
      } catch (e) {
        return alert('Invalid JSON in Headers');
      }

      const token = authTokenInput.value.trim();
      if (token) {
        headers['Authorization'] = token.startsWith('Bearer ') ? token : 'Bearer ' + token;
      }

      let body = undefined;
      if (['POST', 'PUT', 'PATCH'].includes(method) && bodyInput.value.trim()) {
        body = bodyInput.value.trim();
        headers['Content-Type'] = 'application/json';
      }

      const proxyUrl = '/proxy/' + encodeURIComponent(url);
      const startTime = performance.now();

      try {
        const res = await fetch(proxyUrl, {
          method,
          headers: {
            ...headers,
            'X-Api-Quick-Target-Url': url
          },
          body
        });

        const elapsed = Math.round(performance.now() - startTime);
        const text = await res.text();

        metricsBadge.style.display = 'inline-block';
        metricsBadge.className = 'status-tag ' + (res.ok ? 'status-2xx' : 'status-4xx');
        metricsBadge.textContent = \`HTTP \${res.status} \${res.statusText} (\${elapsed}ms)\`;

        try {
          const parsed = JSON.parse(text);
          responseOutput.textContent = JSON.stringify(parsed, null, 2);
        } catch {
          responseOutput.textContent = text;
        }

        // Evaluate CI assertions if set
        const expectStatus = parseInt(document.getElementById('expectStatusInput').value.trim(), 10);
        const expectMaxTimeMs = parseInt(document.getElementById('expectMaxTimeInput').value.trim(), 10);
        const expectJsonRaw = document.getElementById('expectJsonInput').value.trim();

        const assertions = [];
        if (expectJsonRaw && expectJsonRaw.includes('=')) {
          const parts = expectJsonRaw.split('=');
          assertions.push({ jsonPath: parts[0], expectedValue: parts[1] });
        }

        if (!isNaN(expectStatus) || !isNaN(expectMaxTimeMs) || assertions.length > 0) {
          const assertRes = await fetch('/api/assertions/evaluate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              responseBody: text,
              status: res.status,
              responseTimeMs: elapsed,
              expectStatus: isNaN(expectStatus) ? undefined : expectStatus,
              expectMaxTimeMs: isNaN(expectMaxTimeMs) ? undefined : expectMaxTimeMs,
              assertions
            })
          });
          const assertData = await assertRes.json();
          const box = document.getElementById('assertionResultsBox');
          box.style.display = 'block';
          box.innerHTML = (assertData.results || []).map(a => \`
            <div style="color: \${a.passed ? 'var(--green)' : 'var(--red)'}; font-weight: 600;">
              \${a.passed ? '✔' : '✖'} \${a.message}
            </div>
          \`).join('');
        }

        setTimeout(loadExecutionLogs, 100);

      } catch (err) {
        metricsBadge.style.display = 'inline-block';
        metricsBadge.className = 'status-tag status-5xx';
        metricsBadge.textContent = 'Network Error';
        responseOutput.textContent = 'Error: ' + err.message;
        setTimeout(loadExecutionLogs, 100);
      }
    });

    loadConfigEnvs();
    loadDiscoveredRoutes();
    loadExecutionLogs();
  </script>
</body>
</html>`;
}
