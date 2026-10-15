import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/server";
import { getAllSettings } from "@/lib/settings";
import { ADMIN_NAV } from "./nav";
import { AdminSidebar } from "./sidebar";

export const metadata = { robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaffPage();
  const { business, commerce } = await getAllSettings();
  const groups = ADMIN_NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || user.permissions.includes(i.perm)) })).filter((g) => g.items.length);
  const needsMfa = commerce.requireMfaForOwner && user.roleKey === "OWNER" && !user.mfaEnabled;
  return (
    <div className="min-h-screen bg-[#FBF8F2]">
      <AdminSidebar groups={groups} shopName={business.name} userName={user.name} roleName={user.roleName} />
      <div className="lg:pl-60">
        {needsMfa ? (
          <div className="bg-warn-100 px-6 py-2 text-sm text-warn">
            Two-step sign-in is required for the owner account. <Link className="link" href="/admin/account">Turn it on now</Link>.
          </div>
        ) : null}
        <main className="mx-auto max-w-[1280px] px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
