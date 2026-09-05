"use client";
import { MainLayout } from "@/components/MainLayout";
import { Thread } from "@/components/Thread";

export default function Home() {
  return (
    <MainLayout>
      <Thread threadId={null} />
    </MainLayout>
  );
}
