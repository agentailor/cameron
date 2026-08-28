import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { listCapabilities } from "@/lib/agent/capabilities";

export const metadata = { title: "Capabilities · Cameron AI" };

export default function CapabilitiesPage() {
  const capabilities = listCapabilities();
  const groups = [...new Set(capabilities.map((c) => c.group))];

  return (
    <div className="bg-muted/40 h-screen overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground mb-8 inline-flex items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeft size={16} />
          Back to chat
        </Link>

        <h1 className="text-foreground text-2xl font-semibold">What Cameron can do</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          These are Cameron&apos;s built-in tools. Anything that changes your ledger stops and asks
          you first — Cameron never writes without your approval. MCP servers you connect add
          further tools, which aren&apos;t listed here.
        </p>

        {groups.map((group) => (
          <section key={group} className="mt-10">
            <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {group}
            </h2>
            <ul className="mt-3 space-y-3">
              {capabilities
                .filter((c) => c.group === group)
                .map((c) => (
                  <li key={c.name} className="border-border rounded-lg border bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="text-foreground font-mono text-sm font-medium">
                        {c.name}
                      </code>
                      {c.mutating ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          <ShieldCheck size={12} />
                          Needs approval
                        </span>
                      ) : (
                        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
                          Read-only
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                      {c.description}
                    </p>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
