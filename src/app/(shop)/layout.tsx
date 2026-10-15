import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/server";
import { cartCount } from "@/lib/cart";
import { categoriesWithCounts } from "@/lib/catalog";
import { getAllSettings } from "@/lib/settings";
import { Wordmark } from "@/components/wordmark";
import { MobileMenu } from "@/components/shop/mobile-menu";
import { mpesaMode } from "@/lib/payments/mpesa";
import { whatsappUrl } from "@/lib/text";
import { ChatIcon } from "@/components/shop/chat-icon";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const [{ business, commerce }, user, count, cats] = await Promise.all([getAllSettings(), getCurrentUser(), cartCount(), categoriesWithCounts()]);
  const navCats = cats.filter((c) => c.count > 0 && !c.parentId);
  const waOrder = whatsappUrl(business.whatsapp, `Hello ${business.name}, I would like to place an order.`);
  const waChat = whatsappUrl(business.whatsapp);
  const payments = [mpesaMode() !== "disabled" ? "M-Pesa" : null, commerce.cashOnDelivery ? "Cash on delivery" : null, "Cash in store"].filter(Boolean);

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <div className="selvedge" />
      {business.announcement ? <p className="bg-plum px-4 py-2 text-center text-[13px] text-ivory-50">{business.announcement}</p> : null}
      {waOrder || business.email ? (
        <div className="border-b border-line bg-ivory-100 text-[13px] text-ink-soft">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-5 gap-y-1 px-4 py-1.5 sm:justify-end">
            {waOrder ? (
              <a href={waOrder} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 hover:text-plum">
                <ChatIcon className="h-4 w-4" /> Order on WhatsApp{business.phone ? ` · ${business.phone}` : ""}
              </a>
            ) : null}
            {business.email ? <a href={`mailto:${business.email}`} className="hover:text-plum">{business.email}</a> : null}
          </div>
        </div>
      ) : null}
      <header className="sticky top-0 z-40 border-b border-line bg-ivory/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <MobileMenu categories={navCats.map((c) => ({ name: c.name, slug: c.slug }))} signedIn={!!user} />
          <Wordmark name={business.name} logoAssetId={business.logoAssetId} />
          <nav aria-label="Categories" className="ml-6 hidden gap-5 whitespace-nowrap text-[15px] md:flex">
            <Link href="/shop" className="hover:text-plum">Shop all</Link>
            {navCats.slice(0, 5).map((c) => (
              <Link key={c.slug} href={`/shop?category=${c.slug}`} className="hover:text-plum">
                {c.name}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <form action="/shop" role="search" className="hidden xl:block">
              <input className="input input-sm w-56" name="q" placeholder="Search products" aria-label="Search products" />
            </form>
            <Link href={user ? (user.isStaff ? "/admin" : "/account") : "/login"} className="btn-ghost btn-sm whitespace-nowrap" aria-label={user ? "My account" : "Sign in"}>
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
              </svg>
              <span className="hidden sm:inline">{user ? "Account" : "Sign in"}</span>
            </Link>
            <Link href="/cart" className="btn-ghost btn-sm relative" aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}>
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M5 7h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8z" />
                <path d="M9 7a3 3 0 0 1 6 0" />
              </svg>
              <span className="hidden sm:inline">Cart</span>
              {count > 0 ? <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-clay px-1 text-[11px] font-bold text-white">{count}</span> : null}
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="mt-16 bg-plum text-ivory-50">
        <div className="selvedge" />
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-serif text-2xl">{business.name}</p>
            {business.tagline ? <p className="mt-2 text-sm text-plum-100">{business.tagline}</p> : null}
            {business.address || business.town ? (
              <p className="mt-3 text-sm text-plum-100">
                {business.address}
                {business.town ? <><br />{business.town}</> : null}
              </p>
            ) : null}
            {business.openingHours ? <p className="mt-2 text-sm text-plum-100">{business.openingHours}</p> : null}
          </div>
          <div>
            <p className="mb-3 font-semibold">Get in touch</p>
            <ul className="space-y-1 text-sm text-plum-100">
              {business.phone ? <li><a className="hover:text-white" href={`tel:${business.phone}`}>{business.phone}</a></li> : null}
              {waChat ? <li><a className="hover:text-white" href={waOrder ?? waChat} target="_blank" rel="noopener">Order on WhatsApp</a></li> : null}
              {business.email ? <li><a className="hover:text-white" href={`mailto:${business.email}`}>{business.email}</a></li> : null}
              <li><Link className="hover:text-white" href="/support">Ask a question</Link></li>
              <li><Link className="hover:text-white" href="/orders/lookup">Track an order</Link></li>
            </ul>
          </div>
          <div>
            <p className="mb-3 font-semibold">Shopping with us</p>
            <ul className="space-y-1 text-sm text-plum-100">
              <li><Link className="hover:text-white" href="/policies/delivery">Delivery</Link></li>
              <li><Link className="hover:text-white" href="/policies/returns">Returns & refunds</Link></li>
              <li><Link className="hover:text-white" href="/policies/privacy">Privacy</Link></li>
              <li><Link className="hover:text-white" href="/policies/terms">Terms</Link></li>
            </ul>
          </div>
          <div>
            <p className="mb-3 font-semibold">Pay with</p>
            <p className="text-sm text-plum-100">{payments.join(" · ")}</p>
            {Object.values(business.social).some(Boolean) ? (
              <>
                <p className="mb-2 mt-5 font-semibold">Follow</p>
                <ul className="flex gap-4 text-sm text-plum-100">
                  {business.social.facebook ? <li><a className="hover:text-white" href={business.social.facebook} rel="noopener">Facebook</a></li> : null}
                  {business.social.instagram ? <li><a className="hover:text-white" href={business.social.instagram} rel="noopener">Instagram</a></li> : null}
                  {business.social.tiktok ? <li><a className="hover:text-white" href={business.social.tiktok} rel="noopener">TikTok</a></li> : null}
                </ul>
              </>
            ) : null}
          </div>
        </div>
        <p className="border-t border-white/10 py-4 text-center text-[12px] text-plum-100/70">© {new Date().getFullYear()} {business.name}</p>
      </footer>
      {waOrder ? (
        <a
          href={waOrder}
          target="_blank"
          rel="noopener"
          className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-[#1F7A4D] px-4 py-3 text-[15px] font-semibold text-white shadow-lg ring-2 ring-white/70 hover:bg-[#186440] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum print:hidden"
          aria-label={`Order on WhatsApp${business.phone ? `, ${business.phone}` : ""}`}
        >
          <ChatIcon className="h-5 w-5" />
          <span className="hidden sm:inline">Order on WhatsApp</span>
        </a>
      ) : null}
    </div>
  );
}
