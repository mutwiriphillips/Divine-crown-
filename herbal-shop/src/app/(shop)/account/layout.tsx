import Link from "next/link";
import { requireCustomerPage } from "@/lib/auth/server";
import { logoutAction } from "@/app/(auth)/actions";

const NAV = [
  ["/account", "Overview"],
  ["/account/orders", "Orders"],
  ["/account/addresses", "Addresses"],
  ["/account/support", "Messages"],
  ["/account/profile", "Details & privacy"],
];

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const u = await requireCustomerPage();
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-ink-soft">Signed in as {u.name}</p>
          <h1 className="text-4xl">Your account</h1>
        </div>
        <div className="flex gap-2">
          {u.isStaff ? <Link className="btn-secondary btn-sm" href="/admin">Staff area</Link> : null}
          <form action={logoutAction}>
            <button className="btn-ghost btn-sm">Sign out</button>
          </form>
        </div>
      </div>
      <div className="grid gap-8 md:grid-cols-[200px_1fr]">
        <nav aria-label="Account">
          <ul className="flex gap-1 overflow-x-auto md:flex-col">
            {NAV.map(([href, label]) => (
              <li key={href}>
                <Link className="block whitespace-nowrap rounded px-3 py-2 hover:bg-plum-50" href={href}>{label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>{children}</div>
      </div>
    </div>
  );
}
