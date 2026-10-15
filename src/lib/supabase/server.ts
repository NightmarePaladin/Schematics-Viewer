import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";

/**
 * Per-request Supabase client acting AS THE SIGNED-IN USER (anon key + user JWT).
 * Every query it makes is subject to Row Level Security. No service-role key is used in the app.
 */
export async function createClient() {
  const cookieStore = await cookies(); // reading cookies first opts every caller into dynamic rendering
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase is not configured. Copy .env.example to .env.local and fill it in.");
  return createServerClient(env.url, env.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}
