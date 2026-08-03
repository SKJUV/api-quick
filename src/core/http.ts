import type { NetworkRequestSpec, NetworkResponseSpec } from "../types/index.js";

export class CoreHttpEngine {
  public async execute(spec: NetworkRequestSpec): Promise<NetworkResponseSpec> {
    const startTime = performance.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), spec.timeoutMs);

    const headers = new Headers(spec.headers);

    let requestBody: any = spec.body;
    if (typeof spec.body === "object" && !(spec.body instanceof Uint8Array)) {
      requestBody = JSON.stringify(spec.body);
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
    }

    try {
      const response = await fetch(spec.url, {
        method: spec.method,
        headers,
        body: ["GET", "HEAD"].includes(spec.method) ? undefined : requestBody,
        redirect: spec.followRedirects ? "follow" : "manual",
        signal: controller.signal,
      });

      const ttfb = performance.now() - startTime;
      const responseText = await response.text();
      const totalTime = performance.now() - startTime;

      clearTimeout(timeoutId);

      const respHeaders: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        respHeaders[key.toLowerCase()] = val;
      });

      return {
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
        body: responseText,
        metrics: {
          dnsLookupTimeMs: 0,
          tcpHandshakeTimeMs: 0,
          tlsHandshakeTimeMs: 0,
          timeToFirstByteMs: Math.round(ttfb * 100) / 100,
          downloadTimeMs: Math.round((totalTime - ttfb) * 100) / 100,
          totalTimeMs: Math.round(totalTime * 100) / 100,
          bytesReceived: Buffer.byteLength(responseText, "utf-8"),
        },
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        throw new Error(`[Network Engine Failure] Request timed out after ${spec.timeoutMs}ms`);
      }
      throw new Error(`[Network Engine Failure] ${err.message}`);
    }
  }
}
