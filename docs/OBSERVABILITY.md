# Observability

Cameron traces every agent run with [OpenTelemetry](https://opentelemetry.io), using the
[GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/), and exports the
spans over OTLP to a backend **you** run. The default is [Phoenix](https://phoenix.arize.com),
self-hosted next to Cameron. Any OTLP backend works by changing one variable.

## Why the traces stay with you

A trace of an agent run can hold the most sensitive data in the system: what you asked, every
transaction a tool read, every amount the model wrote. Cameron's third rule is that financial data
stays on infrastructure you control, and that has to include the traces. So:

- **Tracing is off unless you name an endpoint.** There is no default destination in the code.
- **Content is a second, separate opt-in.** With it off (the default), only metadata leaves the
  process — see [What a trace contains](#what-a-trace-contains).
- **There is no vendor SDK.** Cameron emits standard spans; the backend is your choice.

## Quick start (development)

```bash
docker compose --profile tracing up -d     # dev Postgres + MinIO + Phoenix on 127.0.0.1:6006
```

Add to `.env.local`, then restart `pnpm dev`:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6006
```

Send a message, then open <http://localhost:6006>. Spans land in Phoenix's `default` project;
each Cameron thread is a Phoenix **session**, so an approval pause and its resume sit together.

The trace list shows each trace's top span, which is Next.js's `GET /api/agent/stream` request span,
so its kind reads `unknown`: it carries no GenAI attributes. That is expected — agent and HTTP
tracing share one trace on purpose. Token and cost totals per trace and per session still add up,
because Phoenix sums them over the whole tree; filter spans by `span_kind == 'AGENT'` to list
agent runs alone.

## Production

`docker compose --profile full up` starts `phoenix-prod` (127.0.0.1:**6016**) with its own volume,
and the `web` service traces to it out of the box — metadata only. Production traces are kept
apart from dev traces for the same reason the databases are (see "Two stacks" in
[AGENTS.md](../AGENTS.md)): `docker compose --profile full down -v` deletes them along with your
financial data.

The production variables are `PROD_`-prefixed so a host-dev value in `.env` can never redirect
production traces:

| Variable                                                  | Default                            |
| --------------------------------------------------------- | ---------------------------------- |
| `PROD_OTEL_EXPORTER_OTLP_ENDPOINT`                        | `http://phoenix-prod:6006`         |
| `PROD_OTEL_EXPORTER_OTLP_HEADERS`                         | _(empty)_                          |
| `PROD_OTEL_SDK_DISABLED`                                  | `false` — `true` turns tracing off |
| `PROD_OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `false`                            |

Both Phoenix services bind to loopback only and run with Phoenix's usage telemetry disabled.
Phoenix has no login by default; don't publish its port.

## Configuration

Everything is a standard OpenTelemetry variable:

| Variable                                             | Effect                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                        | Turns tracing on and sets the destination (`/v1/traces` is appended).  |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`                 | Same, but the full traces URL.                                         |
| `OTEL_EXPORTER_OTLP_HEADERS`                         | Auth for backends that need it (`key=value,key2=value2`).              |
| `OTEL_SERVICE_NAME`                                  | Defaults to `cameron`.                                                 |
| `OTEL_SDK_DISABLED`                                  | `true` turns tracing off even with an endpoint set.                    |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `true` adds prompts, messages, tool arguments, results and error text. |

## What a trace contains

One user message (or one approval decision) is one trace:

```
GET /api/agent/stream                       Next.js route span
└─ executing api route (app) …
   ├─ invoke_agent cameron                   the agent run                 (AGENT)
   │  ├─ chat <model>                        a model call                  (LLM)
   │  ├─ execute_tool <tool>                 a tool call                   (TOOL)
   │  └─ chat <model>
   └─ fetch POST <provider url>              Next.js's own fetch spans
```

Graph nodes and middleware get no span. **With content capture off**, these are the only
attributes Cameron sets:

| Span           | Attributes                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invoke_agent` | `gen_ai.agent.name`, `gen_ai.conversation.id` (the thread id), `cameron.run.resumed`, and on a resume `cameron.approval.approved` / `.rejected` counts   |
| `chat`         | `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens` / `output_tokens`, `gen_ai.response.finish_reasons` |
| `execute_tool` | `gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.tool.type`, `cameron.tool.mutating`                                                                   |
| any, on error  | `error.type` and ERROR status — no message, no stack trace (an error message can quote an amount)                                                        |

When the approval gate pauses a run, the `invoke_agent` span gets a `cameron.approval.requested`
event listing the gated **tool names** — never their arguments. A pause is not an error.

**With content capture on**, Cameron adds `gen_ai.system_instructions`, `gen_ai.input.messages`,
`gen_ai.output.messages`, `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`, the error
message and the exception event. On `invoke_agent`, the input is the turn's new user message (a
resume has none — its input is a decision) and the output is the run's last assistant message. Image and file blocks are recorded by type only, never inlined.
Turn this on to debug, not by default: the result of a `run_sql` or `query_transactions` call is
your ledger.

The thread id is metadata, not content, so it is always sent; it is a random id, not a name.

## Other backends

The spans are plain OTLP, so a different backend is an endpoint change:

| Backend                  | Run it                                                                                   | Endpoint                                |
| ------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------- |
| Jaeger (generic tracing) | `docker run -p 127.0.0.1:16686:16686 -p 127.0.0.1:4318:4318 jaegertracing/jaeger:2.11.0` | `http://localhost:4318`                 |
| Self-hosted Langfuse     | [docker compose guide](https://langfuse.com/self-hosting/deployment/docker-compose)      | `http://localhost:3000/api/public/otel` |

Langfuse also needs `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20<base64 of pk-lf-…:sk-lf-…>`
(header values are URL-encoded, so the space is `%20`).

Jaeger shows the same tree but no LLM-specific view (messages, token counts appear as raw
attributes). Phoenix and Langfuse understand the GenAI conventions natively. A hosted backend also
works, but then your traces are no longer on infrastructure you control — keep content capture off
if you do.

## How it's built

| File                             | Role                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `instrumentation.ts`             | Starts the OTel Node SDK with the OTLP/proto exporter, only when tracing is enabled   |
| `src/lib/tracing/config.ts`      | `tracingEnabled()` and `captureContent()`, read from the environment                  |
| `src/lib/tracing/genAiTracer.ts` | LangChain callback handler that turns one run's callbacks into spans; one per request |
| `src/lib/tracing/semconv.ts`     | The only file naming `gen_ai.*` and `cameron.*` attributes                            |
| `src/lib/tracing/messages.ts`    | LangChain messages → the semconv message format (content capture only)                |
| `src/services/agentService.ts`   | Attaches a `GenAiTracer` to each run when tracing is enabled                          |

Notes for changing it:

- **The GenAI conventions are still at Development stability.** Every attribute name lives in
  `semconv.ts`; a rename is a one-file change. Phoenix (20.23) converts these attributes to its own
  OpenInference format at ingest, which is how it shows span kinds, sessions and token counts.
- **LangChain's callback arguments don't match its type definitions.** `handleChainStart` is called
  with `(chain, inputs, runId, parentRunId, tags, metadata, …)`; the `.d.ts` puts `parentRunId`
  eighth. `genAiTracer.ts` follows the runtime order.
- **The approval pause is only visible on the HITL node.** It fails with `GraphInterrupt` (which
  carries the gated tool names), while the run itself ends normally. A resumed run's input is the
  `Command`, which is where the decision counts come from.
- **Model `fetch` spans are not children of the `chat` span.** Next.js creates them in the route's
  context; a callback handler can open spans but can't make them the active context for code it
  doesn't call.
- Unit tests (`genAiTracer.test.ts`) drive the handler with hand-fed callbacks against an
  in-memory exporter — free and offline like the rest of `pnpm test`.
