import { useEffect, useMemo, useState } from "react";
import { IconAlert, IconClose, IconFilter, IconInfo, IconRefresh, IconSearch, IconSpinner } from "@/components/icons";
import { PageHeader } from "@/components/layout/Page";
import { Button } from "@/components/ui/Button";
import { Chip, SwitchRow } from "@/components/ui/Controls";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState, ErrorState, Notice, Skeleton } from "@/components/ui/Feedback";
import { SelectField } from "@/components/ui/Field";
import { CATEGORIES } from "@/data/options";
import { useProfile } from "@/features/profile/api";
import { t } from "@/i18n";
import { errorMessage } from "@/lib/errors";
import { useDebouncedValue } from "@/lib/hooks";
import { dayPhase, formatDateWithYear } from "@/lib/time";
import { ActivityCard } from "./ActivityCard";
import { applyFilters, countActiveFilters, EMPTY_FILTERS, useActivitySearch, usePlaceRegion, type ActivityFilters } from "./api";
import { CityField } from "./CityField";
import { rememberCity, rememberedCity } from "./rememberedCity";
import { pickStage, StageCard } from "./StageCard";

const numberOrNull = (value: string) => (value === "" ? null : Number(value));

const SUGGESTED_CITIES = ["Berlin", "Hamburg", "München", "Köln", "Frankfurt am Main", "Leipzig"];

