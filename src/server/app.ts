import { Hono } from "hono";
import { cors } from "hono/cors";
import { sniffProjectRoutes } from "../core/ast-sniffer.js";

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

  // Allow all CORS origins for local web client
  app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"] }));

  // Health check endpoint
  app.get("/api/health", (c) => c.json({ status: "ok", engine: "api-quick", version: "0.1.0" }));

  // Discovered routes AST endpoint
  app.get("/api/routes", (c) => {
    const routes = sniffProjectRoutes();
    return c.json({ routes, count: routes.length });
  });

  // Probe active local ports to find running backend (EXCLUDING api-quick's own port!)
  app.get("/api/probe-ports", async (c) => {
    const candidatePorts = [3000, 3001, 5000, 5001, 8080, 8000, 9000, 3002];
    const activePorts: number[] = [];

    for (const port of candidatePorts) {
      if (port === currentPort) continue; // EXCLUDE api-quick's own port!

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 250);
        const res = await fetch(`http://127.0.0.1:${port}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.status) activePorts.push(port);
      } catch {
        // Port not active or refused
      }
    }
    return c.json({ activePorts, currentPort });
  });

  // Action execution logs history endpoint
  app.get("/api/logs", (c) => {
    return c.json({ logs: executionLogs, count: executionLogs.length });
  });

  // Clear execution logs
  app.delete("/api/logs", (c) => {
    executionLogs.length = 0;
    return c.json({ status: "cleared" });
  });

  // CORS Bypass Proxy endpoint with automatic Telemetry Logging
  app.all("/proxy/*", async (c) => {
    const targetUrl = c.req.header("X-Api-Quick-Target-Url");
    if (!targetUrl) {
      return c.json({ error: "Missing X-Api-Quick-Target-Url Header" }, 400);
    }

    const incomingHeaders = new Headers(c.req.raw.headers);
    // Neutralize browser restricted headers
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
        body
      });

      totalTime = Math.round((performance.now() - startTime) * 100) / 100;
      status = proxyResponse.status;
      statusText = proxyResponse.statusText;

      responseText = await proxyResponse.text();

      // Log execution telemetry
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
        responseBody: responseText
      });

      // Keep last 100 logs in memory
      if (executionLogs.length > 100) executionLogs.pop();

      const responseHeaders = new Headers(proxyResponse.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Expose-Headers", "*");
      responseHeaders.set("X-Api-Quick-Time-Ms", String(totalTime));

      return new Response(responseText, {
        status: proxyResponse.status,
        headers: responseHeaders
      });
    } catch (err: any) {
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
        responseBody: `Connection Refused to ${targetUrl}. Please ensure target backend server is running.`
      });

      return c.json({ error: `Proxy Request Failed: Connection Refused to ${targetUrl}. Is your backend server running on this port?` }, 502);
    }
  });

  // Serve static SPA HTML fallback
  app.get("*", (c) => {
    return c.html(getWebUiHtml());
  });

  return app;
}

function getWebUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>api-quick — API Workbench & Automation Engine</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --panel: #131b2e;
      --card-bg: #182238;
      --border: #23314d;
      --border-hover: #33466d;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --primary: #0284c7;
      --primary-hover: #0369a1;
      --accent: #38bdf8;
      --green: #10b981;
      --yellow: #f59e0b;
      --red: #ef4444;
      --purple: #8b5cf6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    header {
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
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
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: var(--accent);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .status-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .dot-active {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--green);
      box-shadow: 0 0 8px var(--green);
    }
    
    .layout-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 12px;
      gap: 12px;
      overflow: hidden;
    }

    .base-url-bar {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.85rem;
    }
    .base-url-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    main {
      flex: 2;
      display: grid;
      grid-template-columns: 360px 1fr 1fr;
      gap: 12px;
      overflow: hidden;
    }

    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .card-header {
      background: rgba(0,0,0,0.25);
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      font-size: 0.85rem;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .search-input-box {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      background: var(--card-bg);
    }
    .search-input-box input {
      width: 100%;
      background: #0d1322;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 6px 10px;
      color: var(--text);
      font-size: 0.8rem;
    }

    .route-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .route-item {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 5px;
      padding: 8px 10px;
      cursor: pointer;
      transition: all 0.12s ease;
    }
    .route-item:hover {
      border-color: var(--accent);
      background: #1e2c48;
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
      padding: 2px 6px;
      border-radius: 3px;
      letter-spacing: 0.5px;
    }
    .method-GET { background: rgba(56, 189, 248, 0.15); color: var(--accent); border: 1px solid rgba(56, 189, 248, 0.3); }
    .method-POST { background: rgba(16, 185, 129, 0.15); color: var(--green); border: 1px solid rgba(16, 185, 129, 0.3); }
    .method-PUT { background: rgba(245, 158, 11, 0.15); color: var(--yellow); border: 1px solid rgba(245, 158, 11, 0.3); }
    .method-PATCH { background: rgba(139, 92, 246, 0.15); color: var(--purple); border: 1px solid rgba(139, 92, 246, 0.3); }
    .method-DELETE { background: rgba(239, 68, 68, 0.15); color: var(--red); border: 1px solid rgba(239, 68, 68, 0.3); }
    
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
      gap: 4px;
    }

    .request-bar {
      display: flex;
      gap: 8px;
      padding: 12px;
      background: var(--card-bg);
      border-bottom: 1px solid var(--border);
    }
    select, input[type="text"], button, textarea {
      font-family: inherit;
      font-size: 0.85rem;
      border-radius: 4px;
      border: 1px solid var(--border);
      background: #0c1220;
      color: var(--text);
      padding: 8px 10px;
    }
    select {
      background: var(--panel);
      color: var(--accent);
      font-weight: 600;
      cursor: pointer;
      outline: none;
    }
    input[type="text"] {
      flex: 1;
      font-family: 'JetBrains Mono', monospace;
      outline: none;
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
      display: flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s;
    }
    button.btn-primary:hover { background: var(--primary-hover); }
    button.btn-secondary {
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--text);
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      font-size: 0.78rem;
    }
    button.btn-secondary:hover { border-color: var(--border-hover); background: #22304d; }

    .form-group {
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    label {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.5px;
    }
    textarea {
      height: 120px;
      font-family: 'JetBrains Mono', monospace;
      resize: vertical;
      outline: none;
    }
    textarea:focus { border-color: var(--accent); }

    pre {
      font-family: 'JetBrains Mono', monospace;
      padding: 14px;
      font-size: 0.82rem;
      overflow: auto;
      flex: 1;
      white-space: pre-wrap;
      background: #0c1220;
      line-height: 1.45;
    }
    .status-tag {
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.78rem;
      font-family: 'JetBrains Mono', monospace;
    }
    .status-2xx { background: rgba(16, 185, 129, 0.15); color: var(--green); border: 1px solid rgba(16, 185, 129, 0.3); }
    .status-4xx, .status-5xx { background: rgba(239, 68, 68, 0.15); color: var(--red); border: 1px solid rgba(239, 68, 68, 0.3); }

    /* Bottom Activity Drawer */
    .activity-drawer {
      height: 190px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .log-list {
      flex: 1;
      overflow-x: auto;
      padding: 8px;
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .log-item {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 5px;
      padding: 8px 10px;
      min-width: 260px;
      cursor: pointer;
      transition: all 0.12s;
    }
    .log-item:hover { border-color: var(--accent); }
    .log-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .log-url { font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .log-meta { font-size: 0.72rem; color: var(--text-muted); margin-top: 4px; display: flex; justify-content: space-between; }
    
    svg.icon { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  </style>
</head>
<body>
  <!-- Header -->
  <header>
    <div class="logo">
      <svg class="icon" style="width:18px; height:18px; stroke: var(--accent);" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
      api-quick
      <span class="badge">v0.1.0 Engine</span>
    </div>
    <div class="status-indicator">
      <div class="dot-active"></div>
      CORS Bypass Proxy & AST Scanner Active
    </div>
  </header>

  <div class="layout-container">
    <!-- Config Bar for Backend Host & Port -->
    <div class="base-url-bar">
      <div class="base-url-left">
        <span style="color: var(--text-muted); font-weight: 600;">Target Server Host:</span>
        <input type="text" id="baseHostInput" value="http://localhost:3000" style="width: 240px; padding: 4px 8px; font-size: 0.82rem;" />
      </div>
      <div id="activePortsNotice" style="color: var(--yellow); font-size: 0.8rem; font-weight: 500;"></div>
    </div>

    <main>
      <!-- Left Sidebar: Discovered Routes Catalog -->
      <div class="card">
        <div class="card-header">
          <span>Discovered AST Routes (<span id="routeCount">0</span>)</span>
          <button id="resniffBtn" class="btn-secondary">
            <svg class="icon" viewBox="0 0 24 24"><path d="M21.5 2v6h-6M2.13 15.57a10 10 0 1 0 4-13.84L1.5 8"></path></svg>
            Refresh AST
          </button>
        </div>
        <div class="search-input-box">
          <input type="text" id="routeSearchInput" placeholder="Filter routes by path or method..." />
        </div>
        <div id="routeList" class="route-list">
          <div style="padding: 16px; color: var(--text-muted); font-size: 0.8rem;">Scanning workspace directory...</div>
        </div>
      </div>

      <!-- Request Panel -->
      <div class="card">
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
          <input type="text" id="urlInput" value="http://localhost:3000/api/health" placeholder="Enter target request URL..." />
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
          <textarea id="bodyInput" placeholder='{\n  "email": "user@example.com"\n}'></textarea>
        </div>
      </div>

      <!-- Response Panel -->
      <div class="card">
        <div class="card-header">
          <span>Response Inspector</span>
          <span id="metricsBadge" class="status-tag" style="display:none;"></span>
        </div>
        <pre id="responseOutput">// Select any discovered route from the left sidebar to execute request.</pre>
      </div>
    </main>

    <!-- Bottom Activity Drawer: Action Execution Telemetry Logs -->
    <div class="activity-drawer">
      <div class="card-header">
        <span>Execution Telemetry Logs</span>
        <button id="clearLogsBtn" class="btn-secondary" style="color: var(--red); border-color: rgba(239, 68, 68, 0.3);">
          <svg class="icon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          Clear Logs
        </button>
      </div>
      <div id="logList" class="log-list">
        <div style="padding: 14px; color: var(--text-muted); font-size: 0.8rem;">No execution logs recorded yet.</div>
      </div>
    </div>
  </div>

  <script>
    const routeList = document.getElementById('routeList');
    const routeCount = document.getElementById('routeCount');
    const routeSearchInput = document.getElementById('routeSearchInput');
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
    const activePortsNotice = document.getElementById('activePortsNotice');

    let allRoutes = [];
    let allLogs = [];

    async function probeActivePorts() {
      try {
        const res = await fetch('/api/probe-ports');
        const data = await res.json();
        if (data.activePorts && data.activePorts.length > 0) {
          activePortsNotice.style.color = 'var(--green)';
          activePortsNotice.textContent = 'Active backend port detected: ' + data.activePorts.join(', ');
          baseHostInput.value = 'http://localhost:' + data.activePorts[0];
        } else {
          activePortsNotice.style.color = 'var(--yellow)';
          activePortsNotice.textContent = 'Specify running backend host above (e.g. http://localhost:3000)';
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
      const filtered = routes.filter(r => 
        r.path.toLowerCase().includes(searchTerm) || 
        r.method.toLowerCase().includes(searchTerm) ||
        r.framework.toLowerCase().includes(searchTerm)
      );

      routeCount.textContent = filtered.length;

      if (filtered.length === 0) {
        routeList.innerHTML = '<div style="padding:14px; color:var(--text-muted); font-size:0.8rem;">No routes matching filter.</div>';
        return;
      }

      routeList.innerHTML = '';
      filtered.forEach((r) => {
        const item = document.createElement('div');
        item.className = 'route-item';
        item.innerHTML = \`
          <div class="route-top">
            <span class="method-badge method-\${r.method}">\${r.method}</span>
            <span style="font-size: 0.68rem; color: var(--purple); font-weight: 600;">\${r.framework}</span>
          </div>
          <div class="route-path">\${r.path}</div>
          <div class="route-meta">
            <span>\${r.file}:\${r.line}</span>
          </div>
        \`;
        item.addEventListener('click', () => {
          methodSelect.value = r.method;
          let baseHost = baseHostInput.value.trim().replace(/\\/$/, '');
          let cleanPath = r.path.startsWith('/') ? r.path : '/' + r.path;

          // Replace route URL params like :id with dummy sample value
          cleanPath = cleanPath.replace(/:([a-zA-Z0-9_]+)/g, '1');

          urlInput.value = r.path.startsWith('http') ? r.path : baseHost + cleanPath;
          if (r.suggestedBody && Object.keys(r.suggestedBody).length > 0) {
            bodyInput.value = JSON.stringify(r.suggestedBody, null, 2);
          } else {
            bodyInput.value = '';
          }
          sendBtn.click();
        });
        routeList.appendChild(item);
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
