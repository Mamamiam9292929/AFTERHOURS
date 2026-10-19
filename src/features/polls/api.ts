import { FunctionsHttpError } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthProvider";
import { qk } from "@/lib/query";
import { useRealtime } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import type { PollKind, PollVote, VoteResponse } from "@/lib/types";
import type { PollWeather } from "@/lib/weather";
import type { PollWithDetails } from "./logic";

// Der FK-Hinweis ist nötig, weil polls und poll_options doppelt verbunden sind (poll_id und winning_option_id).
// W3: Gäste nur mit Name und Zeitpunkt – den Hash ihres Geheimnisses gibt die Datenbank ohnehin nicht heraus.
const POLL_SELECT =
  "*, options:poll_options!poll_options_poll_id_fkey(*), votes:poll_votes(*), guests:poll_guests(id, display_name, created_at), guest_votes:poll_guest_votes(*)";

/**
 * Stellt für Abstimmungen, deren Frist abgelaufen ist, das Ergebnis fest. Jedes Mitglied darf das
 * auslösen; die Datenbank prüft die Frist selbst. Ohne pg_cron ist das der Weg, auf dem
 * Abstimmungen "automatisch" enden.
 */
async function finalizeDue(polls: PollWithDetails[]): Promise<boolean> {
  const due = polls.filter((p) => p.status === "open" && new Date(p.ends_at) <= new Date());
  if (due.length === 0) return false;
  const results = await Promise.all(due.map((p) => supabase.rpc("finalize_due_poll", { p_poll_id: p.id })));
  return results.some((r) => r.data === true);
}

export function usePolls() {
  return useQuery({
    queryKey: qk.polls,
    queryFn: async (): Promise<PollWithDetails[]> => {
      const load = async () => {
        const { data, error } = await supabase.from("polls").select(POLL_SELECT).order("created_at", { ascending: false }).limit(100);
        if (error) throw error;
        return data as unknown as PollWithDetails[];
      };
      const polls = await load();
      return (await finalizeDue(polls)) ? load() : polls;
    },
  });
}

export function usePoll(pollId: string | undefined) {
  const client = useQueryClient();
  useRealtime(
    pollId ? `poll:${pollId}` : null,
    [
      { table: "poll_votes", filter: `poll_id=eq.${pollId}` },
      { table: "poll_guest_votes", filter: `poll_id=eq.${pollId}` },
      { table: "polls", filter: `id=eq.${pollId}` },
    ],
    () => void client.invalidateQueries({ queryKey: qk.poll(pollId ?? "none") }),
  );
  return useQuery({
    queryKey: qk.poll(pollId ?? "none"),
    enabled: Boolean(pollId),
    // Ersatz, falls Realtime nicht verbunden ist: laufende Abstimmungen alle 8 Sekunden nachladen.
    refetchInterval: (query) => (query.state.data && query.state.data.status === "open" ? 8_000 : false),
    queryFn: async (): Promise<PollWithDetails | null> => {
      const load = async () => {
        const { data, error } = await supabase.from("polls").select(POLL_SELECT).eq("id", pollId ?? "").maybeSingle();
        if (error) throw error;
        return (data as unknown as PollWithDetails | null) ?? null;
      };
      const poll = await load();
      if (poll && (await finalizeDue([poll]))) {
        void client.invalidateQueries({ queryKey: qk.polls, exact: true });
        return load();
      }
      return poll;
    },
  });
}

export interface PollOptionInput {
  activity_id?: string | null;
  title?: string | null;
  proposed_date?: string | null;
  proposed_time?: string | null;
  estimated_price_cents?: number | null;
}

export interface CreatePollInput {
  crewId: string;
  title: string;
  endsAt: Date;
  options: PollOptionInput[];
  description?: string | null;
  meetingPoint?: string | null;
  budgetCents?: number | null;
  minParticipants?: number | null;
}

/** P1: Termin-Abstimmung – Titel der Optionen setzt der Server („Freitag, 17. Oktober“). */
export interface CreateDatePollInput {
  crewId: string;
  title: string;
  endsAt: Date;
  slots: { date: string; time: string | null }[];
  description?: string | null;
}

export function useCreateDatePoll() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateDatePollInput): Promise<string> => {
      const { data, error } = await supabase.rpc("create_date_poll", {
        p_crew_id: input.crewId,
        p_title: input.title,
        p_ends_at: input.endsAt.toISOString(),
        p_slots: input.slots,
        p_description: input.description ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.polls }),
  });
}

