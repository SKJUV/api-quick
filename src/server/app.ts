import { Hono } from "hono";
import { cors } from "hono/cors";
import { sniffProjectRoutes } from "../core/ast-sniffer.js";
import { BenchmarkEngine, type BenchmarkOptions } from "../core/benchmark.js";
import { WorkflowEngine, type WorkflowStep } from "../core/workflow.js";

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

  app.get("/api/health", (c) => c.json({ status: "ok", engine: "api-quick", version: "1.0.0" }));

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
        version: "1.0.0",
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
  <title>api-quick — Liquid Glass API Workbench</title>
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

    /* iOS Liquid Glass Card Base */
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
      grid-template-columns: 380px 1fr 1fr;
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
    .search-input-box select {
      padding: 6px 10px;
      font-size: 0.78rem;
      border-radius: 8px;
    }

    .group-header {
      background: rgba(56, 189, 248, 0.08);
      border-left: 3px solid var(--accent);
      padding: 6px 12px;
      font-size: 0.72rem;
      font-weight: 700;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 8px;
      border-radius: 4px;
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
    .route-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
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
    
    .route-path {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text);
      word-break: break-all;
    }
    .route-meta {
      font-size: 0.72rem;
      color: var(--text-muted);
      margin-top: 4px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .sec-badge {
      font-size: 0.65rem;
      padding: 2px 7px;
      border-radius: 20px;
      font-weight: 600;
    }
    .sec-auth { background: rgba(244, 63, 94, 0.1); color: var(--red); border: 1px solid rgba(244, 63, 94, 0.3); }
    .sec-public { background: rgba(16, 185, 129, 0.1); color: var(--green); border: 1px solid rgba(16, 185, 129, 0.3); }

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
    select {
      color: var(--accent);
      font-weight: 600;
      cursor: pointer;
    }
    input[type="text"] {
      flex: 1;
      font-family: 'JetBrains Mono', monospace;
    }
    input[type="text"]:focus {
      border-color: var(--accent);
    }
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
      transition: background 0.15s;
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
    button.btn-secondary:hover { border-color: var(--glass-border-hover); }

    .form-group {
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    label {
      font-size: 0.72rem;
      color: var(--text-muted);
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.5px;
    }
    textarea {
      height: 120px;
      font-family: 'JetBrains Mono', monospace;
      resize: vertical;
    }
    textarea:focus { border-color: var(--accent); }

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

    /* Bottom Activity Drawer */
    .activity-drawer {
      height: 180px;
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
      transition: all 0.15s;
    }
    .log-item:hover { border-color: var(--accent); }
    .log-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .log-url { font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .log-meta { font-size: 0.72rem; color: var(--text-muted); margin-top: 4px; display: flex; justify-content: space-between; }

    /* Modal Overlay UI */
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
      width: 620px;
      max-width: 90vw;
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
      max-height: 70vh;
      overflow-y: auto;
    }
    .guide-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
      margin-top: 6px;
    }
    .guide-table th, .guide-table td {
      border: 1px solid var(--glass-border);
      padding: 10px 12px;
      text-align: left;
    }
    .guide-table th {
      background: rgba(0,0,0,0.15);
      color: var(--accent);
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
      <span class="badge">v1.0.0 Liquid Engine</span>
    </div>
    <div class="header-right">
      <button id="authGuideBtn" class="btn-secondary" style="color: var(--accent); border-color: rgba(56, 189, 248, 0.4);">
        <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
        Auth Guide
      </button>
      <button id="runWorkflowBtn" class="btn-primary" style="background: var(--purple);">
        <svg class="icon" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        Run E2E Workflow
      </button>
      <button id="runBenchBtn" class="btn-primary" style="background: var(--yellow); color: #000;">
        <svg class="icon" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
        Load Test
      </button>
      <a href="/api/openapi.json" target="_blank" class="btn-secondary" style="text-decoration:none;">
        <svg class="icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
        OpenAPI 3.0
      </a>
      <button id="themeToggleBtn" class="btn-secondary">
        <svg class="icon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
        <span id="themeLabel">Dark</span>
      </button>
    </div>
  </header>

  <div class="layout-container">
    <!-- Config Bar for Backend Host, Port, and Authorization Token -->
    <div class="base-url-bar glass">
      <div class="base-url-left">
        <span style="color: var(--text-muted); font-weight: 600;">Target Host:</span>
        <input type="text" id="baseHostInput" value="http://localhost:4000" style="width: 200px; padding: 5px 10px; font-size: 0.82rem;" />
        <span style="color: var(--text-muted); font-weight: 600; margin-left: 10px;">Bearer Auth Token:</span>
        <input type="text" id="authTokenInput" placeholder="Paste Bearer Token or run /sync to auto-capture..." style="flex: 1; padding: 5px 10px; font-size: 0.82rem; color: var(--accent);" />
      </div>
      <div id="activePortsNotice" style="color: var(--green); font-size: 0.8rem; font-weight: 500;"></div>
    </div>

    <main>
      <!-- Left Sidebar: Discovered Routes Catalog Grouped by OpenAPI Tag & Execution Flow -->
      <div class="card glass">
        <div class="card-header">
          <span>Swagger Grouped Routes (<span id="routeCount">0</span>)</span>
          <button id="resniffBtn" class="btn-secondary">
            <svg class="icon" viewBox="0 0 24 24"><path d="M21.5 2v6h-6M2.13 15.57a10 10 0 1 0 4-13.84L1.5 8"></path></svg>
            Refresh AST
          </button>
        </div>
        <div class="search-input-box">
          <input type="text" id="routeSearchInput" placeholder="Filter routes by path, tag, or method..." />
          <select id="secFilterSelect">
            <option value="all">All Routes</option>
            <option value="auth">Token Required</option>
            <option value="public">Public</option>
          </select>
        </div>
        <div id="routeList" class="route-list">
          <div style="padding: 16px; color: var(--text-muted); font-size: 0.8rem;">Scanning workspace directory...</div>
        </div>
      </div>

      <!-- Request Panel -->
      <div class="card glass">
        <div class="card-header">
          <span>HTTP Request Builder</span>
        </div>
        <div class="request-bar">
          <select id="methodSelect">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </select>
          <input type="text" id="urlInput" value="http://localhost:4000/api/v1/auth/sync" placeholder="Enter target request URL..." />
          <button class="btn-primary" id="sendBtn">
            <svg class="icon" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            Execute
          </button>
        </div>

        <div class="form-group">
          <label>Headers (JSON)</label>
          <textarea id="headersInput">{\n  "Accept": "application/json"\n}</textarea>
        </div>

        <div class="form-group">
          <label>JSON Body Payload</label>
          <textarea id="bodyInput" placeholder='{\n  "email": "user@example.com",\n  "password": "yourpassword"\n}'></textarea>
        </div>
      </div>

      <!-- Response Panel -->
      <div class="card glass">
        <div class="card-header">
          <span>Response Inspector & Diagnostics</span>
          <span id="metricsBadge" class="status-tag" style="display:none;"></span>
        </div>
        <pre id="responseOutput">// Select any discovered route from the left sidebar to execute request.</pre>
      </div>
    </main>

    <!-- Bottom Activity Drawer: Action Execution Telemetry Logs -->
    <div class="activity-drawer glass">
      <div class="card-header">
        <span>Execution Telemetry Logs</span>
        <button id="clearLogsBtn" class="btn-secondary" style="color: var(--red); border-color: rgba(244, 63, 94, 0.3);">
          <svg class="icon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          Clear Logs
        </button>
      </div>
      <div id="logList" class="log-list">
        <div style="padding: 14px; color: var(--text-muted); font-size: 0.8rem;">No execution logs recorded.</div>
      </div>
    </div>
  </div>

  <!-- Auth Guide Modal UI -->
  <div id="guideModalBackdrop" class="modal-backdrop">
    <div class="modal-box glass">
      <div class="card-header">
        <span>Authentication & JWT Token Guide</span>
        <button id="closeGuideModalBtn" class="btn-secondary">X</button>
      </div>
      <div class="modal-body">
        <p>This guide explains how JWT Bearer Tokens are automatically captured and injected into your requests across different framework architectures.</p>
        
        <table class="guide-table">
          <thead>
            <tr>
              <th>Framework</th>
              <th>Login Endpoint</th>
              <th>Token JSON Response Key</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Express / Node.js (Papyrus)</strong></td>
              <td><code>POST /api/v1/auth/sync</code></td>
              <td><code>{ "token": "eyJhbG..." }</code></td>
            </tr>
            <tr>
              <td><strong>NestJS (TypeScript)</strong></td>
              <td><code>POST /auth/login</code></td>
              <td><code>{ "accessToken": "eyJhbG..." }</code></td>
            </tr>
            <tr>
              <td><strong>FastAPI (Python)</strong></td>
              <td><code>POST /token</code></td>
              <td><code>{ "access_token": "eyJhbG..." }</code></td>
            </tr>
            <tr>
              <td><strong>Django REST</strong></td>
              <td><code>POST /api/token/</code></td>
              <td><code>{ "access": "eyJhbG..." }</code></td>
            </tr>
            <tr>
              <td><strong>Laravel Sanctum (PHP)</strong></td>
              <td><code>POST /api/login</code></td>
              <td><code>{ "token": "eyJhbG..." }</code></td>
            </tr>
          </tbody>
        </table>

        <div style="background: rgba(56, 189, 248, 0.08); padding: 12px; border-radius: 8px; border: 1px solid var(--glass-border); font-size: 0.78rem; margin-top: 6px;">
          <strong>Automatic Token Injection:</strong><br />
          When you execute any login endpoint that returns a token key, <code>api-quick</code> recursively extracts the token and populates the <code>Bearer Auth Token</code> header bar automatically!
        </div>
      </div>
    </div>
  </div>

  <script>
    const routeList = document.getElementById('routeList');
    const routeCount = document.getElementById('routeCount');
    const routeSearchInput = document.getElementById('routeSearchInput');
    const secFilterSelect = document.getElementById('secFilterSelect');
    const resniffBtn = document.getElementById('resniffBtn');
    const sendBtn = document.getElementById('sendBtn');
    const methodSelect = document.getElementById('methodSelect');
    const urlInput = document.getElementById('urlInput');
    const headersInput = document.getElementById('headersInput');
    const bodyInput = document.getElementById('bodyInput');
    const responseOutput = document.getElementById('responseOutput');
    const metricsBadge = document.getElementById('metricsBadge');
    const logList = document.getElementById('logList');
    const clearLogsBtn = document.getElementById('clearLogsBtn');
    const baseHostInput = document.getElementById('baseHostInput');
    const authTokenInput = document.getElementById('authTokenInput');
    const activePortsNotice = document.getElementById('activePortsNotice');
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const themeLabel = document.getElementById('themeLabel');
    const runWorkflowBtn = document.getElementById('runWorkflowBtn');
    const runBenchBtn = document.getElementById('runBenchBtn');
    const authGuideBtn = document.getElementById('authGuideBtn');
    const guideModalBackdrop = document.getElementById('guideModalBackdrop');
    const closeGuideModalBtn = document.getElementById('closeGuideModalBtn');

    let allRoutes = [];
    let allLogs = [];
    const themes = ['dark', 'light'];
    let currentThemeIdx = 0;

    themeToggleBtn.addEventListener('click', () => {
      currentThemeIdx = (currentThemeIdx + 1) % themes.length;
      const nextTheme = themes[currentThemeIdx];
      document.documentElement.setAttribute('data-theme', nextTheme);
      themeLabel.textContent = nextTheme.toUpperCase();
    });

    authGuideBtn.addEventListener('click', () => {
      guideModalBackdrop.style.display = 'flex';
    });

    closeGuideModalBtn.addEventListener('click', () => {
      guideModalBackdrop.style.display = 'none';
    });

    guideModalBackdrop.addEventListener('click', (e) => {
      if (e.target === guideModalBackdrop) guideModalBackdrop.style.display = 'none';
    });

    runBenchBtn.addEventListener('click', async () => {
      const url = urlInput.value.trim();
      if (!url) return alert('Please select a route to benchmark');

      responseOutput.textContent = 'Running High-Throughput Concurrent Load Benchmark (100 requests, 10 workers)...';
      metricsBadge.style.display = 'none';

      try {
        const res = await fetch('/api/benchmark/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            method: methodSelect.value,
            totalRequests: 100,
            concurrency: 10
          })
        });

        const data = await res.json();
        responseOutput.textContent = JSON.stringify(data.result, null, 2);
        
        metricsBadge.style.display = 'inline-block';
        metricsBadge.className = 'status-tag status-2xx';
        metricsBadge.textContent = \`Benchmark: \${data.result.requestsPerSecond} req/s (p95: \${data.result.p95Ms}ms)\`;

      } catch (err) {
        responseOutput.textContent = 'Benchmark Error: ' + err.message;
      }
    });

    runWorkflowBtn.addEventListener('click', async () => {
      responseOutput.textContent = 'Running Full E2E Workflow Test Scenario...';
      metricsBadge.style.display = 'none';

      const baseHost = baseHostInput.value.trim();
      const defaultSteps = [
        {
          id: 'step-1',
          name: '1. Auth Login / Sync',
          method: 'POST',
          urlTemplate: '/api/v1/auth/sync',
          bodyTemplate: JSON.stringify({ email: "admin@example.com", password: "secretpassword" })
        },
        {
          id: 'step-2',
          name: '2. Get User Profile',
          method: 'GET',
          urlTemplate: '/api/v1/auth/me'
        },
        {
          id: 'step-3',
          name: '3. Fetch Admin Dashboard',
          method: 'GET',
          urlTemplate: '/api/v1/admin/dashboard'
        }
      ];

      try {
        const res = await fetch('/api/workflow/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseHost,
            steps: defaultSteps,
            initialContext: { authToken: authTokenInput.value.trim() }
          })
        });

        const data = await res.json();
        responseOutput.textContent = JSON.stringify(data, null, 2);
        
        metricsBadge.style.display = 'inline-block';
        metricsBadge.className = 'status-tag status-2xx';
        metricsBadge.textContent = 'E2E Workflow Complete';

        setTimeout(loadExecutionLogs, 100);
      } catch (err) {
        responseOutput.textContent = 'Workflow Error: ' + err.message;
      }
    });

    function extractTokenRecursive(obj) {
      if (!obj || typeof obj !== 'object') return null;
      const keys = ['token', 'accessToken', 'access_token', 'jwt', 'authToken', 'auth_token', 'bearerToken', 'bearer'];
      for (const k of keys) {
        if (obj[k] && typeof obj[k] === 'string' && obj[k].length > 10) return obj[k];
      }
      for (const k in obj) {
        if (typeof obj[k] === 'object') {
          const res = extractTokenRecursive(obj[k]);
          if (res) return res;
        }
      }
      return null;
    }

    async function probeActivePorts() {
      try {
        const res = await fetch('/api/probe-ports');
        const data = await res.json();
        if (data.activePorts && data.activePorts.length > 0) {
          activePortsNotice.style.color = 'var(--green)';
          activePortsNotice.textContent = '[Active Backend Port Detected: ' + data.activePorts[0] + ']';
          baseHostInput.value = 'http://localhost:' + data.activePorts[0];
        }
      } catch (e) {}
    }

    async function loadDiscoveredRoutes() {
      try {
        const res = await fetch('/api/routes');
        const data = await res.json();
        allRoutes = data.routes || [];
        renderRoutes(allRoutes);
      } catch (e) {
        routeList.innerHTML = '<div style="padding:14px; color:var(--red);">Failed to scan workspace routes</div>';
      }
    }

    async function loadExecutionLogs() {
      try {
        const res = await fetch('/api/logs');
        const data = await res.json();
        allLogs = data.logs || [];
        renderLogs(allLogs);
      } catch (e) {}
    }

    function renderRoutes(routes) {
      const searchTerm = routeSearchInput.value.toLowerCase().trim();
      const secFilter = secFilterSelect.value;

      const filtered = routes.filter(r => {
        const matchesSearch = r.path.toLowerCase().includes(searchTerm) || 
                              r.method.toLowerCase().includes(searchTerm) ||
                              r.tag.toLowerCase().includes(searchTerm) ||
                              r.framework.toLowerCase().includes(searchTerm);
        
        const matchesSec = secFilter === 'all' || 
                           (secFilter === 'auth' && r.requiresAuth) ||
                           (secFilter === 'public' && !r.requiresAuth);

        return matchesSearch && matchesSec;
      });

      routeCount.textContent = filtered.length;

      if (filtered.length === 0) {
        routeList.innerHTML = '<div style="padding:14px; color:var(--text-muted); font-size:0.8rem;">No routes matching filter.</div>';
        return;
      }

      const grouped = {};
      filtered.forEach(r => {
        const groupTitle = \`Step \${r.executionOrder}: \${r.tag}\`;
        if (!grouped[groupTitle]) grouped[groupTitle] = [];
        grouped[groupTitle].push(r);
      });

      routeList.innerHTML = '';

      Object.keys(grouped).forEach(groupTitle => {
        const groupEl = document.createElement('div');
        groupEl.className = 'group-header';
        groupEl.textContent = groupTitle;
        routeList.appendChild(groupEl);

        grouped[groupTitle].forEach(r => {
          const item = document.createElement('div');
          item.className = 'route-item';
          item.innerHTML = \`
            <div class="route-top">
              <span class="method-badge method-\${r.method}">\${r.method}</span>
              <span class="sec-badge \${r.requiresAuth ? 'sec-auth' : 'sec-public'}">
                \${r.requiresAuth ? 'Bearer Auth' : 'Public'}
              </span>
            </div>
            <div class="route-path">\${r.path}</div>
            <div class="route-meta">
              <span>\${r.file}:\${r.line}</span>
              <span style="color: var(--purple); font-weight: 600;">\${r.framework}</span>
            </div>
          \`;
          item.addEventListener('click', () => {
            methodSelect.value = r.method;
            let baseHost = baseHostInput.value.trim().replace(/\\/$/, '');
            let cleanPath = r.path.startsWith('/') ? r.path : '/' + r.path;

            cleanPath = cleanPath.replace(/:([a-zA-Z0-9_]+)/g, '1');
            urlInput.value = r.path.startsWith('http') ? r.path : baseHost + cleanPath;

            if (r.path.includes('login') || r.path.includes('auth') || r.path.includes('sync')) {
              bodyInput.value = JSON.stringify({ email: "user@example.com", password: "password123" }, null, 2);
            } else if (r.suggestedBody && Object.keys(r.suggestedBody).length > 0) {
              bodyInput.value = JSON.stringify(r.suggestedBody, null, 2);
            } else {
              bodyInput.value = '';
            }
            sendBtn.click();
          });
          routeList.appendChild(item);
        });
      });
    }

    function renderLogs(logs) {
      if (logs.length === 0) {
        logList.innerHTML = '<div style="padding:14px; color:var(--text-muted); font-size:0.8rem;">No execution logs recorded.</div>';
        return;
      }

      logList.innerHTML = '';
      logs.forEach((log) => {
        const item = document.createElement('div');
        item.className = 'log-item';
        const statusColorClass = log.status < 300 ? 'status-2xx' : 'status-4xx';

        item.innerHTML = \`
          <div class="log-top">
            <span class="method-badge method-\${log.method}">\${log.method}</span>
            <span class="status-tag \${statusColorClass}">HTTP \${log.status}</span>
          </div>
          <div class="log-url">\${log.url}</div>
          <div class="log-meta">
            <span>Duration: \${log.durationMs}ms</span>
            <span>\${log.timestamp}</span>
          </div>
        \`;

        item.addEventListener('click', () => {
          methodSelect.value = log.method;
          urlInput.value = log.url;
          if (log.requestBody) bodyInput.value = log.requestBody;

          metricsBadge.style.display = 'inline-block';
          metricsBadge.className = 'status-tag ' + statusColorClass;
          metricsBadge.textContent = \`HTTP \${log.status} \${log.statusText} (\${log.durationMs}ms)\`;

          try {
            const parsed = JSON.parse(log.responseBody || '');
            responseOutput.textContent = JSON.stringify(parsed, null, 2);
          } catch {
            responseOutput.textContent = log.responseBody || '// Empty response';
          }
        });

        logList.appendChild(item);
      });
    }

    routeSearchInput.addEventListener('input', () => renderRoutes(allRoutes));
    secFilterSelect.addEventListener('change', () => renderRoutes(allRoutes));
    resniffBtn.addEventListener('click', loadDiscoveredRoutes);

    clearLogsBtn.addEventListener('click', async () => {
      await fetch('/api/logs', { method: 'DELETE' });
      loadExecutionLogs();
    });

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

          const extractedToken = extractTokenRecursive(parsed);
          if (extractedToken) {
            authTokenInput.value = extractedToken;
          }
        } catch {
          responseOutput.textContent = text;
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

    probeActivePorts();
    loadDiscoveredRoutes();
    loadExecutionLogs();
  </script>
</body>
</html>`;
}
