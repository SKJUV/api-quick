import { describe, expect, it } from "vitest";
import { compareJsonStructures } from "../../src/core/diff.js";

describe("JSON Structural Diff Engine", () => {
  it("should detect identical JSON structures and values", () => {
    const obj1 = { name: "Alice", age: 30, tags: ["dev", "lead"] };
    const obj2 = { name: "Alice", age: 30, tags: ["dev", "lead"] };
    const result = compareJsonStructures(obj1, obj2);
    expect(result.isIdentical).toBe(true);
  });

  it("should detect added and missing keys", () => {
    const obj1 = { id: 1, name: "Item 1" };
    const obj2 = { id: 1, name: "Item 1", extraField: "new" };
    const result = compareJsonStructures(obj1, obj2);
    expect(result.isIdentical).toBe(false);
    expect(result.addedKeys).toContain("extraField");
  });

  it("should detect modified field value types", () => {
    const obj1 = { price: 100 };
    const obj2 = { price: "100" };
    const result = compareJsonStructures(obj1, obj2);
    expect(result.isIdentical).toBe(false);
    expect(result.modifiedKeys.length).toBeGreaterThan(0);
  });
});
