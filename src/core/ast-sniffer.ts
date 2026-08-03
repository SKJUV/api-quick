import fs from "node:fs";
import path from "node:path";

export type SupportedFramework =
  | "NestJS"
  | "Express/Fastify/Hono"
  | "Next.js"
  | "FastAPI/Flask"
  | "Django"
  | "Go (Gin/Fiber/Echo)"
  | "Spring Boot"
  | "Laravel"
  | "Generic";

export interface DiscoveredRoute {
  id: string;
  method: string;
  path: string;
  file: string;
  line: number;
  framework: SupportedFramework;
  tag: string;
  executionOrder: number;
  requiresAuth: boolean;
  description: string;
  suggestedHeaders?: Record<string, string>;
  suggestedBody?: Record<string, any>;
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
          if (
            [
              "node_modules",
              ".git",
              "dist",
              "build",
              ".next",
              "venv",
              ".venv",
              "__pycache__",
              "target",
              "vendor",
            ].includes(entry.name)
          ) {
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

  function categorizeRoute(
    routePath: string,
    filename: string,
  ): { tag: string; executionOrder: number; requiresAuth: boolean; description: string } {
    const lowerPath = routePath.toLowerCase();
    const lowerFile = filename.toLowerCase();

    if (
      lowerPath.includes("auth") ||
      lowerPath.includes("login") ||
      lowerPath.includes("register") ||
      lowerPath.includes("sync") ||
      lowerFile.includes("auth")
    ) {
      const isPublic = lowerPath.includes("login") || lowerPath.includes("register");
      return {
        tag: "Authentication & Identity",
        executionOrder: 1,
        requiresAuth: !isPublic,
        description: isPublic ? "Public authentication endpoint." : "Authenticated session endpoint.",
      };
    }

    if (lowerPath.includes("me") || lowerPath.includes("profile") || lowerPath.includes("user")) {
      return {
        tag: "User Profile & Account",
        executionOrder: 2,
        requiresAuth: true,
        description: "User account management operations.",
      };
    }

    if (lowerPath.includes("admin") || lowerPath.includes("dashboard") || lowerFile.includes("admin")) {
      return {
        tag: "Administrative Operations",
        executionOrder: 4,
        requiresAuth: true,
        description: "Restricted administrative metrics and system configuration.",
      };
    }

    const tagName = baseModuleName(filename) || "General Operations";
    return {
      tag: tagName.charAt(0).toUpperCase() + tagName.slice(1),
      executionOrder: 3,
      requiresAuth: true,
      description: `API operation for ${tagName} module.`,
    };
  }

  function baseModuleName(filename: string): string {
    return path.basename(filename, path.extname(filename)).replace(/\.(routes|route|controller)$/, "");
  }

  let idCounter = 1;

  for (const file of filesToScan) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");
      const relPath = path.relative(targetDir, file);
      const baseFilename = baseModuleName(file);

      // Next.js App Router API Route detection (route.ts / route.js)
      if (file.includes(path.join("app", "api")) && (file.endsWith("route.ts") || file.endsWith("route.js"))) {
        const routeDir = path.dirname(relPath);
        const apiPath = `/${routeDir.replace(/^.*app\//, "").replace(/\/route\.[jt]s$/, "")}`;
        for (let index = 0; index < lines.length; index++) {
          const lineText = lines[index];
          const nextMatch = lineText.match(/export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH|HEAD)\s*\(/i);
          if (nextMatch) {
            const method = nextMatch[1].toUpperCase();
            const meta = categorizeRoute(apiPath, baseFilename);
            routes.push({
              id: `route-${idCounter++}`,
              method,
              path: apiPath,
              file: relPath,
              line: index + 1,
              framework: "Next.js",
              tag: meta.tag,
              executionOrder: meta.executionOrder,
              requiresAuth: meta.requiresAuth,
              description: meta.description,
            });
          }
        }
      }

      lines.forEach((lineText, index) => {
        const lineNum = index + 1;

        // Express / Fastify / Hono: app.get("/path"), router.post("/path")
        const expressMatch = lineText.match(
          /(?:app|router|server|instance|hono)\.(get|post|put|delete|patch|all)\s*\(\s*["']([^"']+)["']/i,
        );
        if (expressMatch) {
          const method = expressMatch[1].toUpperCase() === "ALL" ? "GET" : expressMatch[1].toUpperCase();
          let rawPath = expressMatch[2];
          if (!rawPath.startsWith("/")) rawPath = `/${rawPath}`;

          const meta = categorizeRoute(rawPath, baseFilename);
          routes.push({
            id: `route-${idCounter++}`,
            method,
            path: rawPath,
            file: relPath,
            line: lineNum,
            framework: "Express/Fastify/Hono",
            tag: meta.tag,
            executionOrder: meta.executionOrder,
            requiresAuth: meta.requiresAuth,
            description: meta.description,
            suggestedHeaders: meta.requiresAuth ? { Authorization: "Bearer <token>" } : undefined,
          });
          return;
        }

        // NestJS Decorators: @Get('/path'), @Post('/path')
        if (file.includes("controller") || file.includes("Controller")) {
          const nestMatch = lineText.match(/@(Get|Post|Put|Delete|Patch)\s*\(\s*["'`]?([^"'`]*)["'`]?\s*\)/i);
          if (nestMatch) {
            const method = nestMatch[1].toUpperCase();
            let subPath = nestMatch[2] ? nestMatch[2].trim() : "";
            if (subPath && !subPath.startsWith("/")) subPath = `/${subPath}`;

            const meta = categorizeRoute(subPath || "/", baseFilename);
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
            });
            return;
          }
        }

        // Python FastAPI / Flask: @app.get("/path"), @router.post("/path"), @app.route("/path", methods=["POST"])
        const pyMatch = lineText.match(/@(app|router|api)\.(get|post|put|delete|patch|route)\s*\(\s*["']([^"']+)["']/i);
        if (pyMatch) {
          const method = pyMatch[2].toUpperCase() === "ROUTE" ? "GET" : pyMatch[2].toUpperCase();
          const rawPath = pyMatch[3];
          const meta = categorizeRoute(rawPath, baseFilename);
          routes.push({
            id: `route-${idCounter++}`,
            method,
            path: rawPath,
            file: relPath,
            line: lineNum,
            framework: "FastAPI/Flask",
            tag: meta.tag,
            executionOrder: meta.executionOrder,
            requiresAuth: meta.requiresAuth,
            description: meta.description,
          });
          return;
        }

        // Go Gin / Fiber / Echo: r.GET("/path", ...), app.Post("/path", ...)
        const goMatch = lineText.match(
          /(?:r|app|router|e|group|api)\.(GET|POST|PUT|DELETE|PATCH|Get|Post|Put|Delete|Patch)\s*\(\s*["']([^"']+)["']/i,
        );
        if (goMatch) {
          const method = goMatch[1].toUpperCase();
          const rawPath = goMatch[2];
          const meta = categorizeRoute(rawPath, baseFilename);
          routes.push({
            id: `route-${idCounter++}`,
            method,
            path: rawPath,
            file: relPath,
            line: lineNum,
            framework: "Go (Gin/Fiber/Echo)",
            tag: meta.tag,
            executionOrder: meta.executionOrder,
            requiresAuth: meta.requiresAuth,
            description: meta.description,
          });
          return;
        }

        // Java Spring Boot: @GetMapping("/path"), @PostMapping("/path")
        const springMatch = lineText.match(
          /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/i,
        );
        if (springMatch) {
          const method = springMatch[1].toUpperCase();
          const rawPath = springMatch[2];
          const meta = categorizeRoute(rawPath, baseFilename);
          routes.push({
            id: `route-${idCounter++}`,
            method,
            path: rawPath,
            file: relPath,
            line: lineNum,
            framework: "Spring Boot",
            tag: meta.tag,
            executionOrder: meta.executionOrder,
            requiresAuth: meta.requiresAuth,
            description: meta.description,
          });
          return;
        }

        // PHP Laravel: Route::get('/path', ...), Route::post('/path', ...)
        const laravelMatch = lineText.match(/Route::(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/i);
        if (laravelMatch) {
          const method = laravelMatch[1].toUpperCase();
          const rawPath = laravelMatch[2].startsWith("/") ? laravelMatch[2] : `/${laravelMatch[2]}`;
          const meta = categorizeRoute(rawPath, baseFilename);
          routes.push({
            id: `route-${idCounter++}`,
            method,
            path: rawPath,
            file: relPath,
            line: lineNum,
            framework: "Laravel",
            tag: meta.tag,
            executionOrder: meta.executionOrder,
            requiresAuth: meta.requiresAuth,
            description: meta.description,
          });
          return;
        }
      });
    } catch {
      // Ignore unreadable file
    }
  }

  return routes.sort((a, b) => a.executionOrder - b.executionOrder || a.path.localeCompare(b.path));
}
