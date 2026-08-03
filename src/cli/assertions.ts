import type { CliArguments, NetworkResponseSpec } from "../types/index.js";
import { formatError, formatSuccess } from "./formatter.js";

export const POSIX_EXIT_CODES = {
  EXIT_SUCCESS: 0,
  EXIT_ASSERTION_FAILED: 1,
  EXIT_NETWORK_TIMEOUT: 2,
  EXIT_SYNTAX_ERROR: 3,
  EXIT_CRYPTO_AUTH_FAIL: 4,
} as const;

export interface AssertionResult {
  passed: boolean;
  message: string;
}

export function resolveJsonPath(obj: any, path: string): any {
  if (!obj || typeof obj !== "object") return undefined;

  const cleanPath = path.replace(/^\$\./, "");
  if (!cleanPath) return obj;

  // Split by dot or bracket notation: e.g. "users[0].name" -> ["users", "0", "name"]
  const tokens = cleanPath
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let current = obj;

  for (const token of tokens) {
    if (current !== null && current !== undefined && typeof current === "object" && token in current) {
      current = current[token];
    } else {
      return undefined;
    }
  }

  return current;
}

export function evaluateJsonAssertion(parsedBody: any, jsonPath: string, expectedVal: string): AssertionResult {
  if (!parsedBody) {
    return {
      passed: false,
      message: `Cannot evaluate JSONPath "${jsonPath}" on empty or non-JSON body`,
    };
  }

  const actual = resolveJsonPath(parsedBody, jsonPath);

  if (actual === undefined) {
    return {
      passed: false,
      message: `JSONPath "${jsonPath}" resolved to undefined`,
    };
  }

  // Support len= check for arrays/strings
  if (expectedVal.startsWith("len=")) {
    const targetLen = parseInt(expectedVal.slice(4), 10);
    const actualLen = Array.isArray(actual) || typeof actual === "string" ? actual.length : Object.keys(actual).length;
    const passed = actualLen === targetLen;
    return {
      passed,
      message: passed
        ? `JSONPath "${jsonPath}" length is ${actualLen}`
        : `JSONPath "${jsonPath}" expected length ${targetLen}, got ${actualLen}`,
    };
  }

  // Support type= check
  if (expectedVal.startsWith("type=")) {
    const targetType = expectedVal.slice(5).toLowerCase();
    const actualType = Array.isArray(actual) ? "array" : typeof actual;
    const passed = actualType === targetType;
    return {
      passed,
      message: passed
        ? `JSONPath "${jsonPath}" type is ${actualType}`
        : `JSONPath "${jsonPath}" expected type "${targetType}", got "${actualType}"`,
    };
  }

  // Support contains= check
  if (expectedVal.startsWith("contains=")) {
    const targetSubstring = expectedVal.slice(9);
    const actualStr = String(actual);
    const passed = actualStr.includes(targetSubstring);
    return {
      passed,
      message: passed
        ? `JSONPath "${jsonPath}" contains "${targetSubstring}"`
        : `JSONPath "${jsonPath}" ("${actualStr}") does not contain "${targetSubstring}"`,
    };
  }

  // Standard equality check
  const passed = String(actual) === expectedVal;
  return {
    passed,
    message: passed
      ? `JSONPath "${jsonPath}" = "${actual}"`
      : `JSONPath "${jsonPath}" expected "${expectedVal}", got "${actual}"`,
  };
}

export function evaluateAssertions(args: CliArguments, res: NetworkResponseSpec): number {
  let allPassed = true;

  // 1. Status Code Check
  if (args.expectStatus !== undefined) {
    if (res.status !== args.expectStatus) {
      console.error(formatError(`Assertion Failed: Expected HTTP status ${args.expectStatus}, received ${res.status}`));
      allPassed = false;
    } else {
      console.log(formatSuccess(`Assertion Passed: HTTP status is ${res.status}`));
    }
  }

  // 2. Response Time Check
  if (args.expectMaxTimeMs !== undefined) {
    if (res.metrics.totalTimeMs > args.expectMaxTimeMs) {
      console.error(
        formatError(
          `Assertion Failed: Response time ${res.metrics.totalTimeMs}ms exceeded limit ${args.expectMaxTimeMs}ms`,
        ),
      );
      allPassed = false;
    } else {
      console.log(
        formatSuccess(`Assertion Passed: Response time ${res.metrics.totalTimeMs}ms <= ${args.expectMaxTimeMs}ms`),
      );
    }
  }

  // 3. Expected Headers Check
  if (args.expectHeaders) {
    for (const [key, expectedVal] of Object.entries(args.expectHeaders)) {
      const actualVal = res.headers[key.toLowerCase()];
      if (!actualVal?.includes(expectedVal)) {
        console.error(
          formatError(
            `Assertion Failed: Expected header "${key}" to contain "${expectedVal}", got "${actualVal || ""}"`,
          ),
        );
        allPassed = false;
      } else {
        console.log(formatSuccess(`Assertion Passed: Header "${key}" matched "${expectedVal}"`));
      }
    }
  }

  // 4. JSONPath Assertions
  let parsedBody: any = null;
  try {
    parsedBody = JSON.parse(res.body);
  } catch {
    // Non-JSON body
  }

  for (const assertion of args.expectAssertions) {
    const result = evaluateJsonAssertion(parsedBody, assertion.jsonPath, assertion.expectedValue);
    if (result.passed) {
      console.log(formatSuccess(`Assertion Passed: ${result.message}`));
    } else {
      console.error(formatError(`Assertion Failed: ${result.message}`));
      allPassed = false;
    }
  }

  return allPassed ? POSIX_EXIT_CODES.EXIT_SUCCESS : POSIX_EXIT_CODES.EXIT_ASSERTION_FAILED;
}
