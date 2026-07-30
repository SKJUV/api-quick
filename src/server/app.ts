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

export function createWebServer() {
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

  // Probe active local ports to find running backend
  app.get("/api/probe-ports", async (c) => {
    const commonPorts = [3000, 3001, 5000, 5001, 8080, 8000, 4000, 9000];
    const activePorts: number[] = [];

    for (const port of commonPorts) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 200);
        const res = await fetch(`http://127.0.0.1:${port}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.status) activePorts.push(port);
      } catch {
        // Port not active or refused
      }
    }
    return c.json({ activePorts });
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
        statusText: "Bad Gateway / Target Server Not Running",
        durationMs: totalTime,
        responseSize: 0,
        responseBody: `Connection Refused to ${targetUrl}. Is your backend server running on this port?`
      });

      return c.json({ error: `Proxy Request Failed: Connection Refused to ${targetUrl}. Check if your backend is running on this port.` }, 502);
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
  <title>⚡ api-quick - Vibe Coder Web Workbench</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0f172a;
      --panel: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --primary: #38bdf8;
      --green: #22c55e;
      --yellow: #eab308;
      --red: #ef4444;
      --purple: #a855f7;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Inter', sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .logo { font-size: 1.2rem; font-weight: 700; color: var(--primary); display: flex; align-items: center; gap: 8px; }
    .badge { background: #0284c7; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; }
    .vibe-tag { background: rgba(168, 85, 247, 0.2); color: var(--purple); padding: 4px 10px; border-radius: 16px; font-size: 0.8rem; font-weight: 600; }
    
    .layout-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 16px;
      gap: 16px;
      overflow: hidden;
    }
    main {
      flex: 2;
      display: grid;
      grid-template-columns: 340px 1fr 1fr;
      gap: 16px;
      overflow: hidden;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .card-header {
      background: rgba(0,0,0,0.2);
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .route-list, .log-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .route-item, .log-item {
      background: #090d16;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .route-item:hover, .log-item:hover { border-color: var(--primary); transform: translateY(-1px); }
    .route-top, .log-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .method-badge { font-weight: 700; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; }
    .method-GET { background: rgba(56, 189, 248, 0.2); color: var(--primary); }
    .method-POST { background: rgba(34, 197, 94, 0.2); color: var(--green); }
    .method-PUT { background: rgba(234, 179, 8, 0.2); color: var(--yellow); }
    .method-PATCH { background: rgba(168, 85, 247, 0.2); color: var(--purple); }
    .method-DELETE { background: rgba(239, 68, 68, 0.2); color: var(--red); }
    .route-path, .log-url { font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; font-weight: 600; color: #fff; word-break: break-all; }
    .route-meta, .log-meta { font-size: 0.75rem; color: var(--muted); margin-top: 4px; display: flex; justify-content: space-between; }
    
    .request-bar { display: flex; gap: 8px; padding: 16px; }
    select, input, button, textarea {
      font-family: inherit;
      font-size: 0.9rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: #090d16;
      color: var(--text);
      padding: 8px 12px;
    }
    select { background: #1e293b; color: var(--primary); font-weight: 600; cursor: pointer; }
    input[type="text"] { flex: 1; font-family: 'JetBrains Mono', monospace; }
    button.send-btn {
      background: #0284c7;
      color: white;
      font-weight: 600;
      padding: 8px 24px;
      cursor: pointer;
      border: none;
      transition: background 0.2s;
    }
    button.send-btn:hover { background: #0369a1; }
    .form-group { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
    label { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; font-weight: 600; }
    textarea { height: 140px; font-family: 'JetBrains Mono', monospace; resize: vertical; }
    pre {
      font-family: 'JetBrains Mono', monospace;
      padding: 16px;
      font-size: 0.85rem;
      overflow: auto;
      flex: 1;
      white-space: pre-wrap;
      background: #090d16;
    }
    .status-tag { font-weight: 700; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; }
    .status-2xx { background: rgba(34, 197, 94, 0.2); color: var(--green); }
    .status-4xx, .status-5xx { background: rgba(239, 68, 68, 0.2); color: var(--red); }

    /* Bottom Activity Drawer */
    .activity-drawer {
      height: 200px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .base-url-box {
      background: #090d16;
      border-bottom: 1px solid var(--border);
      padding: 8px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo">⚡ api-quick <span class="badge">v0.1.0</span></div>
    <div class="vibe-tag">✨ Vibe Coder Auto-Sniffing & Telemetry Active</div>
    <div style="font-size: 0.85rem; color: var(--muted);">CORS Proxy: Active</div>
  </header>

  <div class="layout-container">
    <!-- Config Bar for Backend Host & Port -->
    <div class="base-url-box">
      <span style="color: var(--muted); font-weight: 600;">🎯 Target Backend Base Host:</span>
      <input type="text" id="baseHostInput" value="http://localhost:3000" style="max-width: 260px; padding: 4px 8px; font-size: 0.85rem;" />
      <span id="activePortsNotice" style="color: var(--green); font-weight: 600; font-size: 0.8rem;"></span>
    </div>

    <main>
      <!-- Left Sidebar: Discovered Routes Catalog -->
      <div class="card">
        <div class="card-header">
          <span>Project AST Routes (<span id="routeCount">0</span>)</span>
          <button id="resniffBtn" style="padding: 2px 8px; font-size: 0.75rem; background: #334155; border: none; color: #fff; cursor: pointer;">Scan</button>
        </div>
        <div id="routeList" class="route-list">
          <div style="padding: 16px; color: var(--muted); font-size: 0.85rem;">Scanning workspace for API routes...</div>
        </div>
      </div>

      <!-- Request Panel -->
      <div class="card">
        <div class="card-header">HTTP Request Builder</div>
        <div class="request-bar">
          <select id="methodSelect">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </select>
          <input type="text" id="urlInput" value="http://localhost:3000/health" placeholder="Enter request URL..." />
          <button class="send-btn" id="sendBtn">1-Click Test ⚡</button>
        </div>

        <div class="form-group">
          <label>Headers (JSON Format)</label>
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
          <span>Response View</span>
          <span id="metricsBadge" class="status-tag" style="display:none;"></span>
        </div>
        <pre id="responseOutput">// Click any discovered route in the left panel to test it instantly!</pre>
      </div>
    </main>

    <!-- Bottom Activity Drawer: Action Execution Telemetry Logs -->
    <div class="activity-drawer">
      <div class="card-header">
        <span>📋 Executed Action Telemetry Logs</span>
        <button id="clearLogsBtn" style="padding: 2px 8px; font-size: 0.75rem; background: #ef4444; border: none; color: #fff; cursor: pointer; border-radius: 4px;">Clear Logs</button>
      </div>
      <div id="logList" class="log-list" style="flex-direction: row; flex-wrap: nowrap; overflow-x: auto;">
        <div style="padding: 16px; color: var(--muted); font-size: 0.85rem;">No execution logs recorded yet.</div>
      </div>
    </div>
  </div>

  <script>
    const routeList = document.getElementById('routeList');
    const routeCount = document.getElementById('routeCount');
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

    let allLogs = [];

    async function probeActivePorts() {
      try {
        const res = await fetch('/api/probe-ports');
        const data = await res.json();
        if (data.activePorts && data.activePorts.length > 0) {
          activePortsNotice.textContent = '🟢 Detected running backend port(s): ' + data.activePorts.join(', ');
          if (!data.activePorts.includes(3000)) {
            baseHostInput.value = 'http://localhost:' + data.activePorts[0];
          }
        } else {
          activePortsNotice.textContent = '⚠️ No local backend detected running yet on ports 3000/5000/8080';
        }
      } catch (e) {}
    }

    async function loadDiscoveredRoutes() {
      try {
        const res = await fetch('/api/routes');
        const data = await res.json();
        renderRoutes(data.routes || []);
      } catch (e) {
        routeList.innerHTML = '<div style="padding:16px; color:var(--red);">Failed to scan routes</div>';
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
      routeCount.textContent = routes.length;
      if (routes.length === 0) {
        routeList.innerHTML = '<div style="padding:16px; color:var(--muted); font-size:0.85rem;">No routes auto-detected in this directory. Add Express/FastAPI/Next.js/NestJS code to test!</div>';
        return;
      }

      routeList.innerHTML = '';
      routes.forEach((r) => {
        const item = document.createElement('div');
        item.className = 'route-item';
        item.innerHTML = \`
          <div class="route-top">
            <span class="method-badge method-\${r.method}">\${r.method}</span>
            <span style="font-size: 0.7rem; color: var(--purple);">\${r.framework}</span>
          </div>
          <div class="route-path">\${r.path}</div>
          <div class="route-meta">📁 \${r.file}:\${r.line}</div>
        \`;
        item.addEventListener('click', () => {
          methodSelect.value = r.method;
          const baseHost = baseHostInput.value.trim().replace(/\\/$/, '');
          urlInput.value = r.path.startsWith('http') ? r.path : baseHost + (r.path.startsWith('/') ? r.path : '/' + r.path);
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
        logList.innerHTML = '<div style="padding:16px; color:var(--muted); font-size:0.85rem;">No execution logs recorded yet.</div>';
        return;
      }

      logList.innerHTML = '';
      logs.forEach((log) => {
        const item = document.createElement('div');
        item.className = 'log-item';
        item.style.minWidth = '280px';
        const statusColorClass = log.status < 300 ? 'status-2xx' : 'status-4xx';

        item.innerHTML = \`
          <div class="log-top">
            <span class="method-badge method-\${log.method}">\${log.method}</span>
            <span class="status-tag \${statusColorClass}">HTTP \${log.status}</span>
          </div>
          <div class="log-url">\${log.url}</div>
          <div class="log-meta">
            <span>⏱️ \${log.durationMs}ms</span>
            <span>🕒 \${log.timestamp}</span>
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

    clearLogsBtn.addEventListener('click', async () => {
      await fetch('/api/logs', { method: 'DELETE' });
      loadExecutionLogs();
    });

    resniffBtn.addEventListener('click', loadDiscoveredRoutes);

    sendBtn.addEventListener('click', async () => {
      let url = urlInput.value.trim();
      const method = methodSelect.value;
      
      if (!url) return alert('Please enter a target URL');

      responseOutput.textContent = 'Executing 1-Click test via local CORS bypass proxy...';
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
