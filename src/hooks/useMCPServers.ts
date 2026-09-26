import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ServerInput } from "@/lib/mcp/configParse";
import {
  createServer,
  deleteServer,
  fetchServers,
  fetchServerTools,
  setServerEnabled,
  updateServer,
  type MCPServerView,
} from "@/services/mcpService";

const SERVERS_KEY = ["mcp-servers"];
const toolsKey = (id: string) => ["mcp-server-tools", id];

export function useMCPServers() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: SERVERS_KEY });
  // An edited server may expose different tools: reset, so an open list re-lists them.
  const resetTools = (id: string) => queryClient.resetQueries({ queryKey: toolsKey(id) });

  const query = useQuery({
    queryKey: SERVERS_KEY,
    queryFn: fetchServers,
    refetchOnWindowFocus: false,
  });

  const create = useMutation({
    mutationFn: (input: ServerInput) => createServer(input),
    onSuccess: refresh,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ServerInput }) => updateServer(id, input),
    onSuccess: (_, { id }) => {
      resetTools(id);
      return refresh();
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      setServerEnabled(id, enabled),
    onMutate: ({ id, enabled }) => {
      queryClient.setQueryData<MCPServerView[]>(SERVERS_KEY, (servers) =>
        servers?.map((s) => (s.id === id ? { ...s, enabled } : s)),
      );
    },
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteServer(id),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: toolsKey(id) });
      return refresh();
    },
  });

  return {
    servers: query.data,
    isLoading: query.isLoading,
    loadError: query.error instanceof Error ? query.error.message : null,
    create: create.mutateAsync,
    update: (id: string, input: ServerInput) => update.mutateAsync({ id, input }),
    setEnabled: (id: string, enabled: boolean) => toggle.mutate({ id, enabled }),
    remove: remove.mutateAsync,
    refresh,
  };
}

/** Connects to one server only once `enabled` (the list is opened), then keeps the result. */
export function useServerTools(id: string, enabled: boolean) {
  return useQuery({
    queryKey: toolsKey(id),
    queryFn: () => fetchServerTools(id),
    enabled,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
