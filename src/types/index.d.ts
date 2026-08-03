export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

export interface NetworkRequestSpec {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: Uint8Array | ReadableStream | string;
  timeoutMs: number;
  httpVersion?: "1.1" | "2" | "3";
  followRedirects: boolean;
  tlsVerify: boolean;
}

export interface NetworkResponseMetrics {
  dnsLookupTimeMs: number;
  tcpHandshakeTimeMs: number;
  tlsHandshakeTimeMs: number;
  timeToFirstByteMs: number;
  downloadTimeMs: number;
  totalTimeMs: number;
  bytesReceived: number;
}

export interface NetworkResponseSpec {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  metrics: NetworkResponseMetrics;
}

export type TranspileTarget = "curl" | "fetch-ts" | "python" | "go" | "rust" | "java" | "csharp" | "php";

export type AssertionOperator = "=" | "!=" | ">" | "<" | ">=" | "<=" | "~=" | "exists";

export interface JsonAssertion {
  jsonPath: string;
  operator: AssertionOperator;
  expectedValue: any;
}

export interface CliArguments {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  params: Record<string, string>;
  jsonBody?: Record<string, any>;
  rawBody?: string;
  transpileTarget?: TranspileTarget;
  expectStatus?: number;
  expectMaxTimeMs?: number;
  expectHeaders?: Record<string, string>;
  expectAssertions: JsonAssertion[];
}