/**
 * P1 Etappe 3a: „Und wo?“ – Orts-Abstimmung zu einer entschiedenen Termin-Abstimmung. Crew und Termin
 * kommen vom Server aus der Termin-Abstimmung; Datum und Uhrzeit der Optionen werden dort überschrieben.
 */
export function useCreateWherePoll() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<CreatePollInput, "crewId"> & { datePollId: string }): Promise<string> => {
      const { data, error } = await supabase.rpc("create_where_poll", {
        p_date_poll_id: input.datePollId,
        p_title: input.title,
        p_ends_at: input.endsAt.toISOString(),
        p_options: input.options,
        p_description: input.description ?? null,
        p_meeting_point: input.meetingPoint ?? null,
        p_budget_cents: input.budgetCents ?? null,
        p_min_participants: input.minParticipants ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.polls }),
  });
}

export function useCreatePoll() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePollInput): Promise<string> => {
      const { data, error } = await supabase.rpc("create_poll", {
        p_crew_id: input.crewId,
        p_title: input.title,
        p_ends_at: input.endsAt.toISOString(),
        p_options: input.options,
        p_description: input.description ?? null,
        p_meeting_point: input.meetingPoint ?? null,
        p_budget_cents: input.budgetCents ?? null,
        p_min_participants: input.minParticipants ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.polls }),
  });
}

/** Stimme setzen, ändern oder (response = null) zurückziehen – mit sofortiger Anzeige. */
export function useVote(pollId: string) {
  const client = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { optionId: string; response: VoteResponse | null }) => {
      const { error } = input.response
        ? await supabase.rpc("cast_vote", { p_option_id: input.optionId, p_response: input.response })
        : await supabase.rpc("retract_vote", { p_option_id: input.optionId });
      if (error) throw error;
    },
    onMutate: async ({ optionId, response }) => {
      await client.cancelQueries({ queryKey: qk.poll(pollId) });
      const previous = client.getQueryData<PollWithDetails | null>(qk.poll(pollId));
      if (previous && user) {
        const others = previous.votes.filter((v) => !(v.poll_option_id === optionId && v.user_id === user.id));
        const mine: PollVote[] = response
          ? [{ id: `optimistic-${optionId}`, poll_id: pollId, poll_option_id: optionId, user_id: user.id, response, updated_at: new Date().toISOString() }]
          : [];
        client.setQueryData<PollWithDetails | null>(qk.poll(pollId), (old) => (old ? { ...old, votes: [...others, ...mine] } : old));
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous !== undefined) client.setQueryData(qk.poll(pollId), context.previous);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.poll(pollId) });
      void client.invalidateQueries({ queryKey: qk.polls, exact: true });
      // S5: Eine Stimme kann die Abstimmung entscheiden und einen Plan anlegen.
      void client.invalidateQueries({ queryKey: qk.plans });
    },
  });
}

function usePollAction<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.polls }),
  });
}

/** W3: Gäste ohne Konto per Teilen-Link mitstimmen lassen (Ersteller:in, Owner/Admin). */
export function useSetPollGuests(pollId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (allowed: boolean) => {
      const { error } = await supabase.rpc("set_poll_guests", { p_poll_id: pollId, p_allowed: allowed });
      if (error) throw error;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.poll(pollId) });
      void client.invalidateQueries({ queryKey: qk.polls, exact: true });
    },
  });
}

/** S5: Abstimmung entscheidet sich selbst (Ersteller:in, Owner/Admin). Ergebnis true = sofort entschieden. */
export function useSetPollAutoDecide(pollId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean): Promise<boolean> => {
      const { data, error } = await supabase.rpc("set_poll_auto_decide", { p_poll_id: pollId, p_enabled: enabled });
      if (error) throw error;
      return data === true;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.poll(pollId) });
      void client.invalidateQueries({ queryKey: qk.polls, exact: true });
      void client.invalidateQueries({ queryKey: qk.plans });
    },
  });
}

/** W3 Etappe 3: Gäste, die abgestimmt haben, dürfen der Crew beitreten (nur Owner/Admin). */
export function useSetPollGuestJoin(pollId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (allowed: boolean) => {
      const { error } = await supabase.rpc("set_poll_guest_join", { p_poll_id: pollId, p_allowed: allowed });
      if (error) throw error;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.poll(pollId) });
      void client.invalidateQueries({ queryKey: qk.polls, exact: true });
    },
  });
}

