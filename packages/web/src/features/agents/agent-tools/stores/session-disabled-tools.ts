import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// Temporary, session-scoped tool suppression. Nothing here is saved to the agent: the disabled
// names ride along on the next chat message and apply to that run only. Closing the browser tab
// clears them (sessionStorage), so a high-risk action can be switched off for a conversation
// without editing the published agent.
type SessionToolState = {
  // agentId -> disabled toolName set (stored as array for JSON persistence)
  disabledByAgent: Record<string, string[]>;
  isDisabled: (agentId: string, toolName: string) => boolean;
  disabledNames: (agentId: string) => string[];
  toggle: (agentId: string, toolName: string, disabled: boolean) => void;
  setMany: (agentId: string, names: string[]) => void;
  reset: (agentId: string) => void;
};

const normalize = (names: string[]): string[] => [...new Set(names)].sort();

export const useSessionToolStore = create<SessionToolState>()(
  persist(
    (set, get) => ({
      disabledByAgent: {},
      isDisabled: (agentId, toolName) =>
        get().disabledByAgent[agentId]?.includes(toolName) ?? false,
      disabledNames: (agentId) => get().disabledByAgent[agentId] ?? [],
      toggle: (agentId, toolName, disabled) => {
        const current = get().disabledByAgent[agentId] ?? [];
        const next = disabled
          ? normalize([...current, toolName])
          : current.filter((name) => name !== toolName);
        set({
          disabledByAgent: { ...get().disabledByAgent, [agentId]: next },
        });
      },
      setMany: (agentId, names) =>
        set({
          disabledByAgent: {
            ...get().disabledByAgent,
            [agentId]: normalize(names),
          },
        }),
      reset: (agentId) =>
        set({
          disabledByAgent: { ...get().disabledByAgent, [agentId]: [] },
        }),
    }),
    {
      name: 'agent-session-disabled-tools',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
