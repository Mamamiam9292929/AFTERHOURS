import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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
      setSession(data.session);
      setLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      setLoading(false);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "USER_UPDATED") setRecovery(false);
      if (event === "SIGNED_OUT") {
        setRecovery(false);
        // Keine Daten der vorherigen Person im Speicher behalten.
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
