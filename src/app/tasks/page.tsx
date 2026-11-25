import { BackToChat } from "@/components/BackToChat";
import { TasksView } from "@/components/tasks/TasksView";

export const metadata = { title: "Tasks · Cameron AI" };

export default function TasksPage() {
  return (
    <div className="bg-muted/40 h-screen overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <BackToChat />

        <h1 className="text-foreground text-2xl font-semibold">Scheduled tasks</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Work Cameron does on a schedule while you&apos;re away, each run in its own conversation.
          Tasks are off until you turn them on. Anything that would change your records waits here
          for your approval.
        </p>

        <TasksView />
      </div>
    </div>
  );
}
