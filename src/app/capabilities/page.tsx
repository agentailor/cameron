import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { listCapabilities } from "@/lib/agent/capabilities";

export const metadata = { title: "Capabilities · Cameron AI" };

export default function CapabilitiesPage() {
  const capabilities = listCapabilities();
  const groups = [...new Set(capabilities.map((c) => c.group))];

  return (
    <div className="h-screen overflow-y-auto bg-gray-50">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-gray-800"
        >
          <ArrowLeft size={16} />
          Back to chat
        </Link>

        <h1 className="text-2xl font-semibold text-gray-900">What Cameron can do</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          These are Cameron&apos;s built-in tools. Anything that changes your ledger stops and asks
          you first — Cameron never writes without your approval. MCP servers you connect add
          further tools, which aren&apos;t listed here.
        </p>

        {groups.map((group) => (
          <section key={group} className="mt-10">
            <h2 className="text-xs font-semibold tracking-wide text-gray-500 uppercase">{group}</h2>
            <ul className="mt-3 space-y-3">
              {capabilities
                .filter((c) => c.group === group)
                .map((c) => (
                  <li key={c.name} className="rounded-lg border border-gray-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-mono text-sm font-medium text-gray-900">{c.name}</code>
                      {c.mutating ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          <ShieldCheck size={12} />
                          Needs approval
                        </span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          Read-only
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-gray-600">{c.description}</p>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
