import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { sniffProjectRoutes } from "./ast-sniffer.js";

export function createMockServer(port = 8080) {
  const app = new Hono();
  const routes = sniffProjectRoutes();

  // Root status endpoint
  app.get("/_mock/status", (c) => c.json({ status: "ok", engine: "api-quick-mock", totalRoutes: routes.length }));

  // Register mock handlers for all sniffed routes
  for (const r of routes) {
    const routePath = r.path.replace(/:([a-zA-Z0-9_]+)/g, ":$1");
    const method = r.method.toLowerCase();

    const mockHandler = (c: any) => {
      const mockData = generateMockResponseBody(r.path, r.suggestedBody);
      return c.json({
        _mock: true,
        _framework: r.framework,
        _route: r.path,
        timestamp: new Date().toISOString(),
        data: mockData
      });
    };

    if (typeof (app as any)[method] === "function") {
      (app as any)[method](routePath, mockHandler);
    }
  }

  // Catch-all fallback mock route
  app.all("*", (c) => c.json({ _mock: true, message: `Mock API Server - Endpoint ${c.req.path} registered.`, path: c.req.path }));

  return serve({ fetch: app.fetch, port });
}

function generateMockResponseBody(routePath: string, suggestedBody?: Record<string, any>): any {
  if (suggestedBody && Object.keys(suggestedBody).length > 0) {
    return { ...suggestedBody, id: 1, createdAt: new Date().toISOString() };
  }

  if (routePath.includes("users") || routePath.includes("staff")) {
    return [
      { id: 1, name: "Alice Johnson", email: "alice@example.com", role: "ADMIN" },
      { id: 2, name: "Bob Smith", email: "bob@example.com", role: "USER" }
    ];
  }

  if (routePath.includes("products") || routePath.includes("categories")) {
    return [
      { id: 1, title: "Premium Laptop", price: 1299.99, category: "Electronics" },
      { id: 2, title: "Wireless Headphones", price: 199.99, category: "Audio" }
    ];
  }

  if (routePath.includes("orders") || routePath.includes("proposals")) {
    return [
      { id: 101, status: "DELIVERED", totalAmount: 249.50, itemsCount: 3 }
    ];
  }

  return { status: "success", message: `Mock data for endpoint ${routePath}` };
}
