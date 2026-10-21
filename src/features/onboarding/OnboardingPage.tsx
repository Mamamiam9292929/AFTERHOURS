import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { IconShield } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { Chip, SwitchRow } from "@/components/ui/Controls";
import { ErrorState, Notice, PageSpinner } from "@/components/ui/Feedback";
import { FormMessage, TextField } from "@/components/ui/Field";
import { Logo } from "@/components/ui/Logo";
import { useToast } from "@/components/ui/Toast";
import { CITY_NAMES } from "@/data/cities";
import { CATEGORIES, INTERESTS } from "@/data/options";
import { useUser } from "@/features/auth/AuthProvider";
import { clearNext, consumeNext, peekNext } from "@/features/auth/next";
import { type InvitationPreview, useAcceptInvitation, useInvitationPreview } from "@/features/crews/api";
import { useProfile, useSettings, useUpdateProfile, useUpdateSettings } from "@/features/profile/api";
import { AvatarPicker } from "@/features/profile/AvatarPicker";
import { isGroupEnabled, NOTIFICATION_GROUPS, setGroup } from "@/features/profile/notificationGroups";
import { t } from "@/i18n";
import { errorMessage } from "@/lib/errors";
import { useDocumentTitle } from "@/lib/hooks";
import type { ActivityCategory, Interest, UserSettings } from "@/lib/types";

const STEPS = 3;
const INVITE_TARGET = /^\/join\/([0-9a-f]{64})$/;
type ValidInvite = Extract<InvitationPreview, { status: "valid" }>;
const toggle = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