export function DiscoverPage() {
  const profile = useProfile();
  const [filters, setFilters] = useState<ActivityFilters>(EMPTY_FILTERS);
  const [cityInitialized, setCityInitialized] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const patch = (update: Partial<ActivityFilters>) => setFilters((f) => ({ ...f, ...update }));

  // Start mit der zuletzt gewählten Stadt, sonst der aus dem Profil.
  useEffect(() => {
    if (cityInitialized || !profile.data) return;
    const start = rememberedCity() ?? profile.data.city?.trim();
    if (start) setFilters((f) => ({ ...f, city: start }));
    setCityInitialized(true);
  }, [cityInitialized, profile.data]);

  const city = filters.city;
  useEffect(() => {
    if (cityInitialized && city) rememberCity(city);
  }, [cityInitialized, city]);
  const places = usePlaceRegion(city);
  // "frankfurt" → "Frankfurt am Main": Feld und Abfragen auf den kanonischen Namen umstellen.
  useEffect(() => {
    if (places.canonicalName && city && places.canonicalName !== city && places.canonicalName.toLocaleLowerCase("de") !== city.toLocaleLowerCase("de")) {
      setFilters((f) => ({ ...f, city: places.canonicalName }));
    }
  }, [places.canonicalName, city]);

  const query = useDebouncedValue(filters.search, 300);
  const search = useActivitySearch(city ? { city, category: filters.category, query } : null);
  const page = search.data;
  const items = useMemo(() => page?.items ?? [], [page]);
  const categories = useMemo(() => CATEGORIES.filter((c) => (page?.categories[c] ?? 0) > 0 || c === filters.category), [page, filters.category]);

  const origin = places.center;
  const results = useMemo(() => applyFilters(items, filters, origin), [items, filters, origin]);
  const activeCount = countActiveFilters(filters);
  const region = places.region.data;
  const syncError = places.syncError;
  // Bühne (D0): ein Ort groß oben – nur beim Stöbern, nicht bei einer Suche nach etwas Bestimmtem.
  const stage = filters.search.trim() === "" ? pickStage(results) : null;
  const rest = stage ? results.filter((r) => r !== stage) : results;
  const cityName = places.canonicalName ?? city;

  return (
    <>
      {cityName ? (
        <header className="mb-6 lg:mb-8">
          <h1 className="display break-words uppercase text-fg text-[44px] sm:text-[64px]">
            {cityName}
            <br />
            <span className="text-lime">{t.discover.poster[dayPhase()]}</span>
          </h1>
        </header>
      ) : (
        <PageHeader title={t.discover.title} lead={t.discover.lead} />
      )}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_240px_auto]">
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-faint" aria-hidden />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => patch({ search: e.target.value })}
            aria-label={t.discover.searchLabel}
            placeholder={t.discover.searchPlaceholder}
            disabled={!city}
            className="h-12 w-full rounded-control border border-line bg-surface pl-11 pr-11 text-fg placeholder:text-faint hover:border-line-strong focus:border-lime focus:outline-none disabled:opacity-50 [&::-webkit-search-cancel-button]:hidden"
          />
          {filters.search && (
            <button type="button" onClick={() => patch({ search: "" })} aria-label={t.actions.remove} className="absolute right-1 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:text-fg">
              <IconClose className="size-4" aria-hidden />
            </button>
          )}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 sm:contents">
          <CityField value={city} onCommit={(next) => patch({ city: next, category: null, search: "" })} />
          <Button variant="secondary" className="h-12" onClick={() => setSheetOpen(true)} disabled={!city} icon={<IconFilter className="size-4" aria-hidden />}>
            {activeCount > 0 ? t.discover.filtersActive(activeCount) : t.discover.filters}
          </Button>
        </div>
      </div>

      {city && categories.length > 0 && (
        <div className="scroll-row -mx-4 mt-4 px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-wrap lg:px-0">
          <Chip selected={filters.category === null} onToggle={() => patch({ category: null })}>
            {t.discover.allCategories}
          </Chip>
          {categories.map((category) => (
            <Chip key={category} selected={filters.category === category} onToggle={() => patch({ category: filters.category === category ? null : category })}>
              {t.enums.categoryPlural[category]}
            </Chip>
          ))}
        </div>
      )}

      <div className="mt-6">
        {!city ? (
          profile.isPending ? (
            <Skeleton className="h-40 rounded-card" />
          ) : (
            <EmptyState
              title={t.discover.cityPrompt.title}
              body={t.discover.cityPrompt.body}
              action={
                <div className="flex flex-wrap gap-2" role="group" aria-label={t.discover.cityPrompt.suggestions}>
                  {SUGGESTED_CITIES.map((name) => (
                    <Chip key={name} selected={false} onToggle={() => patch({ city: name })}>
                      {name}
                    </Chip>
                  ))}
                </div>
              }
            />
          )
        ) : (
          <>
            {places.importing && (
              <Notice tone="lime" icon={<IconSpinner className="animate-spin" aria-hidden />} title={t.discover.sync.loading(city)} className="mb-5">
                {t.discover.sync.loadingBody}
              </Notice>
            )}
            {syncError && !places.importing && (
              <div className="mb-5">
                <Notice tone="amber" icon={<IconAlert aria-hidden />} title={t.discover.sync.failedTitle(city)}>
                  {errorMessage(syncError)}
                  {(region?.place_count ?? 0) > 0 && ` ${t.discover.sync.keptOld}`}
                </Notice>
                <Button variant="ghost" size="sm" className="mt-2" onClick={places.retry} icon={<IconRefresh className="size-4" aria-hidden />}>
                  {t.discover.sync.retry}
                </Button>
              </div>
            )}

            {search.isPending ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label={t.states.loading}>
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-[300px] rounded-card" />
                ))}
              </div>
            ) : search.isError ? (
              <ErrorState error={search.error} onRetry={() => void search.refetch()} />
            ) : page && page.total === 0 && !query && !filters.category ? (
              places.importing ? null : <EmptyState title={t.discover.empty.noData} body={t.discover.empty.noDataBody} />
            ) : (
              <>
                {results.some((r) => r.activity.is_demo) && (
                  <Notice tone="amber" icon={<IconInfo aria-hidden />} title={t.discover.demoNotice.title} className="mb-5">
                    {t.discover.demoNotice.body}
                  </Notice>
                )}
                {stage && (
                  <div className="mb-8">
                    <StageCard activity={stage.activity} distanceKm={stage.distanceKm} />
                  </div>
                )}
                {stage && rest.length > 0 && <h2 className="mb-1 text-xl font-bold text-fg">{t.discover.stage.more(cityName ?? "")}</h2>}
                <p className="mb-3 text-sm text-muted" aria-live="polite">
                  {page && page.total > items.length ? t.discover.resultsOf(results.length, page.total) : t.discover.results(results.length)}
                </p>
                {results.length === 0 ? (
                  <EmptyState
                    title={t.discover.empty.title}
                    body={t.discover.empty.body}
                    action={
                      <Button variant="secondary" size="sm" onClick={() => setFilters((f) => ({ ...EMPTY_FILTERS, city: f.city }))}>
                        {t.discover.resetFilters}
                      </Button>
                    }
                  />
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {rest.map(({ activity, distanceKm }) => (
                      <ActivityCard key={activity.id} activity={activity} distanceKm={distanceKm} />
                    ))}
                  </div>
                )}
              </>
            )}

            {region && region.status !== "none" && (region.place_count ?? 0) > 0 && region.synced_at && (
              <p className="mt-8 text-[13px] leading-snug text-faint">
                {t.discover.sync.source(region.place_count ?? 0, formatDateWithYear(region.synced_at))}{" "}
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline decoration-line-strong underline-offset-4 hover:text-fg">
                  {t.discover.sync.attribution}
                </a>
                , {t.discover.sync.license}
              </p>
            )}
          </>
        )}
      </div>

      <Dialog
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={t.discover.filters}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFilters((f) => ({ ...EMPTY_FILTERS, search: f.search, category: f.category, city: f.city }))} disabled={activeCount === 0}>
              {t.discover.resetFilters}
            </Button>
            <Button onClick={() => setSheetOpen(false)}>{t.discover.applyFilters(results.length)}</Button>
          </>
        }
      >
        <div className="space-y-5">
          <SelectField label={t.discover.filter.maxPrice} hint={t.discover.filter.priceHint} value={filters.maxPriceCents ?? ""} onChange={(e) => patch({ maxPriceCents: numberOrNull(e.target.value) })}>
            <option value="">{t.discover.filter.maxPriceAny}</option>
            {[10, 15, 20, 30, 50].map((euro) => (
              <option key={euro} value={euro * 100}>
                {t.discover.filter.maxPriceUpTo(euro)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t.discover.filter.distance}
            hint={origin && city ? t.discover.filter.distanceHint(places.canonicalName ?? city) : t.discover.filter.distanceUnavailable}
            value={filters.maxDistanceKm ?? ""}
            onChange={(e) => patch({ maxDistanceKm: numberOrNull(e.target.value) })}
            disabled={!origin}
          >
            <option value="">{t.discover.filter.distanceAny}</option>
            {[2, 5, 10, 25].map((km) => (
              <option key={km} value={km}>
                {t.discover.filter.distanceUpTo(km)}
              </option>
            ))}
          </SelectField>
          <div className="grid grid-cols-2 gap-4">
            <SelectField label={t.discover.filter.groupSize} value={filters.groupSize ?? ""} onChange={(e) => patch({ groupSize: numberOrNull(e.target.value) })}>
              <option value="">{t.discover.filter.groupSizeAny}</option>
              {[2, 3, 4, 5, 6, 8, 10, 12, 15].map((n) => (
                <option key={n} value={n}>
                  {t.people(n)}
                </option>
              ))}
            </SelectField>
            <SelectField label={t.discover.filter.duration} value={filters.maxDurationMinutes ?? ""} onChange={(e) => patch({ maxDurationMinutes: numberOrNull(e.target.value) })}>
              <option value="">{t.discover.filter.durationAny}</option>
              {[1, 2, 3].map((hours) => (
                <option key={hours} value={hours * 60}>
                  {t.discover.filter.durationUpTo(hours)}
                </option>
              ))}
            </SelectField>
            <SelectField label={t.discover.filter.setting} value={filters.setting ?? ""} onChange={(e) => patch({ setting: (e.target.value || null) as ActivityFilters["setting"] })}>
              <option value="">{t.discover.filter.settingAny}</option>
              <option value="indoor">{t.enums.setting.indoor}</option>
              <option value="outdoor">{t.enums.setting.outdoor}</option>
            </SelectField>
            <SelectField label={t.discover.filter.age} value={filters.age ?? ""} onChange={(e) => patch({ age: numberOrNull(e.target.value) })}>
              <option value="">{t.discover.filter.ageAny}</option>
              {[12, 14, 16].map((age) => (
                <option key={age} value={age}>
                  {t.discover.filter.ageOption(age)}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="divide-y divide-line border-y border-line">
            <SwitchRow label={t.discover.filter.openNow} description={t.discover.filter.openNowHint} checked={filters.openNow} onChange={(openNow) => patch({ openNow })} />
            <SwitchRow label={t.discover.filter.availability} description={t.discover.filter.availabilityHint} checked={false} onChange={() => undefined} disabled />
          </div>
          <p className="text-[13px] leading-snug text-faint">
            {t.discover.filter.rating}: {t.discover.filter.ratingHint}
          </p>
        </div>
      </Dialog>
    </>
  );
}
