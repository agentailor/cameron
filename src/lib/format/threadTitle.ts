/** Fallback when a message yields no usable title (attachment-only sends, whitespace, emoji). */
export const DEFAULT_THREAD_TITLE = "New thread";

const MAX_LENGTH = 48;

/**
 * Title for a new thread, derived from its first message.
 *
 * Trimmed at a word boundary so the label reads as words rather than a cut-off token, and capped
 * well under the sidebar's width — the list truncates with an ellipsis anyway, so a longer title
 * only costs payload.
 */
export function deriveThreadTitle(message: string): string {
  // Collapse newlines and runs of whitespace: a pasted multi-line prompt should not become a
  // title with line breaks in it.
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return DEFAULT_THREAD_TITLE;

  if (normalized.length <= MAX_LENGTH) return normalized;

  const clipped = normalized.slice(0, MAX_LENGTH);
  const lastSpace = clipped.lastIndexOf(" ");
  // Only honor the word boundary if it keeps a reasonable amount of the text; a very early space
  // ("Supercalifragilistic x") would otherwise leave a one-word title.
  const base = lastSpace > MAX_LENGTH * 0.6 ? clipped.slice(0, lastSpace) : clipped;
  return `${base.replace(/[\s.,;:!?-]+$/, "")}…`;
}
