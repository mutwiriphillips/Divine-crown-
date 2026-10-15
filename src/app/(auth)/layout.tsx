import { Wordmark } from "@/components/wordmark";
import { getSetting } from "@/lib/settings";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const b = await getSetting("business");
  return (
    <div className="min-h-screen">
      <div className="selvedge" />
      <main className="mx-auto flex max-w-md flex-col px-4 pb-16 pt-10">
        <div className="mb-8 text-center">
          <Wordmark name={b.name} logoAssetId={b.logoAssetId} size="lg" />
        </div>
        {children}
      </main>
    </div>
  );
}
