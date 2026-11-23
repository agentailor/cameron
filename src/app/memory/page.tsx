import { BackToChat } from "@/components/BackToChat";
import { MemoryList } from "@/components/memory/MemoryList";

export const metadata = { title: "Memory · Cameron AI" };

export default function MemoryPage() {
  return (
    <div className="bg-muted/40 h-screen overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <BackToChat />

        <h1 className="text-foreground text-2xl font-semibold">What Cameron remembers</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Preferences you told Cameron to keep, or corrections you made. Cameron reads them in every
          conversation. Forget one here and it stops applying from your next message.
        </p>

        <MemoryList />
      </div>
    </div>
  );
}
