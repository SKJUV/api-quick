import fs from "fs";
import path from "path";

export interface DiscoveredRoute {
  id: string;
  method: string;
  path: string;
  file: string;
  line: number;
  framework: "Express/NestJS" | "Next.js" | "FastAPI" | "Go Gin" | "Generic";
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

      lines.forEach((lineText, index) => {
        const lineNum = index + 1;
        const relPath = path.relative(targetDir, file);

        // 1. Express / NestJS / Fastify: app.get("/api/...", ...), router.post("/users", ...)
        const expressMatch = lineText.match(/(?:app|router|server)\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/i);
        if (expressMatch) {
          routes.push({
            id: `route-${idCounter++}`,
            method: expressMatch[1].toUpperCase(),
            path: expressMatch[2],
            file: relPath,
            line: lineNum,
            framework: "Express/NestJS",
            suggestedBody: expressMatch[1].toLowerCase() !== "get" ? { sample_field: "test_value" } : undefined
          });
        }

        // 2. Python FastAPI / Flask: @app.get("/items"), @router.post("/login")
        const pythonMatch = lineText.match(/@(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/i);
        if (pythonMatch) {
          routes.push({
            id: `route-${idCounter++}`,
            method: pythonMatch[1].toUpperCase(),
            path: pythonMatch[2],
            file: relPath,
            line: lineNum,
            framework: "FastAPI",
            suggestedBody: pythonMatch[1].toLowerCase() !== "get" ? { sample_key: "sample_val" } : undefined
          });
        }

        // 3. Go Gin / Echo: r.GET("/ping"), router.POST("/users")
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
        }
      });
    } catch {
      // Ignore unreadable files
    }
  }

  // Next.js App Router detection (app/api/.../route.ts)
  for (const file of filesToScan) {
    if (file.includes("app/api/") && /(route|index)\.(ts|js)$/.test(file)) {
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
    }
  }

  return routes;
}
