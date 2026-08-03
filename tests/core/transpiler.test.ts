import { describe, expect, it } from "vitest";
import { transpileToCode } from "../../src/core/transpiler.js";
import type { CliArguments } from "../../src/types/index.js";

describe("Polyglot Transpiler", () => {
  const sampleArgs: CliArguments = {
    method: "POST",
    url: "https://api.example.com/users",
    headers: { "X-API-Key": "key123" },
    params: {},
    jsonBody: { name: "Alice", role: "ADMIN" },
    expectAssertions: [],
  };

  it("should transpile to valid curl command", () => {
    const code = transpileToCode(sampleArgs, "curl");
    expect(code).toContain('curl -X POST "https://api.example.com/users"');
    expect(code).toContain('-H "X-API-Key: key123"');
    expect(code).toContain("Content-Type: application/json");
  });

  it("should transpile to TypeScript fetch code", () => {
    const code = transpileToCode(sampleArgs, "fetch-ts");
    expect(code).toContain('const url = "https://api.example.com/users";');
    expect(code).toContain('method: "POST"');
    expect(code).toContain("await fetch(url, options);");
  });

  it("should transpile to Python requests code", () => {
    const code = transpileToCode(sampleArgs, "python");
    expect(code).toContain("import requests");
    expect(code).toContain("response = requests.post(url, json=payload, headers=headers)");
  });

  it("should transpile to Go http code", () => {
    const code = transpileToCode(sampleArgs, "go");
    expect(code).toContain("package main");
    expect(code).toContain('http.NewRequest("POST", url, payload)');
  });

  it("should transpile to Rust reqwest code", () => {
    const code = transpileToCode(sampleArgs, "rust");
    expect(code).toContain("use reqwest::Client;");
    expect(code).toContain('.header("X-API-Key", "key123")');
  });
});
