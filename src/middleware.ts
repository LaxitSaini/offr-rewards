import { NextResponse, type NextRequest } from "next/server";

/**
 * Defence in depth: admin API routes are never reachable without an admin
 * session cookie. Real authorisation still happens server-side inside each
 * route handler (see requireAdmin + requireCsrf).
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isAdminApi = pathname.startsWith("/api/admin/");
  const isPublicAdminRoute = pathname === "/api/admin/login" || pathname === "/api/admin/session";

  if (isAdminApi && !isPublicAdminRoute && !req.cookies.get("offr_admin")) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Admin authentication required.", details: null } },
      { status: 403 },
    );
  }

  const res = NextResponse.next();
  res.headers.set("X-Offr-Rewards", "1");
  return res;
}

export const config = {
  matcher: ["/api/admin/:path*"],
};
