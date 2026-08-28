"use client";
import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";

/**
 * SQL the agent wrote, highlighted. Rendered as a dark inset — machinery is dark, the page is
 * paper — with the terminal chrome bar the rest of the app uses for tool internals.
 *
 * Shiki loads its grammar lazily, so the raw query paints first and is replaced on load.
 */
export const SqlBlock = ({ sql, subtitle }: { sql: string; subtitle?: string }) => {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    codeToHtml(sql, { lang: "sql", theme: "github-dark-default" })
      .then((out) => {
        if (alive) setHtml(out);
      })
      .catch(() => {
        /* keep the plain-text fallback */
      });
    return () => {
      alive = false;
    };
  }, [sql]);

  return (
    <div className="border-inset-border overflow-hidden rounded-lg border">
      <div className="bg-inset-chrome border-inset-border flex items-center gap-2 border-b px-3 py-2">
        <span aria-hidden className="flex items-center gap-1.5">
          <span className="bg-term-red block h-2.5 w-2.5 rounded-full" />
          <span className="bg-term-yellow block h-2.5 w-2.5 rounded-full" />
          <span className="bg-term-green block h-2.5 w-2.5 rounded-full" />
        </span>
        <span className="text-inset-muted ml-1 font-mono text-[10.5px]">
          {subtitle ?? "postgres · read-only txn"}
        </span>
      </div>

      {html ? (
        <div
          className="bg-inset [&_pre]:m-0 [&_pre]:overflow-x-auto [&_pre]:!bg-transparent [&_pre]:px-4 [&_pre]:py-3 [&_pre]:font-mono [&_pre]:text-[12.5px] [&_pre]:leading-relaxed"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="bg-inset text-inset-foreground m-0 overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed">
          {sql}
        </pre>
      )}
    </div>
  );
};
