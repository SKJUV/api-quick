import path from "node:path";
import { describe, expect, it } from "vitest";
import { sniffProjectRoutes } from "../../src/core/ast-sniffer.js";

describe("AST Route Sniffer", () => {
  it("should scan current project directory and discover routes", () => {
    const routes = sniffProjectRoutes(path.resolve(__dirname, "../../src"));
    expect(Array.isArray(routes)).toBe(true);
    for (const route of routes) {
      expect(route.method).toMatch(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/);
      expect(route.path).toBeDefined();
      expect(route.framework).toBeDefined();
    }
  });
});