export function useRemovePollGuest(pollId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (guestId: string) => {
      const { error } = await supabase.rpc("remove_poll_guest", { p_guest_id: guestId });
      if (error) throw error;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.poll(pollId) });
      void client.invalidateQueries({ queryKey: qk.polls, exact: true });
    },
  });
}

export function useClosePoll() {
  return usePollAction(async (pollId: string) => {
    const { error } = await supabase.rpc("close_poll", { p_poll_id: pollId });
    if (error) throw error;
  });
}

export function useRemindPoll() {
  return usePollAction(async (pollId: string): Promise<number> => {
    const { data, error } = await supabase.rpc("remind_poll", { p_poll_id: pollId });
    if (error) throw error;
    return data as number;
  });
}

export function useStartRunoff() {
  return usePollAction(async (input: { pollId: string; title: string; endsAt: Date }): Promise<string> => {
    const { data, error } = await supabase.rpc("start_runoff_poll", { p_poll_id: input.pollId, p_title: input.title, p_ends_at: input.endsAt.toISOString() });
    if (error) throw error;
    return data as string;
  });
}

/*
 * W2 Etappe 2 · Teilen-Karte: Eine Abstimmung bekommt beim ersten Teilen einen eigenen Link /v/<token>.
 * Messenger zeigen dazu eine Vorschau, Freunde ohne Konto eine Karte in der App, Mitglieder landen bei
 * der Abstimmung. Der Token wird beim Öffnen der Abstimmung geholt, damit das Teilen-Menü sofort aufgeht.
 */
export function usePollShareToken(pollId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["poll-share-token", pollId ?? "none"] as const,
    enabled: Boolean(pollId) && enabled,
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc("poll_share_token", { p_poll_id: pollId });
      if (error) throw error;
      return data as string;
    },
  });
}

export type SharedPollPreview =
  | {
      status: "valid";
      poll: {
        title: string;
        ends_at: string;
        status: "open" | "closed";
        option_count: number;
        voter_count: number;
        guests?: boolean;
        /** P1 Etappe 2: Art; bei Termin-Abstimmungen zusätzlich die Termine (Datum, Uhrzeit oder null). */
        kind?: PollKind;
        dates?: { date: string; time: string | null }[];
      };
      /** Nur für Mitglieder der Crew – sonst null. */
      poll_id: string | null;
    }
  | { status: "not_found" | "expired" };

/** `viewer`: angemeldete Person oder null – die Antwort hängt davon ab (ID nur für Mitglieder). */
export function useSharedPollPreview(token: string | undefined, viewer: string | null, enabled = true) {
  return useQuery({
    queryKey: ["poll-share-preview", token ?? "none", viewer ?? "anon"] as const,
    enabled: Boolean(token) && enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<SharedPollPreview> => {
      const { data, error } = await supabase.rpc("preview_shared_poll", { p_token: token ?? "" });
      if (error) throw error;
      return data as SharedPollPreview;
    },
  });
}

/*
 * W3 Etappe 1 · Mitstimmen ohne Konto. Ein Gast ist ein zufälliges Geheimnis (64 Hex-Zeichen), das nur auf
 * diesem Gerät liegt – je Teilen-Link eins. Die Datenbank speichert davon nur den Hash.
 */
const guestKey = (token: string) => `afterhours.guest.${token}`;

export function guestSecret(token: string): string {
  try {
    const stored = localStorage.getItem(guestKey(token));
    if (stored && /^[0-9a-f]{64}$/.test(stored)) return stored;
  } catch {
    // Privates Fenster o. Ä.: Geheimnis gilt dann nur für diesen Besuch.
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    localStorage.setItem(guestKey(token), secret);
  } catch {
    // siehe oben
  }
  return secret;
}

export interface BallotOption {
  key: number;
  title: string;
  proposed_date: string | null;
  proposed_time: string | null;
  yes: number;
  maybe: number;
  no: number;
}

export type SharedPollBallot =
  | {
      status: "valid";
      poll: { title: string; ends_at: string; open: boolean; can_join?: boolean; kind?: PollKind };
      options: BallotOption[];
      me: { name: string; votes: Record<string, VoteResponse> } | null;
    }
  | { status: "not_found" | "expired" | "guests_off" };

export function useSharedPollBallot(token: string | undefined, secret: string | null, enabled = true) {
  return useQuery({
    queryKey: ["poll-guest-ballot", token ?? "none"] as const,
    enabled: Boolean(token && secret) && enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<SharedPollBallot> => {
      const { data, error } = await supabase.rpc("shared_poll_ballot", { p_token: token ?? "", p_secret: secret });
      if (error) throw error;
      return data as SharedPollBallot;
    },
  });
}

