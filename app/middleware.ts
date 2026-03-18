import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, deriveToken } from "@/lib/auth";

// Routes that are always public — no auth required
const PUBLIC_PREFIXES = [
  "/api/raw/",    // raw file access stays open
  "/api/auth",    // login/logout endpoint
  "/login",       // login page itself
  "/_next/",
  "/favicon.ico",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword) {
    // No password set → fully open (great for local dev)
    return NextResponse.next();
  }

  const cookieToken = req.cookies.get(COOKIE_NAME)?.value;
  const expectedToken = await deriveToken(sitePassword);

  if (cookieToken === expectedToken) {
    return NextResponse.next();
  }

  // Redirect to login, remembering where the user was headed
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
