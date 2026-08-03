import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../../src/cli/parser.js";

describe("CLI Parser", () => {
  it("should parse HTTP method and URL correctly", () => {
    const args = parseCliArgs(["POST", "https://api.example.com/users"]);
    expect(args.method).toBe("POST");
    expect(args.url).toBe("https://api.example.com/users");
  });

  it("should default to GET method if method omitted", () => {
    const args = parseCliArgs(["https://api.example.com/users"]);
    expect(args.method).toBe("GET");
    expect(args.url).toBe("https://api.example.com/users");
  });

  it("should normalize localhost URLs to http protocol", () => {
    const args = parseCliArgs(["localhost:3000/health"]);
    expect(args.url).toBe("http://localhost:3000/health");
  });

  it("should parse headers accurately", () => {
    const args = parseCliArgs(["GET", "https://api.example.com", "Authorization:Bearer token123", "X-Custom:value"]);
    expect(args.headers.Authorization).toBe("Bearer token123");
    expect(args.headers["X-Custom"]).toBe("value");
  });

  it("should parse typed JSON body with := syntax", () => {
    const args = parseCliArgs(["POST", "https://api.example.com/users", 'name:="Alice"', "age:=30", "active:=true"]);
    expect(args.jsonBody).toEqual({
      name: "Alice",
      age: 30,
      active: true,
    });
  });

  it("should parse --expect-status and --expect-max-time flags", () => {
    const args = parseCliArgs([
      "GET",
      "https://api.example.com/health",
      "--expect-status",
      "200",
      "--expect-max-time",
      "150ms",
    ]);
    expect(args.expectStatus).toBe(200);
    expect(args.expectMaxTimeMs).toBe(150);
  });

  it("should parse --to transpilation target", () => {
    const args = parseCliArgs(["POST", "https://api.example.com/data", "--to", "python"]);
    expect(args.transpileTarget).toBe("python");
  });
});
