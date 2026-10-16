export async function register() {
  // @opentelemetry/sdk-node is Node-only; Next.js also evaluates this file for the Edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { tracingEnabled } = await import("./src/lib/tracing/config");
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
