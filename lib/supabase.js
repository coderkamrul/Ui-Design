/**
 * Supabase client (env-gated).
 *
 * The backend is OPT-IN via environment: when NEXT_PUBLIC_SUPABASE_URL
 * and NEXT_PUBLIC_SUPABASE_ANON_KEY are both set (in .env.local — see
 * .env.example and the README's "Backend & auth" section), the app uses
 * Supabase for auth, file storage and image assets. When either is
 * absent the app runs in LOCAL MODE: no client is created, auth is a
 * no-op and persistence falls back to localStorage, exactly as the
 * M0–M4 builds behaved.
 *
 * No key is ever hardcoded here — the anon key is read from the
 * environment at runtime, and it is safe to expose in the browser
 * because Row Level Security (supabase/schema.sql) does the enforcing.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when both Supabase env vars are present. */
export function isSupabaseConfigured() {
  return Boolean(url && anonKey);
}

let client = null;

/**
 * The shared Supabase client, or null in local mode. Singleton: auth
 * state listeners and the session cache live on the client, so every
 * module must share one instance.
 */
export function getSupabase() {
  if (!isSupabaseConfigured()) return null;
  if (!client) client = createClient(url, anonKey);
  return client;
}
