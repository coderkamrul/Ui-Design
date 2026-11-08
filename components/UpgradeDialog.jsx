"use client";

/**
 * Plans dialog (platform batch) — Free vs Pro comparison, a
 * monthly/yearly toggle, a DEMO checkout form, and (on Pro) plan
 * management with an inline-confirm downgrade.
 *
 * ⚠️ DEMO BILLING — READ BEFORE "FIXING": this dialog takes NO real
 * payment. The card form is inert (its fields are never sent anywhere),
 * submitting it simply flips the locally stored plan id
 * (lib/plans.js → localStorage `canvastool:plan`). The demo notice is
 * shown in the dialog itself, permanently, on purpose: nobody should
 * ever mistake this for a working checkout. Production billing state
 * must come from a payment provider's server-side webhooks, not from
 * anything the client asserts.
 *
 * Used by the editor (account area / AI panel limit prompt, via the
 * store's upgradeDialogOpen) and by the dashboard (New-file limit),
 * which mount it with their own open state.
 */
import { useState } from "react";
import { PLANS, planOf } from "@/lib/plans";

const ROWS = [
  { label: "Files", free: "Up to 5", pro: "Unlimited" },
  { label: "Version history", free: "10 versions per file", pro: "30 versions per file" },
  { label: "AI create generations", free: "5 per day", pro: "Unlimited" },
  { label: "Multiplayer", free: "Included", pro: "Included" },
  { label: "Support", free: "Community", pro: "Priority" },
];

const inputCls =
  "h-9 w-full rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 outline-none focus:border-[var(--accent-focus)]";

export default function UpgradeDialog({ planId, onPlanChange, onClose }) {
  const plan = planOf(planId);
  const isPro = plan.id === "pro";
  const [cycle, setCycle] = useState("yearly"); // "monthly" | "yearly"
  const [confirmingDowngrade, setConfirmingDowngrade] = useState(false);
  const [card, setCard] = useState({ name: "", number: "", expiry: "", cvc: "" });

  const pro = PLANS.pro;
  const price = cycle === "yearly" ? pro.priceYearly : pro.priceMonthly;
  const canSubmit =
    card.name.trim().length > 1 &&
    card.number.replace(/\D/g, "").length >= 12 &&
    card.expiry.trim().length >= 4 &&
    card.cvc.trim().length >= 3;

  const submit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    // Demo checkout: no request is made, no payment is taken — the
    // "purchase" is just the local plan flip the caller performs.
    onPlanChange("pro");
    onClose();
  };

  const cell = "px-3 py-2 align-top";

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100%-32px)] w-[520px] max-w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--surface-content)] shadow-xl"
        role="dialog"
        aria-label="Plans"
        data-plans="dialog"
      >
        <div className="flex items-start justify-between px-5 pt-4">
          <div>
            <h2
              className="font-semibold"
              style={{ fontSize: "var(--type-heading)" }}
            >
              {isPro ? "Your plan: Pro" : "Upgrade to Pro"}
            </h2>
            <p className="mt-0.5 text-[var(--type-label)] text-[var(--text-2)]">
              Current plan: {plan.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] hover:bg-[var(--surface-hover)]"
            title="Close"
          >
            ✕
          </button>
        </div>

        <div
          className="mx-5 mt-3 rounded-[var(--radius-md)] px-3 py-2 text-[var(--type-label)]"
          style={{ background: "var(--surface-hover)" }}
        >
          <strong>Demo checkout — no payment is taken.</strong> This
          dialog is a placeholder for a real billing integration: the
          card form sends nothing, and your plan is stored only in this
          browser. Please don&apos;t enter a real card number.
        </div>

        {/* Comparison */}
        <table className="mt-4 w-full border-collapse text-[var(--type-label)]">
          <thead>
            <tr className="border-y border-[var(--line)] text-left">
              <th className={`${cell} font-medium text-[var(--text-2)]`}></th>
              <th className={`${cell} font-semibold`}>Free</th>
              <th className={`${cell} font-semibold`}>Pro</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-b border-[var(--line)]">
                <td className={`${cell} text-[var(--text-2)]`}>{row.label}</td>
                <td className={cell}>{row.free}</td>
                <td className={cell}>{row.pro}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {isPro ? (
          <div className="px-5 py-4">
            <p className="text-[var(--type-label)] text-[var(--text-2)]">
              You&apos;re on Pro (demo). Everything above is unlocked in
              this browser.
            </p>
            {confirmingDowngrade ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[var(--type-label)]">
                  Downgrade to Free? Version history drops to 10 per file
                  and AI generations to 5/day.
                </span>
                <button
                  className="rounded-[var(--radius-md)] border border-[var(--line)] px-3 py-1.5 font-medium hover:bg-[var(--surface-hover)]"
                  onClick={() => {
                    onPlanChange("free");
                    onClose();
                  }}
                >
                  Confirm downgrade
                </button>
                <button
                  className="px-2 py-1.5 text-[var(--text-2)] hover:underline"
                  onClick={() => setConfirmingDowngrade(false)}
                >
                  Keep Pro
                </button>
              </div>
            ) : (
              <button
                className="mt-3 rounded-[var(--radius-md)] border border-[var(--line)] px-3 py-1.5 font-medium hover:bg-[var(--surface-hover)]"
                onClick={() => setConfirmingDowngrade(true)}
              >
                Manage plan — downgrade to Free
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="px-5 py-4">
            {/* Billing cycle toggle */}
            <div className="flex items-center gap-3">
              <div className="flex rounded-[var(--radius-lg)] bg-[var(--surface-hover)] p-0.5">
                {[
                  ["monthly", "Monthly"],
                  ["yearly", "Yearly"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setCycle(key)}
                    className="rounded-[var(--radius-md)] px-3 py-1"
                    style={
                      cycle === key
                        ? {
                            background: "var(--surface-content)",
                            boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                            fontWeight: 500,
                          }
                        : { color: "var(--text-2)" }
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-[var(--type-label)] text-[var(--text-2)]">
                {cycle === "yearly"
                  ? `$${price}/mo, billed yearly ($${price * 12}/yr)`
                  : `$${price}/mo, billed monthly`}
              </span>
            </div>

            {/* Demo card form — inert by design, see header comment. */}
            <div className="mt-4 flex flex-col gap-2">
              <input
                className={inputCls}
                placeholder="Name on card"
                autoComplete="off"
                value={card.name}
                onChange={(e) => setCard({ ...card, name: e.target.value })}
              />
              <input
                className={inputCls}
                placeholder="Card number (demo — use any digits)"
                autoComplete="off"
                inputMode="numeric"
                value={card.number}
                onChange={(e) => setCard({ ...card, number: e.target.value })}
              />
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  placeholder="MM / YY"
                  autoComplete="off"
                  value={card.expiry}
                  onChange={(e) => setCard({ ...card, expiry: e.target.value })}
                />
                <input
                  className={inputCls}
                  placeholder="CVC"
                  autoComplete="off"
                  inputMode="numeric"
                  value={card.cvc}
                  onChange={(e) => setCard({ ...card, cvc: e.target.value })}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-4 h-9 w-full rounded-[var(--radius-lg)] font-medium disabled:opacity-40"
              style={{
                background: "var(--btn-primary-bg)",
                color: "var(--btn-primary-text)",
              }}
            >
              Upgrade to Pro — ${price}/mo (demo)
            </button>
          </form>
        )}
      </div>
    </>
  );
}
