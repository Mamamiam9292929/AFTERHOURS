import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { clearOfflineCache, startOfflineCache } from "@/lib/offline";
import { forgetPushOnSignOut } from "@/lib/push";
import { queryClient } from "@/lib/query";
import { supabase } from "@/lib/supabase";
import { forgetNext } from "./next";

interface AuthState {
  /** true, bis die gespeicherte Sitzung geprüft wurde */
  loading: boolean;
  session: Session | null;
  user: User | null;
  /** true direkt nach dem Klick auf einen Passwort-zurücksetzen-Link */
  recovery: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      // W4: gespeicherten Offline-Stand dieser Person bereitstellen, bevor die Seiten rendern.
      if (data.session) startOfflineCache(queryClient, data.session.user.id);
      setSession(data.session);
      setLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      if (next) startOfflineCache(queryClient, next.user.id);
      setSession(next);
      setLoading(false);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "USER_UPDATED") setRecovery(false);
      if (event === "SIGNED_OUT") {
        setRecovery(false);
        // Keine Daten der vorherigen Person im Speicher behalten – auch nicht auf dem Gerät.
        clearOfflineCache();
        queryClient.clear();
      }
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      recovery,
      signOut: async () => {
        forgetNext();
        clearOfflineCache();
        // P4: Dieses Gerät bekommt danach keine Pushs der bisherigen Person mehr.
        await forgetPushOnSignOut();
        await supabase.auth.signOut();
        queryClient.clear();
        forgetNext();
      },
    }),
    [loading, session, recovery],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Für Bereiche hinter der Anmeldung: Die Route-Guards stellen sicher, dass es eine Person gibt. */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error("useUser requires an authenticated route");
  return user;
}
