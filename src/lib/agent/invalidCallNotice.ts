export type InvalidCall = { id?: string; name?: string; error?: string };

type MessageLike = { invalid_tool_calls?: unknown[]; content?: unknown };

/**
 * A message's tool calls whose arguments didn't parse. Read from both places LangChain puts them:
 * the `invalid_tool_calls` field, and — in its v1 output format, which leaves that field empty —
 * `invalid_tool_call` content blocks.
 */
export function findInvalidCalls(message: MessageLike | undefined): InvalidCall[] {
  const fromBlocks = Array.isArray(message?.content)
    ? (message.content as { type?: string }[]).filter((b) => b?.type === "invalid_tool_call")
    : [];
  const all = [...((message?.invalid_tool_calls ?? []) as InvalidCall[]), ...fromBlocks];
  const seen = new Set<string>();
  return (all as InvalidCall[]).filter((c) => {
    const key = c.id ?? `${c.name}:${c.error}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One line naming the tool calls that could not run because their arguments didn't parse. */
export function invalidCallNotice(calls: { name?: string }[]): string {
  const names = [...new Set(calls.map((c) => c.name || "a tool"))].join(", ");
  return `(The call to ${names} had arguments that were not valid JSON, so it was not run.)`;
}