export function useGuestVote(token: string, secret: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; votes: Record<string, VoteResponse | null> }) => {
      const { error } = await supabase.rpc("guest_vote_shared_poll", { p_token: token, p_secret: secret, p_name: input.name, p_votes: input.votes });
      if (error) throw error;
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["poll-guest-ballot", token] });
      void client.invalidateQueries({ queryKey: ["poll-share-preview", token] });
    },
  });
}

/**
 * W3 Etappe 3 · Persönlichen Einladungslink holen (einmal gültig, 7 Tage). Nur für Gäste, die mit
 * diesem Gerät schon abgestimmt haben; der Link führt auf die normale Einladung (/invite/<token>).
 */
export function useGuestJoin(token: string, secret: string | null) {
  return useMutation({
    mutationFn: async (): Promise<{ token: string; expires_at: string }> => {
      const { data, error } = await supabase.rpc("guest_join_shared_poll", { p_token: token, p_secret: secret });
      if (error) throw error;
      return data as { token: string; expires_at: string };
    },
  });
}

/*
 * W3 Etappe 2 · Gast-Stimmen ins eigene Konto übernehmen. Wer als Gast abgestimmt hat und jetzt Mitglied
 * der Crew ist, hat das Geheimnis noch auf diesem Gerät. Nur lesen – hier wird nie ein neues erzeugt.
 */
export function storedGuestSecret(token: string): string | null {
  try {
    const stored = localStorage.getItem(guestKey(token));
    return stored && /^[0-9a-f]{64}$/.test(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function forgetGuestSecret(token: string) {
  try {
    localStorage.removeItem(guestKey(token));
  } catch {
    // nichts zu tun
  }
}

export type GuestClaimPreview = { status: "none" } | { status: "found"; name: string; votes: number; conflicts: number };

export function useGuestClaimPreview(pollId: string, secret: string | null) {
  return useQuery({
    queryKey: ["poll-guest-claim", pollId, secret ? "secret" : "none"] as const,
    enabled: Boolean(secret),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<GuestClaimPreview> => {
      const { data, error } = await supabase.rpc("poll_guest_claim_preview", { p_poll_id: pollId, p_secret: secret });
      if (error) throw error;
      return data as GuestClaimPreview;
    },
  });
}

/** `keep`: true übernimmt die Antworten, false löscht die Gast-Stimme. */
export function useClaimGuest(pollId: string, token: string, secret: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (keep: boolean): Promise<{ claimed: number; kept: number }> => {
      const { data, error } = await supabase.rpc("claim_poll_guest", { p_poll_id: pollId, p_secret: secret, p_keep: keep });
      if (error) throw error;
      return data as { claimed: number; kept: number };
    },
    onSuccess: () => forgetGuestSecret(token),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["poll-guest-claim", pollId] });
      void client.invalidateQueries({ queryKey: qk.poll(pollId) });
      void client.invalidateQueries({ queryKey: qk.polls, exact: true });
    },
  });
}

/**
 * P5 Etappe 2: Wetter je Vorschlag einer laufenden Abstimmung über die Edge Function `weather`
 * (`poll_id`). Neue Vorschläge, Orte oder Termine sind eine neue Abfrage; Stimmen nicht – deshalb
 * hängt der Schlüssel nur an Ort und Termin der Vorschläge, nicht an der Abstimmung selbst.
 */
export function usePollWeather(poll: Pick<PollWithDetails, "id" | "options"> | null | undefined, enabled = true) {
  const signature = (poll?.options ?? [])
    .map((o) => `${o.id}:${o.activity_id ?? ""}:${o.proposed_date ?? ""}:${o.proposed_time ?? ""}`)
    .sort()
    .join("|");
  return useQuery({
    queryKey: ["poll-weather", poll?.id ?? "none", signature] as const,
    enabled: Boolean(poll?.id) && enabled,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<PollWeather> => {
      const { data, error } = await supabase.functions.invoke<PollWeather>("weather", { body: { poll_id: poll?.id } });
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const response = error.context as Response;
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw Object.assign(new Error(body?.error ?? "weather_unavailable"), { code: body?.error ? "P0001" : undefined, status: response.status });
        }
        throw error;
      }
      if (!data) throw new Error("weather_unavailable");
      return data;
    },
  });
}
