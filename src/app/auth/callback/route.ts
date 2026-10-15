import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Email-confirmation landing: exchanges the one-time code for a session cookie. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/`);
  }
  return NextResponse.redirect(`${origin}/login?error=confirmation_failed`);
}
