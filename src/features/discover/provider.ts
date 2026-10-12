/**
 * Datenquelle für Orte und Aktivitäten.
 *
 * Die Oberfläche spricht nur mit `placesProvider`. Orte liegen in der Tabelle `activities`:
 *   - echte Orte aus OpenStreetMap (provider_id = 'osm'), pro Stadt bei Bedarf importiert durch die
 *     Edge Function "places" (supabase/functions/places) – der Browser stößt den Import nur an,
 *     schreiben kann ausschließlich der Server;
 *   - Demo-Orte aus supabase/seed.sql (ausgeblendet, sobald eine Stadt echte Orte hat);
 *   - von Administratoren gepflegte Einträge.
 * Abstimmungen und Pläne verweisen auf activity_id und funktionieren deshalb mit jeder Quelle.
 * API-Schlüssel weiterer Anbieter gehören in Edge-Function-Secrets, nie in den Browser.
 */
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Activity, ActivityCategory } from "@/lib/types";

export interface ActivitySearch {
  city: string;
  category?: ActivityCategory | null;
  query?: string | null;
  limit?: number;
}

export interface ActivityPage {
  /** Treffer insgesamt (kann größer sein als items.length). */
  total: number;
  /** Anzahl der Orte je Kategorie in der Stadt – für die Kategorie-Chips. */
  categories: Partial<Record<ActivityCategory, number>>;
  items: Activity[];
}

export interface PlaceRegion {
  status: "none" | "syncing" | "ready" | "failed";
  id?: string;
  name?: string;
  /** Mittelpunkt der Stadt laut OSM – Bezugspunkt für Entfernungen. */
  latitude?: number;
  longitude?: number;
  place_count?: number;
  synced_at?: string | null;
  /** Daten älter als 30 Tage. */
  stale?: boolean;
  /** Ein Import läuft gerade. */
  busy?: boolean;
}

export interface SyncResult {
  status: "ready" | "busy";
  region: PlaceRegion;
}

export interface PlacesProvider {
  search(search: ActivitySearch): Promise<ActivityPage>;
  get(id: string): Promise<Activity | null>;
  region(city: string): Promise<PlaceRegion>;
  sync(city: string): Promise<SyncResult>;
}

/** Fehler der Edge Function in die Form bringen, die errorMessage() kennt. */
async function functionError(error: unknown): Promise<never> {
  if (error instanceof FunctionsHttpError) {
    const body = (await (error.context as Response).json().catch(() => null)) as { error?: string } | null;
    const status = (error.context as Response).status;
    throw Object.assign(new Error(body?.error ?? "function_error"), { code: body?.error ? "P0001" : undefined, status });
  }
  throw error;
}

export const placesProvider: PlacesProvider = {
  async search({ city, category, query, limit = 300 }) {
    const { data, error } = await supabase.rpc("search_activities", {
      p_city: city,
      p_category: category ?? null,
      p_query: query?.trim() ? query.trim() : null,
      p_limit: limit,
    });
    if (error) throw error;
    return data as ActivityPage;
  },
  async get(id) {
    const { data, error } = await supabase.from("activities").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return (data as Activity | null) ?? null;
  },
  async region(city) {
    const { data, error } = await supabase.rpc("place_region_status", { p_city: city });
    if (error) throw error;
    return data as PlaceRegion;
  },
  async sync(city) {
    const { data, error } = await supabase.functions.invoke<SyncResult>("places", { body: { city } });
    if (error) return functionError(error);
    if (!data) throw new Error("function_error");
    return data;
  },
};
