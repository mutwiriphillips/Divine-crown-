"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function MobileMenu({ categories, signedIn }: { categories: { name: string; slug: string }[]; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
  }, [open]);
  return (
    <>
      <button className="btn-ghost btn-sm -ml-2 md:hidden" onClick={() => setOpen(true)} aria-expanded={open} aria-controls="shop-drawer">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        <span className="sr-only">Menu</span>
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" id="shop-drawer" aria-label="Menu">
          <button className="absolute inset-0 bg-plum-900/50" onClick={() => setOpen(false)} aria-label="Close menu" />
          <nav className="absolute inset-y-0 left-0 flex w-[84%] max-w-sm flex-col bg-ivory-50">
            <div className="selvedge" />
            <div className="flex items-center justify-between px-5 py-4">
              <span className="font-serif text-xl text-plum">Menu</span>
              <button className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <form action="/shop" className="px-5 pb-4" role="search">
              <input className="input" name="q" placeholder="Search products" aria-label="Search products" />
            </form>
            <ul className="flex-1 overflow-y-auto px-5">
              <li>
                <Link className="block border-b border-line py-3 text-lg" href="/shop">
                  All products
                </Link>
              </li>
              {categories.map((c) => (
                <li key={c.slug}>
                  <Link className="block border-b border-line py-3 text-lg" href={`/shop?category=${c.slug}`}>
                    {c.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link className="block border-b border-line py-3 text-lg" href={signedIn ? "/account" : "/login"}>
                  {signedIn ? "My account" : "Sign in"}
                </Link>
              </li>
              <li>
                <Link className="block py-3 text-lg" href="/orders/lookup">
                  Track an order
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      ) : null}
    </>
  );
}
