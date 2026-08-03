import type { HttpMethod, NetworkRequestSpec, NetworkResponseSpec } from "../types/index.js";
import { CoreHttpEngine } from "./http.js";

export interface WorkflowStep {
  id: string;
  name: string;
  method: string;
  urlTemplate: string;
  headers?: Record<string, string>;
  bodyTemplate?: string;
  extractors?: Record<string, string>; // e.g. { authToken: "$.token", orderId: "$.id" }
}

export interface WorkflowExecutionResult {
  stepId: string;
  stepName: string;
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  extractedValues: Record<string, any>;
  error?: string;
}

export class WorkflowEngine {
  private httpEngine: CoreHttpEngine;

  constructor() {
    this.httpEngine = new CoreHttpEngine();
  }

  async runWorkflow(
    steps: WorkflowStep[],
    initialContext: Record<string, any> = {},
  ): Promise<WorkflowExecutionResult[]> {
    const context: Record<string, any> = { ...initialContext };
    const results: WorkflowExecutionResult[] = [];

    for (const step of steps) {
      // Interpolate context variables in URL, Headers, Body
      const interpolatedUrl = this.interpolate(step.urlTemplate, context);
      const interpolatedBody = step.bodyTemplate ? this.interpolate(step.bodyTemplate, context) : undefined;

      const interpolatedHeaders: Record<string, string> = {};
      if (step.headers) {
        for (const [k, v] of Object.entries(step.headers)) {
          interpolatedHeaders[k] = this.interpolate(v, context);
        }
      }

      if (context.authToken && !interpolatedHeaders.Authorization) {
        interpolatedHeaders.Authorization = context.authToken.startsWith("Bearer ")
          ? context.authToken
          : `Bearer ${context.authToken}`;
      }

      const reqOptions: NetworkRequestSpec = {
        url: interpolatedUrl,
        method: step.method as HttpMethod,
        headers: interpolatedHeaders,
        body: interpolatedBody,
        timeoutMs: 10000,
        followRedirects: true,
        tlsVerify: true,
      };

      try {
        const response: NetworkResponseSpec = await this.httpEngine.execute(reqOptions);
        const extractedValues: Record<string, any> = {};

        // Auto-capture tokens or extractors
        if (response.status < 300 && response.body) {
          try {
            const parsedJson = JSON.parse(response.body);

            // Auto token capture
            const tokenCandidate =
              parsedJson.token || parsedJson.accessToken || parsedJson.access_token || parsedJson.jwt;
            if (tokenCandidate && typeof tokenCandidate === "string") {
              context.authToken = tokenCandidate;
              extractedValues.authToken = tokenCandidate;
            }

            // Custom JSONPath extractors
            if (step.extractors) {
              for (const [varName, pathKey] of Object.entries(step.extractors)) {
                const key = pathKey.replace(/^\$\./, "");
                if (parsedJson[key] !== undefined) {
                  context[varName] = parsedJson[key];
                  extractedValues[varName] = parsedJson[key];
                }
              }
            }
          } catch {}
        }

        results.push({
          stepId: step.id,
          stepName: step.name,
          url: interpolatedUrl,
          status: response.status,
          statusText: response.statusText,
          durationMs: response.metrics.totalTimeMs,
          extractedValues,
        });

        // Abort workflow on severe HTTP error
        if (response.status >= 400) {
          break;
        }
      } catch (err: any) {
        results.push({
          stepId: step.id,
          stepName: step.name,
          url: interpolatedUrl,
          status: 500,
          statusText: "Error",
          durationMs: 0,
          extractedValues: {},
          error: err.message,
        });
        break;
      }
    }

    return results;
  }

  private interpolate(template: string, context: Record<string, any>): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
      return context[key] !== undefined ? String(context[key]) : `{{${key}}}`;
    });
  }
}
