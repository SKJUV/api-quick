import fs from "fs";
import path from "path";

export interface DiscoveredRoute {
  id: string;
  method: string;
  path: string;
  file: string;
  line: number;
  framework: "NestJS" | "Express/Fastify" | "Next.js" | "FastAPI/Flask" | "Django" | "Go" | "Spring Boot" | "Laravel" | "Generic";
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

  let idCounter = 1;

  for (const file of filesToScan) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");
      const relPath = path.relative(targetDir, file);

      // -------------------------------------------------------------
      // 1. NESTJS DECORATOR DETECTION (@Controller + @Get/@Post/...)
      // -------------------------------------------------------------
      let currentNestControllerPrefix = "";
      let isNestController = false;

      // -------------------------------------------------------------
      // 2. SPRING BOOT JAVA/KOTLIN (@RestController + @RequestMapping)
      // -------------------------------------------------------------
      let currentSpringPrefix = "";
      let isSpringController = false;

      lines.forEach((lineText, index) => {
        const lineNum = index + 1;

        // NestJS Controller prefix
        const nestControllerMatch = lineText.match(/@Controller\s*\(\s*["'`]?([^"'`Matching]*)["'`]?\s*\)/i);
        if (nestControllerMatch) {
          isNestController = true;
          let prefix = nestControllerMatch[1] ? nestControllerMatch[1].trim() : "";
          if (prefix && !prefix.startsWith("/")) prefix = "/" + prefix;
          currentNestControllerPrefix = prefix;
          return;
        }

        // NestJS Method Decorators
        if (isNestController || file.includes("controller") || file.includes("Controller")) {
          const nestMethodMatch = lineText.match(/@(Get|Post|Put|Delete|Patch|Options|Head|All)\s*\(\s*["'`]?([^"'`]*)["'`]?\s*\)/i);
          if (nestMethodMatch) {
            const method = nestMethodMatch[1].toUpperCase();
            let subPath = nestMethodMatch[2] ? nestMethodMatch[2].trim() : "";
            if (subPath && !subPath.startsWith("/")) subPath = "/" + subPath;

            let fullRoutePath = (currentNestControllerPrefix || "") + subPath;
            if (!fullRoutePath.startsWith("/")) fullRoutePath = "/" + fullRoutePath;
            if (fullRoutePath.length > 1 && fullRoutePath.endsWith("/")) {
              fullRoutePath = fullRoutePath.slice(0, -1);
            }

            routes.push({
              id: `route-${idCounter++}`,
              method: method === "ALL" ? "GET" : method,
              path: fullRoutePath || "/",
              file: relPath,
              line: lineNum,
              framework: "NestJS",
              suggestedBody: ["POST", "PUT", "PATCH"].includes(method) ? { sample_field: "value" } : undefined
            });
            return;
          }
        }

        // Spring Boot RestController
        if (lineText.includes("@RestController") || lineText.includes("@Controller")) {
          isSpringController = true;
        }
        const springClassMapping = lineText.match(/@RequestMapping\s*\(\s*["']([^"']+)["']/);
        if (springClassMapping && isSpringController) {
          currentSpringPrefix = springClassMapping[1].startsWith("/") ? springClassMapping[1] : "/" + springClassMapping[1];
        }
        const springMethodMatch = lineText.match(/@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*["']?([^"']*)["']?\s*\)/i);
        if (springMethodMatch) {
          const method = springMethodMatch[1].toUpperCase();
          let subPath = springMethodMatch[2] ? springMethodMatch[2].trim() : "";
          if (subPath && !subPath.startsWith("/")) subPath = "/" + subPath;
          let fullRoutePath = currentSpringPrefix + subPath;
          if (!fullRoutePath.startsWith("/")) fullRoutePath = "/" + fullRoutePath;

          routes.push({
            id: `route-${idCounter++}`,
            method,
            path: fullRoutePath,
            file: relPath,
            line: lineNum,
            framework: "Spring Boot"
          });
          return;
        }

        // Express / Fastify / Hono / Polka: app.get("/path"), router.post("/path")
        const expressMatch = lineText.match(/(?:app|router|server|instance|hono)\.(get|post|put|delete|patch|all)\s*\(\s*["']([^"']+)["']/i);
        if (expressMatch) {
          routes.push({
            id: `route-${idCounter++}`,
            method: expressMatch[1].toUpperCase() === "ALL" ? "GET" : expressMatch[1].toUpperCase(),
            path: expressMatch[2],
            file: relPath,
            line: lineNum,
            framework: "Express/Fastify",
            suggestedBody: ["POST", "PUT", "PATCH"].includes(expressMatch[1].toUpperCase()) ? { sample_field: "test_value" } : undefined
          });
          return;
        }

        // Python FastAPI / Flask / Bottle: @app.get("/path"), @router.post("/path"), @app.route("/path")
        const pythonMatch = lineText.match(/@(?:app|router|api)\.(get|post|put|delete|patch|route)\s*\(\s*["']([^"']+)["']/i);
        if (pythonMatch) {
          let method = pythonMatch[1].toUpperCase();
          if (method === "ROUTE") method = "GET";
          routes.push({
            id: `route-${idCounter++}`,
            method,
            path: pythonMatch[2],
            file: relPath,
            line: lineNum,
            framework: "FastAPI/Flask",
            suggestedBody: ["POST", "PUT", "PATCH"].includes(method) ? { sample_key: "sample_val" } : undefined
          });
          return;
        }

        // Django path('api/users/', views.users)
        const djangoMatch = lineText.match(/path\s*\(\s*["']([^"']+)["']/);
        if (djangoMatch && file.includes("urls.py")) {
          let djPath = djangoMatch[1];
          if (!djPath.startsWith("/")) djPath = "/" + djPath;
          routes.push({
            id: `route-${idCounter++}`,
            method: "GET",
            path: djPath,
            file: relPath,
            line: lineNum,
            framework: "Django"
          });
          return;
        }

        // Go (Gin, Echo, Fiber, Chi, net/http): r.GET("/ping"), e.POST("/users")
        const goMatch = lineText.match(/(?:r|router|api|group|e|app|mux)\.(GET|POST|PUT|DELETE|PATCH|HandleFunc|Get|Post)\s*\(\s*["']([^"']+)["']/);
        if (goMatch) {
          let method = goMatch[1].toUpperCase();
          if (method === "HANDLEFUNC") method = "GET";
          routes.push({
            id: `route-${idCounter++}`,
            method,
            path: goMatch[2],
            file: relPath,
            line: lineNum,
            framework: "Go"
          });
          return;
        }

        // Laravel PHP: Route::get('/users', ...), Route::post('/login', ...)
        const laravelMatch = lineText.match(/Route::(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/i);
        if (laravelMatch) {
          routes.push({
            id: `route-${idCounter++}`,
            method: laravelMatch[1].toUpperCase(),
            path: laravelMatch[2].startsWith("/") ? laravelMatch[2] : "/" + laravelMatch[2],
            file: relPath,
            line: lineNum,
            framework: "Laravel"
          });
          return;
        }
      });
    } catch {
      // Ignore unreadable files
    }
  }

  // Next.js App Router (app/api/.../route.ts) and Pages Router (pages/api/...)
  for (const file of filesToScan) {
    if (file.includes("app/api/") && /(route|index)\.(ts|js)$/.test(file)) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        const relPath = path.relative(targetDir, file);
        const apiPath = "/api/" + file.split("app/api/")[1].replace(/\/(route|index)\.(ts|js)$/, "");
        
        ["GET", "POST", "PUT", "DELETE", "PATCH"].forEach(method => {
          if (new RegExp(`export\\s+async\\s+function\\s+${method}`, "i").test(content)) {
            routes.push({
              id: `route-${idCounter++}`,
              method,
              path: apiPath,
              file: relPath,
              line: 1,
              framework: "Next.js"
            });
          }
        });
      } catch {}
    } else if (file.includes("pages/api/") && /\.(ts|js)$/.test(file)) {
      try {
        const relPath = path.relative(targetDir, file);
        const apiPath = "/api/" + file.split("pages/api/")[1].replace(/\.(ts|js)$/, "");
        routes.push({
          id: `route-${idCounter++}`,
          method: "GET",
          path: apiPath,
          file: relPath,
          line: 1,
          framework: "Next.js"
        });
      } catch {}
    }
  }

  return routes;
}
