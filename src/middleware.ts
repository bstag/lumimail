import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const MUTATION_METHODS = new Set(["POST", "PATCH", "DELETE", "PUT"]);

export default function middleware(request: NextRequest) {
  const url = request.nextUrl;

  if (url.pathname.startsWith("/api/v1/")) {
    return NextResponse.next();
  }

  if (url.pathname.startsWith("/api/") && MUTATION_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");
    const host = request.headers.get("host") ?? url.host;

    const originHost = origin ? new URL(origin).host : null;
    const refererHost = referer ? new URL(referer).host : null;

    if (originHost && originHost !== host && refererHost !== host) {
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|_vercel|.*\\..*|favicon.ico).*)"],
};
