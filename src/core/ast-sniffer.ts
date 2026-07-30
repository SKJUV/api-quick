import fs from "fs";
import path from "path";

export interface DiscoveredRoute {
  id: string;
  method: string;
  path: string;
  file: string;
  line: number;
  framework: "NestJS" | "Express" | "Next.js" | "FastAPI" | "Go Gin" | "Generic";
  suggestedBody?: Record<string, any>;
}

export function sniffProjectRoutes(targetDir: string = process.cwd()): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  const filesToScan: string[] = [];

  function collectFiles(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", ".git", "dist", "build", ".next", "venv", ".venv"].includes(entry.name)) {
          continue;
        }
        collectFiles(fullPath);
      } else if (entry.isFile()) {
        if (/\.(ts|js|jsx|tsx|py|go)$/.test(entry.name)) {
          filesToScan.push(fullPath);
        }
      }
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

      lines.forEach((lineText, index) => {
        const lineNum = index + 1;

        // Detect @Controller('prefix') or @Controller("prefix") or @Controller()
        const controllerMatch = lineText.match(/@Controller\s*\(\s*["']?([^"']*)["']?\s*\)/i);
        if (controllerMatch) {
          isNestController = true;
          let prefix = controllerMatch[1] ? controllerMatch[1].trim() : "";
          if (prefix && !prefix.startsWith("/")) prefix = "/" + prefix;
          currentNestControllerPrefix = prefix;
          return;
        }

        // If inside a NestJS controller file, look for @Get, @Post, @Put, @Delete, @Patch
        if (isNestController || file.includes("controller")) {
          const nestMethodMatch = lineText.match(/@(Get|Post|Put|Delete|Patch|Options|Head)\s*\(\s*["']?([^"']*)["']?\s*\)/i);
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
              method,
              path: fullRoutePath || "/",
              file: relPath,
              line: lineNum,
              framework: "NestJS",
              suggestedBody: ["POST", "PUT", "PATCH"].includes(method) ? { sample_field: "value" } : undefined
            });
            return;
          }
        }

        // -------------------------------------------------------------
        // 2. EXPRESS / FASTIFY / HONO: app.get("/path"), router.post("/path")
        // -------------------------------------------------------------
        const expressMatch = lineText.match(/(?:app|router|server)\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/i);
        if (expressMatch) {
          routes.push({
            id: `route-${idCounter++}`,
            method: expressMatch[1].toUpperCase(),
            path: expressMatch[2],
            file: relPath,
            line: lineNum,
            framework: "Express",
            suggestedBody: ["POST", "PUT", "PATCH"].includes(expressMatch[1].toUpperCase()) ? { sample_field: "test_value" } : undefined
          });
          return;
        }

        // -------------------------------------------------------------
        // 3. PYTHON FASTAPI / FLASK: @app.get("/items"), @router.post("/login")
        // -------------------------------------------------------------
        const pythonMatch = lineText.match(/@(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/i);
        if (pythonMatch) {
          routes.push({
            id: `route-${idCounter++}`,
            method: pythonMatch[1].toUpperCase(),
            path: pythonMatch[2],
            file: relPath,
            line: lineNum,
            framework: "FastAPI",
            suggestedBody: ["POST", "PUT", "PATCH"].includes(pythonMatch[1].toUpperCase()) ? { sample_key: "sample_val" } : undefined
          });
          return;
        }

        // -------------------------------------------------------------
        // 4. GO GIN / ECHO: r.GET("/ping"), router.POST("/users")
        // -------------------------------------------------------------
        const goMatch = lineText.match(/(?:r|router|api|group)\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*["']([^"']+)["']/);
        if (goMatch) {
          routes.push({
            id: `route-${idCounter++}`,
            method: goMatch[1].toUpperCase(),
            path: goMatch[2],
            file: relPath,
            line: lineNum,
            framework: "Go Gin"
          });
          return;
        }
      });
    } catch {
      // Ignore unreadable files
    }
  }

  // -------------------------------------------------------------
  // 5. NEXT.JS APP ROUTER (app/api/.../route.ts)
  // -------------------------------------------------------------
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
    }
  }

  return routes;
}
