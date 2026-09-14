import { BackToChat } from "@/components/BackToChat";
import { ModelSettingsForm } from "@/components/settings/ModelSettingsForm";

export const metadata = { title: "Settings · Cameron AI" };

export default function SettingsPage() {
  return (
    <div className="bg-muted/40 h-screen overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <BackToChat />

        <h1 className="text-foreground text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Cameron runs on the model you choose. Nothing is assumed — pick a provider and a model
          here, and keep the API key in your own environment.
        </p>

        <section className="mt-10">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Model
          </h2>
          <div className="border-border mt-3 rounded-lg border bg-white p-4">
            <ModelSettingsForm />
          </div>
        </section>
      </div>
    </div>
  );
}
