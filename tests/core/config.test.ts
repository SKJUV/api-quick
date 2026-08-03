import { describe, expect, it } from "vitest";
import { type ApiQuickConfig, interpolateVariables, resolveEnvironmentVariables } from "../../src/core/config.js";

describe("Config & Variable Interpolation Engine", () => {
  it("should interpolate {{VAR}} double curly syntax", () => {
    const vars = { BASE_URL: "https://api.staging.com", TOKEN: "secret123" };
    const input = "{{BASE_URL}}/users?token={{TOKEN}}";
    const result = interpolateVariables(input, vars);
    expect(result).toBe("https://api.staging.com/users?token=secret123");
  });

  it("should interpolate ${VAR} shell syntax", () => {
    const vars = { HOST: "localhost", PORT: "8080" };
    const input = "http://${HOST}:${PORT}/health";
    const result = interpolateVariables(input, vars);
    expect(result).toBe("http://localhost:8080/health");
  });

  it("should leave unmatched variable placeholders untouched", () => {
    const vars = { KNOWN: "value" };
    const input = "{{KNOWN}} and {{UNKNOWN}}";
    const result = interpolateVariables(input, vars);
    expect(result).toBe("value and {{UNKNOWN}}");
  });

  it("should resolve environment profile variables correctly", () => {
    const config: ApiQuickConfig = {
      defaultEnvironment: "dev",
      environments: {
        dev: { variables: { BASE_URL: "http://localhost:4000" } },
        prod: { variables: { BASE_URL: "https://api.production.com" } },
      },
    };

    const devVars = resolveEnvironmentVariables(config, "dev");
    expect(devVars.BASE_URL).toBe("http://localhost:4000");

    const prodVars = resolveEnvironmentVariables(config, "prod");
    expect(prodVars.BASE_URL).toBe("https://api.production.com");
  });
});
