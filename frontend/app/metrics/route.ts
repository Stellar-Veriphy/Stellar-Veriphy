import { pipelineMetrics } from "@/lib/server/pipeline-observability";
import {
  buildCapacityForecast,
  getCapacityHistory,
} from "@/lib/server/capacity-forecast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function GET(request?: Request): Response {
  const url = request?.url ? new URL(request.url) : undefined;
  const format = url?.searchParams.get("format")?.toLowerCase();

  if (format === "json" || format === "forecast") {
    const forecast = buildCapacityForecast();
    return jsonResponse({
      generatedAt: new Date().toISOString(),
      current: forecast.current,
      forecast: forecast.forecast,
      assumptions: forecast.assumptions,
      thresholds: forecast.thresholds,
      warnings: forecast.warnings,
      history: getCapacityHistory(),
    });
  }

  return new Response(pipelineMetrics(), {
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}