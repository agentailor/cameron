import { describe, expect, it } from "vitest";
import { captureContent, tracingEnabled } from "./config";

describe("tracingEnabled", () => {
  it("is off when no OTLP endpoint is set", () => {
    expect(tracingEnabled({})).toBe(false);
  });

  it("is on for either the generic or the traces endpoint", () => {
    expect(tracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://phoenix:6006" })).toBe(true);
    expect(
      tracingEnabled({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://phoenix:6006/v1/traces" }),
    ).toBe(true);
  });

  it("respects OTEL_SDK_DISABLED even with an endpoint", () => {
    expect(
      tracingEnabled({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://phoenix:6006",
        OTEL_SDK_DISABLED: "true",
      }),
    ).toBe(false);
  });
});

describe("captureContent", () => {
  it("is off unless explicitly enabled", () => {
    expect(captureContent({})).toBe(false);
    expect(captureContent({ OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: "1" })).toBe(false);
    expect(captureContent({ OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: "true" })).toBe(
      true,
    );
  });
});
