import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False, solange .env.local fehlt – die App zeigt dann einen Einrichtungshinweis statt abzustürzen. */
export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes("DEIN-PROJEKT"));

/**
 * Einziger Supabase-Client der App. Er verwendet ausschließlich den öffentlichen anon-Key;
 * was eine angemeldete Person lesen und schreiben darf, entscheidet die Datenbank (RLS + RPC).
 */
export const supabase = createClient(url || "http://localhost:54321", anonKey || "not-configured", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "afterhours.auth",
  },
});

/** Öffentliche Basis-URL für Links, die die App verlässt (Einladungen, Auth-E-Mails). */
export function siteUrl(): string {
  const configured = import.meta.env.VITE_SITE_URL;
  return (configured && configured.trim() !== "" ? configured : window.location.origin).replace(/\/+$/, "");
}
