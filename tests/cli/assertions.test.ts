import { describe, expect, it } from "vitest";
import { evaluateJsonAssertion, resolveJsonPath } from "../../src/cli/assertions.js";

describe("Assertion Engine", () => {
  const sampleData = {
    status: "OK",
    code: 200,
    user: {
      id: 42,
      name: "Alice",
      roles: ["admin", "user"],
    },
    items: [10, 20, 30],
  };

  it("should resolve simple and nested JSON paths", () => {
    expect(resolveJsonPath(sampleData, "$.status")).toBe("OK");
    expect(resolveJsonPath(sampleData, "$.user.name")).toBe("Alice");
    expect(resolveJsonPath(sampleData, "$.user.roles[0]")).toBe("admin");
    expect(resolveJsonPath(sampleData, "$.items[1]")).toBe(20);
  });

  it("should return undefined for missing paths", () => {
    expect(resolveJsonPath(sampleData, "$.missing.key")).toBeUndefined();
  });

  it("should evaluate equality assertions correctly", () => {
    const res1 = evaluateJsonAssertion(sampleData, "$.status", "OK");
    expect(res1.passed).toBe(true);

    const res2 = evaluateJsonAssertion(sampleData, "$.user.id", "999");
    expect(res2.passed).toBe(false);
  });

  it("should evaluate length assertions (len=)", () => {
    const res = evaluateJsonAssertion(sampleData, "$.items", "len=3");
    expect(res.passed).toBe(true);
  });

  it("should evaluate type assertions (type=)", () => {
    const res1 = evaluateJsonAssertion(sampleData, "$.user.id", "type=number");
    expect(res1.passed).toBe(true);

    const res2 = evaluateJsonAssertion(sampleData, "$.user.roles", "type=array");
    expect(res2.passed).toBe(true);
  });

  it("should evaluate substring assertions (contains=)", () => {
    const res = evaluateJsonAssertion(sampleData, "$.user.name", "contains=ice");
    expect(res.passed).toBe(true);
  });
});
