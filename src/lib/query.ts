import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Berechtigungs- und Eingabefehler werden durch Wiederholen nicht besser.
        const code = (error as { code?: string } | null)?.code;
        if (code && /^(42501|P0001|PGRST\d+|23\d{3}|22\w{3})$/.test(code)) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

/** Zentrale Query-Keys – Invalidierungen greifen damit immer denselben Baum. */
export const qk = {
  profile: (userId: string) => ["profile", userId] as const,
  settings: (userId: string) => ["settings", userId] as const,
  people: ["people"] as const,
  isAdmin: (userId: string) => ["is-admin", userId] as const,
  crews: ["crews"] as const,
  crew: (crewId: string) => ["crews", crewId] as const,
  crewInvitations: (crewId: string) => ["crews", crewId, "invitations"] as const,
  crewMessages: (crewId: string) => ["crews", crewId, "messages"] as const,
  /** P3 Etappe 3: offene Beträge je Plan; Präfix `crewBalancesAll` invalidiert alle Crews. */
  crewBalancesAll: ["crew-balances"] as const,
  crewBalances: (crewId: string) => ["crew-balances", crewId] as const,
  invitationPreview: (token: string) => ["invitation", token] as const,
  activities: ["activities"] as const,
  activity: (id: string) => ["activities", id] as const,
  activitySearch: (city: string, category: string | null, query: string, limit: number) => ["activities", "search", city.toLocaleLowerCase("de"), category, query, limit] as const,
  placeRegion: (city: string) => ["place-region", city.toLocaleLowerCase("de")] as const,
  polls: ["polls"] as const,
  poll: (pollId: string) => ["polls", pollId] as const,
  plans: ["plans"] as const,
  plan: (planId: string) => ["plans", planId] as const,
  planBookings: (planId: string) => ["plans", planId, "bookings"] as const,
  planRides: (planId: string) => ["plans", planId, "rides"] as const,
  planExpenses: (planId: string) => ["plans", planId, "expenses"] as const,
  notifications: ["notifications"] as const,
  rewards: ["rewards"] as const,
  admin: ["admin"] as const,
};
