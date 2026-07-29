import { CliArguments, NetworkResponseSpec } from "../types/index.js";
import { formatError, formatSuccess } from "./formatter.js";

export const POSIX_EXIT_CODES = {
  EXIT_SUCCESS: 0,
  EXIT_ASSERTION_FAILED: 1,
  EXIT_NETWORK_TIMEOUT: 2,
  EXIT_SYNTAX_ERROR: 3,
  EXIT_CRYPTO_AUTH_FAIL: 4
} as const;

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
      console.error(formatError(`Assertion Failed: Response time ${res.metrics.totalTimeMs}ms exceeded max limit ${args.expectMaxTimeMs}ms`));
      allPassed = false;
    } else {
      console.log(formatSuccess(`Assertion Passed: Response time ${res.metrics.totalTimeMs}ms <= ${args.expectMaxTimeMs}ms`));
    }
  }

  // 3. Expected Headers Check
  if (args.expectHeaders) {
    for (const [key, expectedVal] of Object.entries(args.expectHeaders)) {
      const actualVal = res.headers[key.toLowerCase()];
      if (!actualVal || !actualVal.includes(expectedVal)) {
        console.error(formatError(`Assertion Failed: Expected header "${key}" to contain "${expectedVal}", got "${actualVal || ""}"`));
        allPassed = false;
      } else {
        console.log(formatSuccess(`Assertion Passed: Header "${key}" matched "${expectedVal}"`));
      }
    }
  }

  // 4. JSONPath Assertions
  let parsedBody: any;
  try {
    parsedBody = JSON.parse(res.body);
  } catch {
    parsedBody = null;
  }

  for (const assertion of args.expectAssertions) {
    if (!parsedBody) {
      console.error(formatError(`Assertion Failed: Cannot evaluate JSONPath "${assertion.jsonPath}" on non-JSON response body.`));
      allPassed = false;
      continue;
    }

    const actual = resolveSimpleJsonPath(parsedBody, assertion.jsonPath);
    if (actual === undefined) {
      console.error(formatError(`Assertion Failed: JSONPath "${assertion.jsonPath}" resolved to undefined.`));
      allPassed = false;
    } else if (String(actual) !== String(assertion.expectedValue)) {
      console.error(formatError(`Assertion Failed: JSONPath "${assertion.jsonPath}" expected "${assertion.expectedValue}", got "${actual}"`));
      allPassed = false;
    } else {
      console.log(formatSuccess(`Assertion Passed: JSONPath "${assertion.jsonPath}" = "${actual}"`));
    }
  }

  return allPassed ? POSIX_EXIT_CODES.EXIT_SUCCESS : POSIX_EXIT_CODES.EXIT_ASSERTION_FAILED;
}

function resolveSimpleJsonPath(obj: any, path: string): any {
  const cleanPath = path.replace(/^\$\./, "");
  const parts = cleanPath.split(".");
  let current = obj;

  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}
