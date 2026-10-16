import { tracingEnabled } from "./src/lib/tracing/config";

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
