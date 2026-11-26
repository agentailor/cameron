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
  const { startScheduler, stopScheduler } = await import("./lib/tasks/scheduler");
  startScheduler();

  // Next exits on SIGTERM by itself unless told not to; the Docker image sets this so runs get a
  // grace period and stop cleanly. See docs/TASKS.md.
  if (process.env.NEXT_MANUAL_SIG_HANDLE === "true") {
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.once(signal, () => {
        stopScheduler()
          .catch((error) => console.error("[tasks] Stopping the scheduler failed:", error))
          .finally(() => process.exit(0));
      });
    }
  }
}
