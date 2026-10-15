import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap edge check: send visitors without a session cookie to sign-in before rendering protected areas.
 * Real authorisation (role and permission checks) happens on the server for every page and action.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if ((pathname.startsWith("/admin") || pathname.startsWith("/account")) && !req.cookies.get("sid")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/account/:path*"] };
