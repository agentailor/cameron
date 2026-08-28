"use client";
import { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThreadProvider } from "@/contexts/ThreadContext";
import { UISettingsProvider } from "@/contexts/UISettingsContext";
import { OAuthToast } from "@/components/OAuthToast";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <UISettingsProvider>
        <ThreadProvider>
          <Suspense fallback={null}>
            <OAuthToast />
          </Suspense>
          {children}
        </ThreadProvider>
      </UISettingsProvider>
    </QueryClientProvider>
  );
}
