"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

const inputCls =
  "h-10 w-full rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface-content)] px-3 text-sm outline-none focus:border-[var(--accent-focus)]";
const primaryBtnCls =
  "h-10 w-full rounded-[var(--radius-lg)] text-sm font-medium disabled:opacity-50 transition-colors cursor-pointer";

export default function LoginPage() {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const { status } = useSession();

  const [mode, setMode] = useState("password"); // "password" | "otp"
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  // Already signed in
  useEffect(() => {
    if (configured && status === "signed-in") router.replace("/");
  }, [configured, status, router]);

  const handlePasswordAuth = async (e) => {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      if (isSignUp) {
        const { data, error: err } = await sb.auth.signUp({
          email: email.trim(),
          password,
        });
        if (err) throw err;
        if (data.session) {
          router.replace("/");
        } else {
          setMessage(
            "Account created! Please check your email for the confirmation link, or sign in if confirmation is disabled.",
          );
        }
      } else {
        const { data, error: err } = await sb.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (err) throw err;
        if (data.session) {
          router.replace("/");
        }
      }
    } catch (err) {
      setError(err.message || "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const sendOtpCode = async (e) => {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);

    const { error: err } = await sb.auth.signInWithOtp({
      email: email.trim(),
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setOtpSent(true);
  };

  const verifyOtpCode = async (e) => {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb || busy) return;
    setBusy(true);
    setError(null);

    const { data, error: err } = await sb.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "email",
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (data.session) {
      router.replace("/");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-panel)] px-4">
      <div className="w-full max-w-sm rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--surface-content)] p-6 shadow-xl">
        <div
          className="mb-1 font-semibold text-[var(--text-1)]"
          style={{ fontSize: "var(--type-heading)" }}
        >
          Designer Canvas
        </div>
        <p className="mb-4 text-xs text-[var(--text-2)]">
          Connected to Supabase Database
        </p>

        {!configured ? (
          <>
            <p className="mb-4 text-[var(--text-2)] text-sm">
              Sign-in isn&apos;t configured. This build has no Supabase
              project connected, so it runs in <strong>local mode</strong>.
            </p>
            <Link
              href="/"
              className={`${primaryBtnCls} flex items-center justify-center`}
              style={{
                background: "var(--btn-primary-bg)",
                color: "var(--btn-primary-text)",
              }}
            >
              Back to your files
            </Link>
          </>
        ) : (
          <>
            {/* Mode switcher tabs */}
            <div className="mb-4 flex rounded-lg bg-[var(--surface-hover)] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => {
                  setMode("password");
                  setError(null);
                  setMessage(null);
                }}
                className={`flex-1 rounded-md py-1.5 font-medium transition-all cursor-pointer ${
                  mode === "password"
                    ? "bg-white dark:bg-zinc-700 text-[var(--text-1)] shadow-xs"
                    : "text-[var(--text-2)] hover:text-[var(--text-1)]"
                }`}
              >
                Password
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("otp");
                  setError(null);
                  setMessage(null);
                }}
                className={`flex-1 rounded-md py-1.5 font-medium transition-all cursor-pointer ${
                  mode === "otp"
                    ? "bg-white dark:bg-zinc-700 text-[var(--text-1)] shadow-xs"
                    : "text-[var(--text-2)] hover:text-[var(--text-1)]"
                }`}
              >
                Magic Code
              </button>
            </div>

            {error && (
              <div className="mb-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 p-2 text-xs text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            {message && (
              <div className="mb-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 p-2 text-xs text-emerald-600 dark:text-emerald-400">
                {message}
              </div>
            )}

            {mode === "password" ? (
              <form onSubmit={handlePasswordAuth} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-[var(--text-2)]">
                    Email address
                  </span>
                  <input
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className={inputCls}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-[var(--text-2)]">
                    Password
                  </span>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className={inputCls}
                  />
                </label>

                <button
                  type="submit"
                  disabled={busy || !email.trim() || !password}
                  className={`${primaryBtnCls} mt-1`}
                  style={{
                    background: "var(--btn-primary-bg)",
                    color: "var(--btn-primary-text)",
                  }}
                >
                  {busy ? "Processing…" : isSignUp ? "Create account" : "Sign in"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(!isSignUp);
                    setError(null);
                    setMessage(null);
                  }}
                  className="text-xs text-[var(--text-2)] hover:text-[var(--text-1)] hover:underline text-center mt-1 cursor-pointer"
                >
                  {isSignUp
                    ? "Already have an account? Sign in"
                    : "Don't have an account? Sign up"}
                </button>
              </form>
            ) : !otpSent ? (
              <form onSubmit={sendOtpCode} className="flex flex-col gap-3">
                <p className="text-xs text-[var(--text-2)]">
                  Enter your email to receive a 6-digit one-time code.
                </p>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-[var(--text-2)]">
                    Email
                  </span>
                  <input
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className={inputCls}
                  />
                </label>

                <button
                  type="submit"
                  disabled={busy || !email.trim()}
                  className={`${primaryBtnCls} mt-1`}
                  style={{
                    background: "var(--btn-primary-bg)",
                    color: "var(--btn-primary-text)",
                  }}
                >
                  {busy ? "Sending code…" : "Send code"}
                </button>
              </form>
            ) : (
              <form onSubmit={verifyOtpCode} className="flex flex-col gap-3">
                <p className="text-xs text-[var(--text-2)]">
                  Enter the 6-digit code sent to{" "}
                  <span className="font-semibold text-[var(--text-1)]">{email}</span>.
                </p>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-[var(--text-2)]">
                    Code
                  </span>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                    className={inputCls}
                  />
                </label>

                <button
                  type="submit"
                  disabled={busy || code.trim().length < 6}
                  className={`${primaryBtnCls} mt-1`}
                  style={{
                    background: "var(--btn-primary-bg)",
                    color: "var(--btn-primary-text)",
                  }}
                >
                  {busy ? "Verifying…" : "Sign in"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOtpSent(false);
                    setCode("");
                    setError(null);
                  }}
                  className="text-xs text-[var(--text-2)] hover:underline text-center cursor-pointer"
                >
                  Use a different email
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
