type Env = Record<string, string | undefined>;

/** Tracing is on only when the owner names an OTLP endpoint; there is no default destination. */
export function tracingEnabled(env: Env = process.env): boolean {
  if (env.OTEL_SDK_DISABLED === "true") return false;
  return Boolean(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || env.OTEL_EXPORTER_OTLP_ENDPOINT);
}

/** Prompts, messages, tool arguments and results leave the process only when this is "true". */
export function captureContent(env: Env = process.env): boolean {
  return env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT === "true";
}
