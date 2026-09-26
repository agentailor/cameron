import { BackToChat } from "@/components/BackToChat";
import { ConnectionsView } from "@/components/connections/ConnectionsView";

export const metadata = { title: "Connections · Cameron AI" };

export default function ConnectionsPage() {
  return (
    <div className="bg-muted/40 h-screen overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <BackToChat />

        <h1 className="text-foreground text-2xl font-semibold">Connections</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Connect MCP servers to give Cameron more tools. Their tools run without asking — the
          approval gate covers Cameron&apos;s built-in tools that write to your ledger — so only
          connect servers you trust. Changes apply from Cameron&apos;s next message.
        </p>

        <ConnectionsView />
      </div>
    </div>
  );
}