export function OnboardingPage() {
  useDocumentTitle(null);
  const user = useUser();
  const profile = useProfile();
  const settings = useSettings();
  const updateProfile = useUpdateProfile();
  const updateSettings = useUpdateSettings();
  const toast = useToast();

  // W1 Etappe 2: Kommt jemand über einen gültigen Einladungslink, reicht ein Schritt – Profil speichern und
  // mit demselben Tipp der Crew beitreten. Die Einladung wird beim ersten gültigen Ergebnis festgehalten,
  // damit die Seite nicht umspringt, wenn die Vorschau nach dem Beitritt „already_member“ meldet.
  const [inviteToken] = useState(() => INVITE_TARGET.exec(peekNext() ?? "")?.[1]);
  const invitePreview = useInvitationPreview(inviteToken);
  const acceptInvite = useAcceptInvitation();
  const [invite, setInvite] = useState<ValidInvite | null>(null);
  if (!invite && invitePreview.data?.status === "valid") setInvite(invitePreview.data);

  const [step, setStep] = useState(1);
  const [initialized, setInitialized] = useState(false);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [city, setCity] = useState("");
  const [interests, setInterests] = useState<Interest[]>([]);
  const [categories, setCategories] = useState<ActivityCategory[]>([]);
  const [budget, setBudget] = useState<number | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<UserSettings["notification_preferences"]>({});
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Während und nach dem Speichern steuert diese Seite selbst, wohin es weitergeht (z. B. zur Einladung).
  const [finishing, setFinishing] = useState(false);
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (initialized || !profile.data || !settings.data) return;
    setName(profile.data.display_name === "Neues Mitglied" ? "" : profile.data.display_name);
    setAvatar(profile.data.avatar_url);
    setCity(profile.data.city ?? "");
    setInterests(profile.data.interests);
    setCategories(profile.data.favorite_categories);
    setBudget(settings.data.typical_budget_cents);
    setDistance(settings.data.preferred_distance_km);
    setNotifications(settings.data.notification_preferences);
    setInitialized(true);
  }, [initialized, profile.data, settings.data]);

  if (profile.isPending || settings.isPending || (inviteToken && invitePreview.isPending)) return <PageSpinner />;
  if (profile.isError) return <div className="mx-auto max-w-md p-6"><ErrorState error={profile.error} onRetry={() => void profile.refetch()} /></div>;
  if (settings.isError) return <div className="mx-auto max-w-md p-6"><ErrorState error={settings.error} onRetry={() => void settings.refetch()} /></div>;
  if (target) return <Navigate to={target} replace />;
  if (profile.data.onboarded_at && !finishing) return <Navigate to="/home" replace />;

  const saving = finishing || updateProfile.isPending || updateSettings.isPending;
  const steps = invite ? 1 : STEPS;

  function next() {
    if (step === 1 && name.trim().length < 2) {
      setNameError(t.validation.minLength(2));
      return;
    }
    setNameError(null);
    setStep((s) => Math.min(steps, s + 1));
    window.scrollTo({ top: 0 });
  }

  async function finish() {
    setFormError(null);
    setFinishing(true);
    try {
      await updateSettings.mutateAsync({ typical_budget_cents: budget, preferred_distance_km: distance, notification_preferences: notifications });
      await updateProfile.mutateAsync({
        display_name: name.trim(),
        avatar_url: avatar,
        city: city.trim() || null,
        interests,
        favorite_categories: categories,
        onboarded_at: new Date().toISOString(),
      });
      // W5: Wer nicht über einen Link kam, startet geführt – Crew, Freunde, erste Abstimmung.
      setTarget(consumeNext() ?? "/start");
    } catch (error) {
      setFinishing(false);
      setFormError(errorMessage(error));
    }
  }

  /** Eingeladene: nur das Profil speichern, dann – wenn gewünscht – ausdrücklich beitreten. */
  async function finishInvited(join: boolean) {
    if (!invite || !inviteToken) return;
    if (name.trim().length < 2) {
      setNameError(t.validation.minLength(2));
      return;
    }
    setNameError(null);
    setFormError(null);
    setFinishing(true);
    try {
      await updateProfile.mutateAsync({ display_name: name.trim(), avatar_url: avatar, city: city.trim() || null, onboarded_at: new Date().toISOString() });
    } catch (error) {
      setFinishing(false);
      setFormError(errorMessage(error));
      return;
    }
    clearNext();
    if (!join) {
      setTarget("/home");
      return;
    }
    try {
      const result = await acceptInvite.mutateAsync(inviteToken);
      if (result.status === "joined" || result.status === "already_member") {
        toast.success(t.crews.join.joined(invite.crew.name));
        setTarget(`/crews/${result.crew_id}`);
        return;
      }
    } catch {
      /* Netzwerk o. Ä.: Die Beitrittsseite bietet den Beitritt erneut an. */
    }
    setTarget(`/join/${inviteToken}`);
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 pb-10 pt-safe sm:px-8">
      <header className="flex items-center justify-between pt-6">
        <Logo compact />
        <span className="text-sm font-semibold text-muted" aria-live="polite">
          {invite ? t.onboarding.invite.step : t.onboarding.step(step, steps)}
        </span>
      </header>
      <div className={`mt-5 grid gap-1.5 ${invite ? "grid-cols-1" : "grid-cols-3"}`} aria-hidden>
        {Array.from({ length: steps }, (_, i) => (
          <span key={i} className={`h-1 rounded-full ${i < step ? "bg-lime" : "bg-raised"}`} />
        ))}
      </div>

      <main className="flex flex-1 flex-col pt-10">
        {step === 1 && (
          <section className="space-y-6">
            {invite ? (
              <>
                <div>
                  <h1 className="display chrome text-[29px] sm:text-[35px]">{t.onboarding.invite.title}</h1>
                  <p className="mt-3 text-[15px] text-muted">{t.onboarding.invite.body}</p>
                </div>
                <InvitePass invite={invite} />
              </>
            ) : (
              <div>
                <h1 className="display chrome text-[29px] sm:text-[35px]">{t.onboarding.profile.title}</h1>
                <p className="mt-3 text-[15px] text-muted">{t.onboarding.profile.body}</p>
              </div>
            )}
            <TextField label={t.onboarding.profile.name} name="display_name" value={name} onChange={(e) => {
                setName(e.target.value);
                if (nameError && e.target.value.trim().length >= 2) setNameError(null);
              }} maxLength={40} error={nameError} autoComplete="nickname" required />
            <AvatarPicker userId={user.id} name={name} value={avatar} onChange={setAvatar} />
            <div>
              <TextField label={t.onboarding.profile.city} name="city" value={city} onChange={(e) => setCity(e.target.value)} list="city-options" placeholder={t.onboarding.profile.cityPlaceholder} hint={t.onboarding.profile.cityHint} maxLength={80} autoComplete="address-level2" optional />
              <datalist id="city-options">
                {CITY_NAMES.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </div>
            {invite && (
              <>
                <p className="text-[14px] leading-snug text-muted">{t.onboarding.invite.later}</p>
                <Notice icon={<IconShield aria-hidden />}>{t.crews.join.whatHappens}</Notice>
              </>
            )}
          </section>
        )}

        {step === 2 && (
          <section className="space-y-7">
            <div>
              <h1 className="display chrome text-[29px] sm:text-[35px]">{t.onboarding.interests.title}</h1>
              <p className="mt-3 text-[15px] text-muted">{t.onboarding.interests.body}</p>
            </div>
            <fieldset>
              <legend className="mb-3 text-sm font-medium text-fg">{t.onboarding.interests.interests}</legend>
              <div className="flex flex-wrap gap-2">
                {INTERESTS.map((interest) => (
                  <Chip key={interest} selected={interests.includes(interest)} onToggle={() => setInterests((list) => toggle(list, interest))}>
                    {t.enums.interest[interest]}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-3 text-sm font-medium text-fg">{t.onboarding.interests.categories}</legend>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.filter((c) => c !== "other").map((category) => (
                  <Chip key={category} selected={categories.includes(category)} onToggle={() => setCategories((list) => toggle(list, category))}>
                    {t.enums.category[category]}
                  </Chip>
                ))}
              </div>
            </fieldset>
          </section>
        )}

        {step === 3 && (
          <section className="space-y-7">
            <div>
              <h1 className="display chrome text-[29px] sm:text-[35px]">{t.onboarding.prefs.title}</h1>
              <p className="mt-3 text-[15px] text-muted">{t.onboarding.prefs.body}</p>
            </div>
            <fieldset>
              <legend className="mb-3 text-sm font-medium text-fg">{t.onboarding.prefs.budget}</legend>
              <div className="flex flex-wrap gap-2">
                <Chip selected={budget === null} onToggle={() => setBudget(null)}>
                  {t.onboarding.prefs.budgetAny}
                </Chip>
                {[10, 20, 30, 50].map((euro) => (
                  <Chip key={euro} selected={budget === euro * 100} onToggle={() => setBudget(euro * 100)}>
                    {t.onboarding.prefs.budgetUpTo(euro)}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-3 text-sm font-medium text-fg">{t.onboarding.prefs.distance}</legend>
              <div className="flex flex-wrap gap-2">
                <Chip selected={distance === null} onToggle={() => setDistance(null)}>
                  {t.onboarding.prefs.distanceAny}
                </Chip>
                {[5, 10, 25].map((km) => (
                  <Chip key={km} selected={distance === km} onToggle={() => setDistance(km)}>
                    {t.onboarding.prefs.distanceUpTo(km)}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-fg">{t.onboarding.prefs.notifications}</legend>
              <div className="divide-y divide-line">
                {NOTIFICATION_GROUPS.filter((g) => ["polls", "reminders", "plans"].includes(g.key)).map((group) => (
                  <SwitchRow key={group.key} label={t.settings.notifications.groups[group.key].title} checked={isGroupEnabled(notifications, group.types)} onChange={(enabled) => setNotifications((p) => setGroup(p, group.types, enabled))} />
                ))}
              </div>
            </fieldset>
            <Notice icon={<IconShield aria-hidden />} title={t.onboarding.prefs.locationTitle}>
              {t.onboarding.prefs.locationBody}
            </Notice>
          </section>
        )}

        <div className="mt-auto space-y-3 pt-10">
          {formError && <FormMessage>{formError}</FormMessage>}
          {invite ? (
            <div className="flex flex-col gap-2.5">
              <Button size="lg" block onClick={() => void finishInvited(true)} loading={saving}>
                {t.onboarding.invite.join(invite.crew.name)}
              </Button>
              <Button variant="ghost" block onClick={() => void finishInvited(false)} disabled={saving}>
                {t.onboarding.invite.skip}
              </Button>
            </div>
          ) : (
            <div className="flex gap-3">
              {step > 1 && (
                <Button variant="secondary" size="lg" onClick={() => setStep((s) => s - 1)} disabled={saving}>
                  {t.actions.back}
                </Button>
              )}
              {step < STEPS ? (
                <Button size="lg" className="flex-1" onClick={next}>
                  {t.actions.next}
                </Button>
              ) : (
                <Button size="lg" className="flex-1" onClick={() => void finish()} loading={saving}>
                  {t.onboarding.finish}
                </Button>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/**
 * Die Einladung als kleine Karte über dem Profil (V2 Etappe 3f, wie auf der Einladungs-Landingpage):
 * Crew-Symbol in einer Lime-Kachel, wer einlädt, der Crew-Name in Chrom, wie viele schon dabei sind.
 */
function InvitePass({ invite }: { invite: ValidInvite }) {
  return (
    <section aria-label={t.onboarding.invite.label} className="vote-card flex items-center gap-4 overflow-hidden rounded-[28px] p-4 sm:p-5" data-testid="onboarding-invite">
      <span aria-hidden className="pointer-events-none absolute -right-12 -top-16 size-40 rounded-full bg-lime/15 blur-3xl" />
      <span aria-hidden className="relative grid size-16 shrink-0 place-items-center rounded-[20px] bg-lime text-[32px] leading-none">
        {invite.crew.emoji}
      </span>
      <div className="relative min-w-0">
        <p className="text-[13px] text-muted">{invite.invited_by ? t.crews.landing.invitedBy(invite.invited_by) : t.crews.landing.invitedAnonymous}</p>
        <p className="display chrome mt-1 break-words text-[22px] uppercase">{invite.crew.name}</p>
        <p className="mt-1 text-[14px] text-muted">{t.onboarding.invite.members(t.members(invite.crew.member_count))}</p>
      </div>
    </section>
  );
}
