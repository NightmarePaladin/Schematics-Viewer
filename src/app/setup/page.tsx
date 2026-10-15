import { isSupabaseConfigured } from "@/lib/supabase/env";
import { redirect } from "next/navigation";

export const metadata = { title: "Setup" };

export default function SetupPage() {
  if (isSupabaseConfigured()) redirect("/");
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-8">
      <h1 className="text-2xl font-semibold">SchematicHub needs Supabase credentials</h1>
      <p className="text-muted-foreground">
        The app is running, but no Supabase project is configured yet. Create <code>.env.local</code> from{" "}
        <code>.env.example</code> and restart the dev server:
      </p>
      <pre className="overflow-x-auto rounded-lg border bg-muted p-4 text-sm">
{`NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon or publishable key>`}
      </pre>
      <p className="text-muted-foreground">
        Then apply the SQL files in <code>supabase/migrations/</code> in order (see README.md → Supabase setup).
      </p>
    </main>
  );
}
