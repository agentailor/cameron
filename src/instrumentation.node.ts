import { tracingEnabled } from "./lib/tracing/config";

export async function startTracing() {
  if (!tracingEnabled()) return;

  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-proto");

  // Endpoint and headers come from the standard OTEL_EXPORTER_OTLP_* variables.
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "cameron",
    traceExporter: new OTLPTraceExporter(),
  });
  sdk.start();
  process.once("SIGTERM", () => void sdk.shutdown());
}

/** The scheduled-task loop. Tasks are off until the owner enables one, so this runs nothing by default. */
export async function startTasks() {
  const { startScheduler } = await import("./lib/tasks/scheduler");
  startScheduler();
}
