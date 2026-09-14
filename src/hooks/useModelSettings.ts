import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchAgentConfig,
  saveModelSettings,
  type ModelSettingsInput,
} from "@/services/chatService";

const QUERY_KEY = ["model-settings"];

export function useModelSettings() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchAgentConfig,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  const mutation = useMutation({
    mutationFn: (input: ModelSettingsInput) => saveModelSettings(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  return {
    settings: query.data,
    isLoading: query.isLoading,
    save: mutation.mutateAsync,
    isSaving: mutation.isPending,
    saveError: mutation.error instanceof Error ? mutation.error.message : null,
  };
}
