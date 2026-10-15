import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";

const PUBLIC_PATHS = ["/login", "/signup", "/auth", "/setup"];

/** Refreshes the Supabase session cookie and gates pages behind sign-in. API routes return 401 themselves. */
export async function proxy(request: NextRequest) {
  const env = getSupabaseEnv();
  const { pathname } = request.nextUrl;
  if (!env) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: { code: "not_configured", message: "Supabase is not configured. See .env.example." } },
        { status: 503 },
      );
    }
    return pathname === "/setup" ? NextResponse.next() : NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  const isApi = pathname.startsWith("/api/");
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!signedIn && !isPublic && !isApi) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (signedIn && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|pdf|mjs|js)$).*)"],
};
