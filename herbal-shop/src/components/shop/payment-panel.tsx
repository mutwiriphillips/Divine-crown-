"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions";
import { formatKES } from "@/lib/money";

type Status = { status: string; paymentStatus: string; attempt: { id: string; status: string; resultDesc: string | null } | null } | null;

function PayButton({ amount }: { amount: number }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-clay w-full sm:w-auto" disabled={pending}>
      {pending ? "Sending request…" : `Pay ${formatKES(amount)} with M-Pesa`}
    </button>
  );
}

export function PaymentPanel(props: {
  number: string;
  accessKey: string | null;
  amountDue: number;
  defaultPhone: string;
  simulator: boolean;
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(props.action, null);
  const [status, setStatus] = useState<Status>(null);
  const [polling, setPolling] = useState(false);
  const started = useRef(0);
  const attemptId = (state?.data?.attemptId as string | undefined) ?? null;

  useEffect(() => {
    if (state?.ok && attemptId) {
      setPolling(true);
      started.current = Date.now();
    }
  }, [state, attemptId]);

  useEffect(() => {
    if (!polling) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await fetch(`/api/orders/${props.number}/status${props.accessKey ? `?key=${encodeURIComponent(props.accessKey)}` : ""}`, { cache: "no-store" });
        const j = (await r.json()) as Status;
        setStatus(j);
        if (j && (j.paymentStatus === "PAID" || (j.attempt && ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(j.attempt.status)))) {
          setPolling(false);
          router.refresh();
          return;
        }
      } catch {
        /* network blip: keep trying */
      }
      // Stop after 3 minutes; the order page still updates once the payment is confirmed.
      if (Date.now() - started.current < 180_000) setTimeout(tick, 3000);
      else setPolling(false);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [polling, props.number, props.accessKey, router]);

  const simulate = async (outcome: string) => {
    if (!attemptId) return;
    await fetch("/api/payments/mpesa/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptId, outcome, key: props.accessKey }) });
  };

  const failed = status?.attempt && ["FAILED", "CANCELLED", "EXPIRED"].includes(status.attempt.status);

  return (
    <div className="rounded-sm border-2 border-clay/40 bg-white p-5">
      <h2 className="font-serif text-2xl text-plum">Pay with M-Pesa</h2>
      {polling ? (
        <div className="mt-3" role="status" aria-live="polite">
          <p className="font-semibold">Waiting for you to confirm on your phone…</p>
          <p className="mt-1 text-sm text-ink-soft">Enter your M-Pesa PIN on the prompt. This page updates by itself once the payment is confirmed.</p>
          {props.simulator ? (
            <div className="mt-4 rounded border border-dashed border-warn bg-warn-100 p-3 text-sm">
              <p className="font-semibold text-warn">Test mode — M-Pesa simulator</p>
              <p className="mb-2 text-warn">No real money moves. Choose what the &quot;phone&quot; does:</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => simulate("success")}>Approve payment</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => simulate("cancel")}>Cancel on phone</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => simulate("insufficient")}>Insufficient funds</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <form action={formAction} className="mt-3 space-y-3">
          <input type="hidden" name="number" value={props.number} />
          <input type="hidden" name="key" value={props.accessKey ?? ""} />
          {failed ? (
            <p role="alert" className="rounded bg-bad-100 px-3 py-2 text-sm text-bad">
              The payment didn&apos;t go through{status?.attempt?.resultDesc ? ` (${status.attempt.resultDesc})` : ""}. You can try again.
            </p>
          ) : null}
          <div>
            <label className="field-label" htmlFor="pay-phone">M-Pesa phone number</label>
            <input className="input max-w-xs" id="pay-phone" name="phone" type="tel" defaultValue={props.defaultPhone} required />
          </div>
          <PayButton amount={props.amountDue} />
          {state?.message && !state.ok ? <p role="alert" className="text-sm text-bad">{state.message}</p> : null}
          <p className="text-[13px] text-ink-soft">We&apos;ll send a request to this number. Your order is confirmed once M-Pesa confirms the payment to us.</p>
        </form>
      )}
    </div>
  );
}
