"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

const STORAGE_KEY = "agent_model_settings";

function loadSettings(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSetting(key: string, value: string | boolean) {
  if (typeof window === "undefined") return;
  try {
    const current = loadSettings();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, [key]: value }));
  } catch {}
}

interface UISettingsContextType {
  hideToolMessages: boolean;
  toggleToolMessages: () => void;
  provider: string;
  setProvider: (provider: string) => void;
  model: string;
  setModel: (model: string) => void;
  approveAllTools: boolean;
  setApproveAllTools: (v: boolean) => void;
}

const UISettingsContext = createContext<UISettingsContextType | undefined>(undefined);

interface UISettingsProviderProps {
  children: ReactNode;
}

export const UISettingsProvider = ({ children }: UISettingsProviderProps) => {
  const [hideToolMessages, setHideToolMessages] = useState(false);
  // Defaults must match DEFAULT_MODEL_PROVIDER/NAME in lib/agent/util.ts — these are sent as
  // query params on every request, so they override the server's default.
  const [provider, setProviderState] = useState<string>("anthropic");
  const [model, setModelState] = useState<string>("claude-haiku-4-5");
  const [approveAllTools, setApproveAllToolsState] = useState<boolean>(false);

  useEffect(() => {
    const saved = loadSettings();
    if (typeof saved.provider === "string") setProviderState(saved.provider);
    if (typeof saved.model === "string") setModelState(saved.model);
    if (typeof saved.approveAllTools === "boolean") setApproveAllToolsState(saved.approveAllTools);
  }, []);

  const toggleToolMessages = () => setHideToolMessages((prev) => !prev);
  const setProvider = (v: string) => {
    setProviderState(v);
    saveSetting("provider", v);
  };
  const setModel = (v: string) => {
    setModelState(v);
    saveSetting("model", v);
  };
  const setApproveAllTools = (v: boolean) => {
    setApproveAllToolsState(v);
    saveSetting("approveAllTools", v);
  };

  return (
    <UISettingsContext.Provider
      value={{
        hideToolMessages,
        toggleToolMessages,
        provider,
        setProvider,
        model,
        setModel,
        approveAllTools,
        setApproveAllTools,
      }}
    >
      {children}
    </UISettingsContext.Provider>
  );
};

export const useUISettings = () => {
  const context = useContext(UISettingsContext);
  if (context === undefined) {
    throw new Error("useUISettings must be used within a UISettingsProvider");
  }
  return context;
};
