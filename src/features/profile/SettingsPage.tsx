import { useMutation } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { IconDownload, IconInfo, IconLogout } from "@/components/icons";
import { PageHeader } from "@/components/layout/Page";
import { Button } from "@/components/ui/Button";
import { Chip, SwitchRow } from "@/components/ui/Controls";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState, Notice, PageSpinner } from "@/components/ui/Feedback";
import { FormMessage, SelectField, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { CITY_NAMES } from "@/data/cities";
import { CATEGORIES, INTERESTS } from "@/data/options";
import { useAuth } from "@/features/auth/AuthProvider";
import { forgetNext } from "@/features/auth/next";
import { useCrews } from "@/features/crews/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { centsToInput, parseEuroInput } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { password as passwordRule, validate } from "@/lib/validation";
import type { ActivityCategory, Interest, LocationSharingMode, Profile, UserSettings } from "@/lib/types";
import { useProfile, useSettings, useUpdateProfile, useUpdateSettings } from "./api";
import { AvatarPicker } from "./AvatarPicker";
import { isGroupEnabled, NOTIFICATION_GROUPS, setGroup } from "./notificationGroups";

const toggle = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

function Card({ id, title, lead, children }: { id: string; title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 rounded-card border border-line bg-surface p-5 sm:p-6">
      <h2 id={`${id}-title`} className="display text-[28px] text-fg">
        {title}
      </h2>
      {lead && <p className="mt-2 text-sm leading-snug text-muted">{lead}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ProfileCard({ profile }: { profile: Profile }) {
  const toast = useToast();
  const update = useUpdateProfile();
  const [name, setName] = useState(profile.display_name);
  const [avatar, setAvatar] = useState(profile.avatar_url);
  const [city, setCity] = useState(profile.city ?? "");
  const [nameError, setNameError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) {
      setNameError(t.validation.minLength(2));
      return;
    }
    setNameError(null);
    update.mutate({ display_name: name.trim(), avatar_url: avatar, city: city.trim() || null }, { onSuccess: () => toast.success(t.settings.profile.saved) });
  }

  return (
    <Card id="profile" title={t.settings.profile.title}>
      <form onSubmit={submit} noValidate className="space-y-5">
        <AvatarPicker userId={profile.id} name={name} value={avatar} onChange={setAvatar} />
        <TextField label={t.onboarding.profile.name} name="display_name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} error={nameError} required />
        <div>
          <TextField label={t.onboarding.profile.city} name="city" value={city} onChange={(e) => setCity(e.target.value)} list="settings-city-options" hint={t.onboarding.profile.cityHint} maxLength={80} optional />
          <datalist id="settings-city-options">
            {CITY_NAMES.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </div>
        {update.isError && <FormMessage>{errorMessage(update.error)}</FormMessage>}
        <Button type="submit" loading={update.isPending}>
          {t.actions.saveChanges}
        </Button>
      </form>
    </Card>
  );
}

function PreferencesCard({ profile, settings }: { profile: Profile; settings: UserSettings }) {
  const toast = useToast();
  const updateProfile = useUpdateProfile();
  const updateSettings = useUpdateSettings();
  const [interests, setInterests] = useState<Interest[]>(profile.interests);
  const [categories, setCategories] = useState<ActivityCategory[]>(profile.favorite_categories);
  const [budget, setBudget] = useState(centsToInput(settings.typical_budget_cents));
  const [distance, setDistance] = useState(settings.preferred_distance_km ? String(settings.preferred_distance_km) : "");
  const [errors, setErrors] = useState<{ budget?: string | null; distance?: string | null }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const pending = updateProfile.isPending || updateSettings.isPending;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const budgetCents = parseEuroInput(budget);
    const km = distance.trim() === "" ? null : Number(distance);
    const next = {
      budget: budgetCents === undefined || (budgetCents != null && budgetCents > 100000) ? t.validation.amount : null,
      distance: km !== null && (!Number.isInteger(km) || km < 1 || km > 200) ? t.validation.number : null,
    };
    setErrors(next);
    setFormError(null);
    if (next.budget || next.distance) return;
    try {
      await updateProfile.mutateAsync({ interests, favorite_categories: categories });
      await updateSettings.mutateAsync({ typical_budget_cents: budgetCents ?? null, preferred_distance_km: km });
      toast.success(t.settings.preferences.saved);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  return (
    <Card id="preferences" title={t.settings.preferences.title}>
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-6">
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
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t.onboarding.prefs.budget} name="budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} error={errors.budget} trailing={<span className="pr-3 text-muted">€</span>} optional />
          <TextField label={t.onboarding.prefs.distance} name="distance" inputMode="numeric" value={distance} onChange={(e) => setDistance(e.target.value)} error={errors.distance} trailing={<span className="pr-3 text-muted">km</span>} optional />
        </div>
        {formError && <FormMessage>{formError}</FormMessage>}
        <Button type="submit" loading={pending}>
          {t.actions.saveChanges}
        </Button>
      </form>
    </Card>
  );
}

const LOCATION_MODES: LocationSharingMode[] = ["off", "during_activity", "selected_friends", "crew"];

function LocationCard({ settings }: { settings: UserSettings }) {
  const toast = useToast();
  const crews = useCrews();
  const update = useUpdateSettings();
  const [mode, setMode] = useState<LocationSharingMode>(settings.location_sharing_mode);
  const [crewId, setCrewId] = useState(settings.location_sharing_crew_id ?? "");
  const crewList = crews.data ?? [];

  useEffect(() => {
    if (mode === "crew" && !crewId && crewList[0]) setCrewId(crewList[0].id);
  }, [mode, crewId, crewList]);

  function submit(event: FormEvent) {
    event.preventDefault();
    update.mutate(
      { location_sharing_mode: mode, location_sharing_crew_id: mode === "crew" && crewId ? crewId : null },
      { onSuccess: () => toast.success(t.settings.location.saved) },
    );
  }

  return (
    <Card id="location" title={t.settings.location.title} lead={t.settings.location.lead}>
      <Notice tone="amber" icon={<IconInfo aria-hidden />} title={t.settings.location.notLive.title} className="mb-5">
        {t.settings.location.notLive.body}
      </Notice>
      <form onSubmit={submit} className="space-y-4">
        <fieldset className="space-y-2.5">
          <legend className="sr-only">{t.settings.location.title}</legend>
          {LOCATION_MODES.map((option) => (
            <label key={option} className={cn("flex cursor-pointer gap-3 rounded-control border p-3.5 transition-colors", mode === option ? "border-lime bg-lime/5" : "border-line hover:border-line-strong")}>
              <input type="radio" name="location_mode" value={option} checked={mode === option} onChange={() => setMode(option)} className="mt-0.5 size-5 shrink-0 accent-[var(--color-lime)]" />
              <span>
                <span className="block font-semibold text-fg">{t.enums.locationMode[option].title}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted">{t.enums.locationMode[option].body}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {mode === "crew" &&
          (crewList.length === 0 ? (
            <p className="text-sm text-muted">{t.settings.location.crewNone}</p>
          ) : (
            <SelectField label={t.settings.location.crew} value={crewId} onChange={(e) => setCrewId(e.target.value)}>
              {crewList.map((crew) => (
                <option key={crew.id} value={crew.id}>
                  {crew.emoji} {crew.name}
                </option>
              ))}
            </SelectField>
          ))}
        {mode === "selected_friends" && <p className="text-[13px] text-muted">{t.settings.location.selectedFriendsNote}</p>}
        <p className="text-[13px] leading-snug text-faint">{t.settings.location.whatIsShared}</p>
        {update.isError && <FormMessage>{errorMessage(update.error)}</FormMessage>}
        <Button type="submit" loading={update.isPending} disabled={mode === "crew" && crewList.length === 0}>
          {t.actions.saveChanges}
        </Button>
      </form>
    </Card>
  );
}

function NotificationsCard({ settings }: { settings: UserSettings }) {
  const toast = useToast();
  const update = useUpdateSettings();
  const [preferences, setPreferences] = useState(settings.notification_preferences);

  function change(types: (typeof NOTIFICATION_GROUPS)[number]["types"], enabled: boolean) {
    const next = setGroup(preferences, types, enabled);
    const previous = preferences;
    setPreferences(next);
    update.mutate({ notification_preferences: next }, { onSuccess: () => toast.success(t.settings.notifications.saved), onError: (error) => { setPreferences(previous); toast.error(error); } });
  }

  return (
    <Card id="notifications" title={t.settings.notifications.title} lead={t.settings.notifications.lead}>
      <div className="divide-y divide-line">
        {NOTIFICATION_GROUPS.map((group) => (
          <SwitchRow key={group.key} label={t.settings.notifications.groups[group.key].title} description={t.settings.notifications.groups[group.key].body} checked={isGroupEnabled(preferences, group.types)} onChange={(enabled) => change(group.types, enabled)} />
        ))}
      </div>
      <p className="mt-4 text-[13px] leading-snug text-faint">{t.notifications.pushNote}</p>
    </Card>
  );
}

function AccountCard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [passwordErrors, setPasswordErrors] = useState<{ password?: string | null; repeat?: string | null }>({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmWord, setConfirmWord] = useState("");

  const changePassword = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
    onSuccess: () => {
      setPassword("");
      setRepeat("");
      toast.success(t.settings.account.passwordSaved);
    },
  });

  const exportData = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("export_my_data");
      if (error) throw error;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `afterhours-daten-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onSuccess: () => toast.success(t.settings.account.exportDone),
    onError: (error) => toast.error(error),
  });

  const deleteAccount = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("delete_my_account", { p_confirmation: "DELETE" });
      if (error) throw error;
      // Das Konto existiert nicht mehr – nur noch die lokale Sitzung aufräumen.
      forgetNext();
      await supabase.auth.signOut({ scope: "local" });
    },
    onSuccess: () => {
      toast.success(t.settings.account.deleted);
      navigate("/login", { replace: true });
    },
  });

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    const next = { password: validate(password, passwordRule), repeat: password === repeat ? null : t.validation.passwordMismatch };
    setPasswordErrors(next);
    if (next.password || next.repeat) return;
    changePassword.mutate();
  }

  return (
    <Card id="account" title={t.settings.account.title}>
      <dl className="mb-6 text-[15px]">
        <dt className="text-sm text-muted">{t.settings.account.email}</dt>
        <dd className="mt-0.5 break-all font-semibold text-fg">{user?.email}</dd>
      </dl>

      <form onSubmit={submitPassword} noValidate className="space-y-4 border-t border-line pt-6">
        <h3 className="text-[17px] font-bold text-fg">{t.settings.account.passwordTitle}</h3>
        <TextField label={t.auth.fields.newPassword} name="new_password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={passwordErrors.password} hint={t.auth.fields.passwordHint} />
        <TextField label={t.auth.fields.repeatPassword} name="repeat_password" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} error={passwordErrors.repeat} />
        {changePassword.isError && <FormMessage>{errorMessage(changePassword.error)}</FormMessage>}
        <Button type="submit" variant="secondary" loading={changePassword.isPending} disabled={password === ""}>
          {t.settings.account.passwordSubmit}
        </Button>
      </form>

      <div className="mt-6 space-y-3 border-t border-line pt-6">
        <h3 className="text-[17px] font-bold text-fg">{t.settings.account.exportTitle}</h3>
        <p className="text-sm leading-snug text-muted">{t.settings.account.exportBody}</p>
        <Button variant="secondary" loading={exportData.isPending} onClick={() => exportData.mutate()} icon={<IconDownload className="size-4" aria-hidden />}>
          {t.settings.account.exportAction}
        </Button>
      </div>

      <div className="mt-6 space-y-3 border-t border-line pt-6">
        <h3 className="text-[17px] font-bold text-fg">{t.settings.account.deleteTitle}</h3>
        <p className="text-sm leading-snug text-muted">{t.settings.account.deleteBody}</p>
        <Button
          variant="danger"
          onClick={() => {
            setConfirmWord("");
            deleteAccount.reset();
            setDeleteOpen(true);
          }}
        >
          {t.settings.account.deleteAction}
        </Button>
      </div>

      <div className="mt-6 border-t border-line pt-6">
        <Button variant="ghost" onClick={() => void signOut().then(() => navigate("/login", { replace: true }))} icon={<IconLogout className="size-4" aria-hidden />}>
          {t.settings.account.signOut}
        </Button>
      </div>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title={t.settings.account.deleteDialogTitle} description={t.settings.account.deleteBody} size="sm">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (confirmWord.trim().toUpperCase() === t.settings.account.deleteConfirmWord) deleteAccount.mutate();
          }}
        >
          <TextField label={t.settings.account.deleteConfirmLabel} name="confirm_delete" value={confirmWord} onChange={(e) => setConfirmWord(e.target.value)} autoComplete="off" autoCapitalize="characters" />
          {deleteAccount.isError && <FormMessage>{errorMessage(deleteAccount.error)}</FormMessage>}
          <Button type="submit" variant="danger" block loading={deleteAccount.isPending} disabled={confirmWord.trim().toUpperCase() !== t.settings.account.deleteConfirmWord}>
            {t.settings.account.deleteSubmit}
          </Button>
        </form>
      </Dialog>
    </Card>
  );
}

export function SettingsPage() {
  useDocumentTitle(t.settings.title);
  const profile = useProfile();
  const settings = useSettings();
  const { hash } = useLocation();

  // Anker (#location, #notifications) nach dem Laden ansteuern.
  const ready = Boolean(profile.data && settings.data);
  useEffect(() => {
    if (ready && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [ready, hash]);

  if (profile.isPending || settings.isPending) return <PageSpinner />;
  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;

  return (
    <>
      <PageHeader title={t.settings.title} back={{ to: "/profile", label: t.settings.back }} />
      <div className="max-w-2xl space-y-5">
        <ProfileCard profile={profile.data} />
        <PreferencesCard profile={profile.data} settings={settings.data} />
        <LocationCard settings={settings.data} />
        <NotificationsCard settings={settings.data} />
        <AccountCard />
      </div>
    </>
  );
}
