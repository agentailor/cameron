export async function register() {
  // Node-only setup lives in its own file so the Edge build never analyzes it.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTracing } = await import("./instrumentation.node");
    await startTracing();
  }
}
