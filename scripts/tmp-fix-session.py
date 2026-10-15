def rw(p, pairs):
    t = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert a in t, (p, a[:70])
        t = t.replace(a, b, 1)
    open(p, 'w', encoding='utf8').write(t)

# 1) proxy decides "signed in" the same way the pages do (a server-validated user, not just a locally-valid token)
rw('src/proxy.ts', [
    ('  const { data } = await supabase.auth.getClaims();\n  const signedIn = Boolean(data?.claims);',
     '''  // Validated against the Auth server (not just the token signature) so this agrees with the pages: a valid-looking token whose
  // session was revoked or whose user was deleted must count as signed OUT, otherwise /login <-> / redirect forever.
  const { data } = await supabase.auth.getUser();
  const signedIn = Boolean(data.user);'''),
])

# 2) sign-out only ends THIS browser's session (global scope would sign a shared demo account out on every device)
rw('src/app/auth/signout/route.ts', [
    ('await supabase.auth.signOut();', 'await supabase.auth.signOut({ scope: "local" });'),
])

# 3) safety net: a page that finds no valid user clears the stale cookies on the way to login
open('src/app/auth/expired/route.ts', 'w', encoding='utf8').write('''import { NextResponse } from "next/server";
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
''')

rw('src/lib/auth.ts', [
    ('  const s = await getSession();\n  if (!s) redirect("/login");\n  if (!s.orgId || !s.role) redirect("/onboarding");', '  const s = await getSession();\n  if (!s) redirect("/auth/expired");\n  if (!s.orgId || !s.role) redirect("/onboarding");'),
])
rw('src/app/(app)/layout.tsx', [('if (!s) redirect("/login");', 'if (!s) redirect("/auth/expired");')])
rw('src/app/onboarding/page.tsx', [('if (!s) redirect("/login");', 'if (!s) redirect("/auth/expired");')])

# 4) tell the user why they are back at the login page
rw('src/components/auth-form.tsx', [
    ('  const [info, setInfo] = useState<string | null>(null);', '  const [info, setInfo] = useState<string | null>(params.get("expired") ? "Your session ended. Please sign in again." : null);'),
])
print('ok')
