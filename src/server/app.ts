import { Hono } from "hono";
import { cors } from "hono/cors";
import { sniffProjectRoutes } from "../core/ast-sniffer.js";

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

  // CORS Bypass Proxy endpoint
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
    const body = ["GET", "HEAD"].includes(method) ? undefined : await c.req.raw.arrayBuffer();

    try {
      const startTime = performance.now();
      const proxyResponse = await fetch(targetUrl, {
        method,
        headers: incomingHeaders,
        body
      });
      const totalTime = Math.round((performance.now() - startTime) * 100) / 100;

      const responseHeaders = new Headers(proxyResponse.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Expose-Headers", "*");
      responseHeaders.set("X-Api-Quick-Time-Ms", String(totalTime));

      return new Response(proxyResponse.body, {
        status: proxyResponse.status,
        headers: responseHeaders
      });
    } catch (err: any) {
      return c.json({ error: `Proxy Request Failed: ${err.message}` }, 502);
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
    main {
      flex: 1;
      display: grid;
      grid-template-columns: 320px 1fr 1fr;
      gap: 16px;
      padding: 16px;
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
    .route-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .route-item {
      background: #090d16;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .route-item:hover { border-color: var(--primary); transform: translateY(-1px); }
    .route-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .method-badge { font-weight: 700; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; }
    .method-GET { background: rgba(56, 189, 248, 0.2); color: var(--primary); }
    .method-POST { background: rgba(34, 197, 94, 0.2); color: var(--green); }
    .method-PUT { background: rgba(234, 179, 8, 0.2); color: var(--yellow); }
    .method-DELETE { background: rgba(239, 68, 68, 0.2); color: var(--red); }
    .route-path { font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; font-weight: 600; color: #fff; word-break: break-all; }
    .route-meta { font-size: 0.75rem; color: var(--muted); margin-top: 4px; }
    
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
    textarea { height: 160px; font-family: 'JetBrains Mono', monospace; resize: vertical; }
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
  </style>
</head>
<body>
  <header>
    <div class="logo">⚡ api-quick <span class="badge">v0.1.0</span></div>
    <div class="vibe-tag">✨ Vibe Coder Auto-Sniffing Mode Active</div>
    <div style="font-size: 0.85rem; color: var(--muted);">CORS Proxy: Active</div>
  </header>

  <main>
    <!-- Left Sidebar: Discovered Routes Catalog -->
    <div class="card">
      <div class="card-header">
        <span>Project AST Routes</span>
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
          <option value="DELETE">DELETE</option>
          <option value="PATCH">PATCH</option>
        </select>
        <input type="text" id="urlInput" value="http://localhost:3000/api/users" placeholder="Enter request URL..." />
        <button class="send-btn" id="sendBtn">1-Click Test ⚡</button>
      </div>

      <div class="form-group">
        <label>Headers (JSON Format)</label>
        <textarea id="headersInput">{\n  "Accept": "application/json"\n}</textarea>
      </div>

      <div class="form-group">
        <label>JSON Body Payload</label>
        <textarea id="bodyInput" placeholder='{\n  "key": "value"\n}'></textarea>
      </div>
    </div>

    <!-- Response Panel -->
    <div class="card">
      <div class="card-header">
        <span>Response View</span>
        <span id="metricsBadge" class="status-tag" style="display:none;"></span>
      </div>
      <pre id="responseOutput">// Click any discovered route on the left panel to test it instantly!</pre>
    </div>
  </main>

  <script>
    const routeList = document.getElementById('routeList');
    const resniffBtn = document.getElementById('resniffBtn');
    const sendBtn = document.getElementById('sendBtn');
    const methodSelect = document.getElementById('methodSelect');
    const urlInput = document.getElementById('urlInput');
    const headersInput = document.getElementById('headersInput');
    const bodyInput = document.getElementById('bodyInput');
    const responseOutput = document.getElementById('responseOutput');
    const metricsBadge = document.getElementById('metricsBadge');

    let allRoutes = [];

    async function loadDiscoveredRoutes() {
      try {
        const res = await fetch('/api/routes');
        const data = await res.json();
        allRoutes = data.routes || [];
        renderRoutes(allRoutes);
      } catch (e) {
        routeList.innerHTML = '<div style="padding:16px; color:var(--red);">Failed to scan routes</div>';
      }
    }

    function renderRoutes(routes) {
      if (routes.length === 0) {
        routeList.innerHTML = '<div style="padding:16px; color:var(--muted); font-size:0.85rem;">No routes auto-detected in this directory. Add Express/FastAPI/Next.js code to test!</div>';
        return;
      }

      routeList.innerHTML = '';
      routes.forEach((r, idx) => {
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
          urlInput.value = r.path.startsWith('http') ? r.path : 'http://localhost:3000' + (r.path.startsWith('/') ? r.path : '/' + r.path);
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

      } catch (err) {
        metricsBadge.style.display = 'inline-block';
        metricsBadge.className = 'status-tag status-5xx';
        metricsBadge.textContent = 'Network Error';
        responseOutput.textContent = 'Error: ' + err.message;
      }
    });

    loadDiscoveredRoutes();
  </script>
</body>
</html>`;
}
