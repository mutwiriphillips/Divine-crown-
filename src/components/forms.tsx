"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions";

type Act = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Form wired to a server action, with an inline result message and field errors.
 * Works without JavaScript (falls back to a normal POST); with JS it stays on the page.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  confirm,
  id,
}: {
  action: Act;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
  id?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      id={id}
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <FieldErrorsContext.Provider value={state?.errors ?? {}}>{children}</FieldErrorsContext.Provider>
      <FormMessage state={state} />
    </form>
  );
}

import { createContext, useContext } from "react";
const FieldErrorsContext = createContext<Record<string, string>>({});

export function FieldError({ name }: { name: string }) {
  const errs = useContext(FieldErrorsContext);
  if (!errs[name]) return null;
  return (
    <p className="mt-1 text-[13px] font-medium text-bad" id={`${name}-error`}>
      {errs[name]}
    </p>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state?.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={`mt-3 rounded px-3 py-2 text-sm ${state.ok ? "bg-ok-100 text-ok" : "bg-bad-100 text-bad"}`}>
      {state.message}
    </p>
  );
}

export function SubmitButton({ children, className = "btn-primary", pendingText, name, value }: { children: React.ReactNode; className?: string; pendingText?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending} name={name} value={value}>
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}

/** Generates a stable idempotency key for the life of the form, so double-submits are harmless. */
export function IdempotencyKey({ name = "idempotencyKey" }: { name?: string }) {
  const [key] = useState(() => crypto.randomUUID());
  return <input type="hidden" name={name} value={key} />;
}
