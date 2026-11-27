import { BackToChat } from "@/components/BackToChat";
import { CallbackUrl } from "@/components/connections/CallbackUrl";
import { ConnectionsView } from "@/components/connections/ConnectionsView";
import { oauthCallbackUrl } from "@/lib/config/app-url";

export const metadata = { title: "Connections · Cameron AI" };

// The callback URL is read from the environment at request time, not baked in at build.
export const dynamic = "force-dynamic";

function readCallbackUrl(): string | null {
  try {
    return oauthCallbackUrl();
  } catch {
    return null;
  }
}

export default function ConnectionsPage() {
  const callbackUrl = readCallbackUrl();
  return (
    <div className="bg-muted/40 h-screen overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <BackToChat />

        <h1 className="text-foreground text-2xl font-semibold">Connections</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Connect MCP servers to give Cameron more tools. Cameron asks before running any of them,
          but only connect servers you trust. Changes apply from Cameron&apos;s next message.
        </p>

        <div className="mt-4 space-y-1.5">
          <p className="text-muted-foreground text-xs">
            OAuth callback URL, for servers that need an OAuth client you create yourself:
          </p>
          <CallbackUrl url={callbackUrl} />
        </div>

        <ConnectionsView callbackUrl={callbackUrl} />
      </div>
    </div>
  );
}
