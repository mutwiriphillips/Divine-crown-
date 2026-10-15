import { ActionForm, SubmitButton } from "@/components/forms";
import { unsubscribeAction } from "./actions";

export const metadata = { title: "Unsubscribe", robots: { index: false } };

/** A button rather than a one-click GET, so email scanners that open links don't unsubscribe people by accident. */
export default async function Unsubscribe({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-3xl">Stop newsletter emails?</h1>
      <ActionForm action={unsubscribeAction} className="mt-6">
        <input type="hidden" name="token" value={token} />
        <SubmitButton>Unsubscribe</SubmitButton>
      </ActionForm>
    </div>
  );
}
