import { CoreHttpEngine } from "./http.js";
import { HttpMethod, NetworkRequestSpec } from "../types/index.js";

export interface BenchmarkOptions {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string;
  totalRequests: number;
  concurrency: number;
}

export interface BenchmarkResult {
  url: string;
  method: string;
  totalRequests: number;
  concurrency: number;
  totalDurationMs: number;
  requestsPerSecond: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  successCount: number;
  failureCount: number;
}

export class BenchmarkEngine {
  private httpEngine: CoreHttpEngine;

  constructor() {
    this.httpEngine = new CoreHttpEngine();
  }

  async runBenchmark(opts: BenchmarkOptions): Promise<BenchmarkResult> {
    const { url, method = "GET", headers = {}, body, totalRequests, concurrency } = opts;
    const durations: number[] = [];
    let successCount = 0;
    let failureCount = 0;

    const startTime = performance.now();
    let completedRequests = 0;

    const executeWorker = async () => {
      while (completedRequests < totalRequests) {
        completedRequests++;
        const reqSpec: NetworkRequestSpec = {
          url,
          method,
          headers,
          body,
          timeoutMs: 10000,
          followRedirects: true,
          tlsVerify: true
        };

        try {
          const res = await this.httpEngine.execute(reqSpec);
          durations.push(res.metrics.totalTimeMs);
          if (res.status < 400) {
            successCount++;
          } else {
            failureCount++;
          }
        } catch {
          failureCount++;
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, totalRequests) }, () => executeWorker());
    await Promise.all(workers);

    const totalDurationMs = Math.max(1, Math.round(performance.now() - startTime));
    durations.sort((a, b) => a - b);

    const count = durations.length || 1;
    const minMs = durations[0] || 0;
    const maxMs = durations[count - 1] || 0;
    const avgMs = Math.round((durations.reduce((sum, d) => sum + d, 0) / count) * 100) / 100;
    const p50Ms = durations[Math.floor(count * 0.5)] || 0;
    const p95Ms = durations[Math.floor(count * 0.95)] || 0;
    const p99Ms = durations[Math.floor(count * 0.99)] || 0;
    const requestsPerSecond = Math.round((totalRequests / (totalDurationMs / 1000)) * 100) / 100;

    return {
      url,
      method,
      totalRequests,
      concurrency,
      totalDurationMs,
      requestsPerSecond,
      p50Ms,
      p95Ms,
      p99Ms,
      minMs,
      maxMs,
      avgMs,
      successCount,
      failureCount
    };
  }
}
