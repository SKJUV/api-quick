import fs from "fs";
import path from "path";

export interface DiscoveredRoute {
  id: string;
  method: string;
  path: string;
  file: string;
  line: number;
  framework: "NestJS" | "Express/Fastify" | "Next.js" | "FastAPI/Flask" | "Django" | "Go" | "Spring Boot" | "Laravel" | "Generic";
  tag: string;
  executionOrder: number; // 1 = Auth, 2 = Profile/User, 3 = Core Resources, 4 = Admin Ops
  requiresAuth: boolean;
  description: string;
  suggestedHeaders?: Record<string, string>;
  suggestedBody?: Record<string, any>;
  queryParams?: string[];
}

export function sniffProjectRoutes(targetDir: string = process.cwd()): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  const filesToScan: string[] = [];

  function collectFiles(dir: string, depth = 0) {
    if (depth > 10 || !fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (["node_modules", ".git", "dist", "build", ".next", "venv", ".venv", "__pycache__", "target", "vendor"].includes(entry.name)) {
            continue;
          }
          collectFiles(fullPath, depth + 1);
        } else if (entry.isFile()) {
          if (/\.(ts|js|jsx|tsx|py|go|java|kt|rs|php)$/.test(entry.name)) {
            filesToScan.push(fullPath);
          }
        }
      }
    } catch {
      // Ignore unreadable directories
    }
  }

  collectFiles(targetDir);

  function categorizeRoute(routePath: string, filename: string): { tag: string; executionOrder: number; requiresAuth: boolean; description: string } {
    const lowerPath = routePath.toLowerCase();
    const lowerFile = filename.toLowerCase();

    if (lowerPath.includes("auth") || lowerPath.includes("login") || lowerPath.includes("register") || lowerPath.includes("sync") || lowerFile.includes("auth")) {
      const isPublic = lowerPath.includes("login") || lowerPath.includes("register");
      return {
        tag: "Authentication & Identity",
        executionOrder: 1,
        requiresAuth: !isPublic,
        description: isPublic ? "Public authentication endpoint to obtain Bearer JWT access token." : "Authenticated session synchronization endpoint."
      };
    }

    if (lowerPath.includes("me") || lowerPath.includes("profile") || lowerPath.includes("user/address")) {
      return {
        tag: "User Profile & Account",
        executionOrder: 2,
        requiresAuth: true,
        description: "User account management, addresses, and personal profile operations."
      };
    }

    if (lowerPath.includes("admin") || lowerPath.includes("dashboard") || lowerPath.includes("analytics") || lowerFile.includes("admin")) {
      return {
        tag: "Administrative Operations",
        executionOrder: 4,
        requiresAuth: true,
        description: "Restricted administrative metrics, staff management, and system configuration."
      };
    }

    if (lowerPath.includes("product") || lowerPath.includes("categories") || lowerFile.includes("product")) {
      const isRead = !lowerPath.includes("post") && !lowerPath.includes("delete");
      return {
        tag: "Product Catalog",
        executionOrder: 3,
        requiresAuth: !isRead,
        description: "E-commerce product catalog, categories, and inventory listings."
      };
    }

    if (lowerPath.includes("order") || lowerPath.includes("proposal") || lowerFile.includes("order")) {
      return {
        tag: "Orders & Workflows",
        executionOrder: 3,
        requiresAuth: true,
        description: "Order creation, shipping calculations, proposal acceptance, and status workflows."
      };
    }

    if (lowerPath.includes("wallet") || lowerPath.includes("recharge") || lowerFile.includes("wallet")) {
      return {
        tag: "Wallet & Financials",
        executionOrder: 3,
        requiresAuth: true,
        description: "User digital wallet balance, recharge operations, and transaction history."
      };
    }

    const tagName = baseModuleName(filename) || "General Operations";
    return {
      tag: tagName.charAt(0).toUpperCase() + tagName.slice(1),
      executionOrder: 3,
      requiresAuth: true,
      description: `API operation for ${tagName} module.`
    };
  }

  function baseModuleName(filename: string): string {
    return path.basename(filename, path.extname(filename)).replace(/\.(routes|route|controller)$/, "");
  }

  // Scan file for req.body properties
  function extractBodyProperties(content: string): Record<string, any> {
    const props: Record<string, any> = {};
    const matches = content.matchAll(/req\.body\.([a-zA-Z0-9_]+)/g);
    for (const match of matches) {
      const propName = match[1];
      if (propName === "email") props[propName] = "user@example.com";
      else if (propName === "password") props[propName] = "secretpassword";
      else if (propName.includes("id") || propName.includes("Id")) props[propName] = 1;
      else if (propName.includes("price") || propName.includes("amount")) props[propName] = 99.99;
      else props[propName] = "sample_value";
    }
    return props;
  }

  let idCounter = 1;

  for (const file of filesToScan) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");
      const relPath = path.relative(targetDir, file);
      const baseFilename = baseModuleName(file);
      const routeModuleName = baseFilename !== "index" && baseFilename !== "app" && baseFilename !== "server" ? baseFilename : "";

      const extractedBodyProps = extractBodyProperties(content);

      lines.forEach((lineText, index) => {
        const lineNum = index + 1;

        // Express / Fastify / Hono: app.get("/path"), router.post("/path")
        const expressMatch = lineText.match(/(?:app|router|server|instance|hono)\.(get|post|put|delete|patch|all)\s*\(\s*["']([^"']+)["']/i);
        if (expressMatch) {
          let rawPath = expressMatch[2];
          if (!rawPath.startsWith("/")) rawPath = "/" + rawPath;
          const method = expressMatch[1].toUpperCase() === "ALL" ? "GET" : expressMatch[1].toUpperCase();

          // 1. Module name prefixed path
          if (routeModuleName && !rawPath.startsWith("/" + routeModuleName)) {
            const modulePath = "/" + routeModuleName + (rawPath === "/" ? "" : rawPath);
            const prefixedPath = `/api/v1${modulePath}`;
            
            const meta = categorizeRoute(prefixedPath, baseFilename);
            routes.push({
              id: `route-${idCounter++}`,
              method,
              path: prefixedPath,
              file: relPath,
              line: lineNum,
              framework: "Express/Fastify",
              tag: meta.tag,
              executionOrder: meta.executionOrder,
              requiresAuth: meta.requiresAuth,
              description: meta.description,
              suggestedHeaders: meta.requiresAuth ? { Authorization: "Bearer <token>" } : undefined,
              suggestedBody: ["POST", "PUT", "PATCH"].includes(method) ? (Object.keys(extractedBodyProps).length > 0 ? extractedBodyProps : { sample_field: "test_value" }) : undefined
            });
          }

          // 2. Direct path
          const metaDirect = categorizeRoute(rawPath, baseFilename);
          routes.push({
            id: `route-${idCounter++}`,
            method,
            path: rawPath,
            file: relPath,
            line: lineNum,
            framework: "Express/Fastify",
            tag: metaDirect.tag,
            executionOrder: metaDirect.executionOrder,
            requiresAuth: metaDirect.requiresAuth,
            description: metaDirect.description,
            suggestedHeaders: metaDirect.requiresAuth ? { Authorization: "Bearer <token>" } : undefined,
            suggestedBody: ["POST", "PUT", "PATCH"].includes(method) ? (Object.keys(extractedBodyProps).length > 0 ? extractedBodyProps : { sample_field: "test_value" }) : undefined
          });
          return;
        }

        // NestJS Method Decorators
        if (file.includes("controller") || file.includes("Controller")) {
          const nestMethodMatch = lineText.match(/@(Get|Post|Put|Delete|Patch)\s*\(\s*["'`]?([^"'`]*)["'`]?\s*\)/i);
          if (nestMethodMatch) {
            const method = nestMethodMatch[1].toUpperCase();
            let subPath = nestMethodMatch[2] ? nestMethodMatch[2].trim() : "";
            if (subPath && !subPath.startsWith("/")) subPath = "/" + subPath;

            const meta = categorizeRoute(subPath, baseFilename);
            routes.push({
              id: `route-${idCounter++}`,
              method,
              path: subPath || "/",
              file: relPath,
              line: lineNum,
              framework: "NestJS",
              tag: meta.tag,
              executionOrder: meta.executionOrder,
              requiresAuth: meta.requiresAuth,
              description: meta.description,
              suggestedHeaders: meta.requiresAuth ? { Authorization: "Bearer <token>" } : undefined,
              suggestedBody: ["POST", "PUT", "PATCH"].includes(method) ? (Object.keys(extractedBodyProps).length > 0 ? extractedBodyProps : { sample_field: "value" }) : undefined
            });
            return;
          }
        }
      });
    } catch {
      // Ignore unreadable files
    }
  }

  // Sort routes by execution order priority
  return routes.sort((a, b) => a.executionOrder - b.executionOrder || a.path.localeCompare(b.path));
}
