"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { NavGroup } from "./nav";

export function AdminSidebar({ groups, shopName, userName, roleName }: { groups: NavGroup[]; shopName: string; userName: string; roleName: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const isActive = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(href + "/"));
  // The most specific matching item wins (e.g. /admin/pos/shifts over /admin/pos).
  const allHrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  const active = allHrefs.filter(isActive).sort((a, b) => b.length - a.length)[0];

  const nav = (
    <nav aria-label="Admin" className="flex h-full flex-col">
      <div className="px-4 pb-3 pt-4">
        <Link href="/admin" className="font-serif text-xl text-ivory-50">
          {shopName}
        </Link>
        <p className="mt-0.5 text-[13px] text-plum-100/80">
          {userName} · {roleName}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {groups.map((g) => (
          <div key={g.label} className="mt-3">
            <p className="px-2 pb-1 text-[12px] font-semibold text-plum-100/60">{g.label}</p>
            <ul>
              {g.items.map((i) => (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    aria-current={active === i.href ? "page" : undefined}
                    className={`block rounded px-2 py-1.5 text-[14px] ${active === i.href ? "bg-ivory-50/15 font-semibold text-white" : "text-plum-50/90 hover:bg-ivory-50/10"}`}
                  >
                    {i.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 px-4 py-3 text-[13px]">
        <Link href="/admin/account" className="block text-plum-50/90 hover:text-white">
          My account & security
        </Link>
        <Link href="/" className="mt-1 block text-plum-50/90 hover:text-white">
          View shop
        </Link>
      </div>
    </nav>
  );

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between bg-plum px-4 py-2 text-ivory-50 lg:hidden">
        <span className="font-serif text-lg">{shopName}</span>
        <button className="btn-sm btn rounded border border-white/30 text-white" onClick={() => setOpen(true)} aria-expanded={open} aria-controls="admin-drawer">
          Menu
        </button>
      </div>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 bg-plum lg:block">{nav}</aside>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" id="admin-drawer">
          <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-plum">{nav}</aside>
        </div>
      ) : null}
    </>
  );
}
