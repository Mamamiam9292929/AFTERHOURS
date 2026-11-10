import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconBell, IconBellOff } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { PanelCard } from "@/components/ui/PanelCard";
import { useToast } from "@/components/ui/Toast";
import { StatusPill } from "@/features/plans/PlanPanel";
import { loadTexts, t } from "@/i18n";
import { cn } from "@/lib/cn";
import { activeCrewMuteMode, CREW_MUTE_MODES, crewMuteState, type CrewMuteMode, type CrewMuteState } from "@/lib/crewmute";
import { useNow } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { formatDateTime, formatTime } from "@/lib/time";

// F7: Texte laden erst mit den Einstellungen der Crew.
await loadTexts("crewMute");

const muteKey = (crewId: string, userId: string) => ["crew-mute", crewId, userId] as const;

/** Die eigene Zeile (RLS: nur die eigene) – keine Zeile heißt laut. */
function useCrewMute(crewId: string, userId: string) {
  return useQuery({
    queryKey: muteKey(crewId, userId),
    queryFn: async (): Promise<{ muted_until: string | null } | null> => {
      const { data, error } = await supabase.from("crew_push_mutes").select("muted_until").eq("crew_id", crewId).eq("user_id", userId).maybeSingle();
      if (error) throw error;
      return data as { muted_until: string | null } | null;
    },
  });
}

function statusLabel(state: CrewMuteState): string {
  const tx = t.crewMute.status;
  if (state.kind === "on") return tx.on;
  if (state.kind === "always") return tx.always;
  return tx.until(state.sameDay ? formatTime(state.until) : formatDateTime(state.until));
}

/**
 * P35 · „Mitteilungen dieser Crew“ in den Einstellungen der Crew: die Crew für 8 Stunden, eine Woche oder bis auf
 * Weiteres stummschalten (`set_crew_push_mute`). Stumm ist nur der Push; in der App kommt alles weiter an.
 * Niemand sonst sieht die Einstellung. Lade-, Fehler- und Speicherzustand.
 */
export function CrewMute({ crewId, userId }: { crewId: string; userId: string }) {
  const tx = t.crewMute;
  const toast = useToast();
  const client = useQueryClient();
  const now = useNow(60_000);
  const mute = useCrewMute(crewId, userId);
  const save = useMutation({
    mutationFn: async (mode: CrewMuteMode | "off") => {
      const { data, error } = await supabase.rpc("set_crew_push_mute", { p_crew_id: crewId, p_mode: mode });
      if (error) throw error;
      return data as { muted: boolean; until: string | null };
    },
    onSuccess: (data, mode) => {
      client.setQueryData(muteKey(crewId, userId), data.muted ? { muted_until: data.until } : null);
      toast.success(tx.saved[mode]);
    },
    onError: (error) => toast.error(error),
  });

  const state = crewMuteState(mute.data, now);
  const active = activeCrewMuteMode(state, now);
  const muted = state.kind !== "on";

  return (
    <PanelCard
      id="mitteilungen"
      title={tx.title}
      icon={muted ? <IconBellOff /> : <IconBell />}
      tone={muted ? "amber" : "violet"}
      testId="crew-mute"
      status={mute.isSuccess ? <StatusPill tone={muted ? "amber" : "glass"} testId="crew-mute-status">{statusLabel(state)}</StatusPill> : undefined}
      lead={tx.lead}
    >
      {mute.isPending ? (
        <Skeleton className="h-10 w-full max-w-sm rounded-full" />
      ) : mute.isError ? (
        <ErrorState title={tx.error} error={mute.error} onRetry={() => void mute.refetch()} />
      ) : (
        <>
          <p id="crew-mute-choose" className="text-[13px] font-semibold text-muted">{tx.choose}</p>
          <div role="group" aria-labelledby="crew-mute-choose" className="mt-2 flex flex-wrap gap-2">
            {CREW_MUTE_MODES.map((mode) => {
              const on = active === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={on}
                  data-mode={mode}
                  disabled={save.isPending}
                  onClick={() => save.mutate(mode)}
                  className={cn(
                    "inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors disabled:opacity-60",
                    on ? "border-amber/60 bg-amber/15 text-fg" : "border-white/15 bg-white/[0.04] text-muted hover:border-white/30 hover:text-fg",
                  )}
                >
                  <span aria-hidden className={cn("size-2 rounded-full", on ? "bg-amber" : "bg-white/25")} />
                  {tx.modes[mode]}
                </button>
              );
            })}
          </div>
          {muted && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              loading={save.isPending && save.variables === "off"}
              disabled={save.isPending}
              icon={<IconBell className="size-4" aria-hidden />}
              onClick={() => save.mutate("off")}
            >
              {tx.unmute}
            </Button>
          )}
          <p className="mt-3 text-[13px] leading-snug text-faint">{tx.hint}</p>
        </>
      )}
    </PanelCard>
  );
}
