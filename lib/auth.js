"use client";

/**
 * Session state (Supabase Auth) — a tiny context over supabase.auth.
 *
 * LOCAL MODE (no Supabase env vars): the hook returns a stable
 *   { status: "local", session: "local", user: null }
 * so callers can treat "local" as "no gating applies" and the app
 * behaves exactly as the pre-backend builds did.
 *
 * CONFIGURED MODE: status is "loading" until the first getSession()
 * resolves, then "signed-in" (session/user populated) or "signed-out"
 * (session null). onAuthStateChange keeps it live (sign-in, sign-out,
 * token refresh in another tab, …).
 *
 * The provider is mounted once in app/layout.js.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getSupabase, isSupabaseConfigured } from "./supabase";

const LOCAL_STATE = { status: "local", session: "local", user: null };

const AuthContext = createContext(LOCAL_STATE);

export function AuthProvider({ children }) {
  const configured = isSupabaseConfigured();
  const [state, setState] = useState(
    configured ? { status: "loading", session: null, user: null } : LOCAL_STATE,
  );

  useEffect(() => {
    if (!configured) return;
    const sb = getSupabase();
    let cancelled = false;

    sb.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const session = data?.session ?? null;
      setState({
        status: session ? "signed-in" : "signed-out",
        session,
        user: session?.user ?? null,
      });
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setState({
        status: session ? "signed-in" : "signed-out",
        session,
        user: session?.user ?? null,
      });
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, [configured]);

  const value = useMemo(() => state, [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** { status: "local" | "loading" | "signed-in" | "signed-out", session, user } */
export function useSession() {
  return useContext(AuthContext);
}

/** Sign out (configured mode); a no-op in local mode. */
export async function signOut() {
  const sb = getSupabase();
  if (sb) await sb.auth.signOut();
}
