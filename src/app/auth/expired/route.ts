import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point when a page finds no valid session although the browser still holds auth cookies (revoked session, deleted user).
 * Clears those cookies (this device only) and goes to the login page, so the proxy and the pages can never ping-pong.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/login?expired=1", request.url));
}
