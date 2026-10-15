"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(params.get("expired") ? "Your session ended. Please sign in again." : null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    try {
      const supabase = createBrowserSupabase();
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const display_name = String(form.get("display_name") ?? "").trim();
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name }, emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        if (!data.session) {
          setInfo("Check your email to confirm your account, then sign in.");
          setBusy(false);
          return;
        }
      }
      const next = params.get("next");
      router.replace(next && next.startsWith("/") ? next : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  const isLogin = mode === "login";
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold tracking-wide">
            <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">S</span>
            SchematicHub
          </div>
          <CardTitle>{isLogin ? "Sign in" : "Create your account"}</CardTitle>
          <CardDescription>
            {isLogin ? "Access your organization's machines and schematics." : "You can create or join an organization next."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {!isLogin && (
              <div className="space-y-1.5">
                <Label htmlFor="display_name">Name</Label>
                <Input id="display_name" name="display_name" autoComplete="name" required />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                minLength={8}
                autoComplete={isLogin ? "current-password" : "new-password"}
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {info && (
              <p role="status" className="text-sm text-muted-foreground">
                {info}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Please wait…" : isLogin ? "Sign in" : "Create account"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {isLogin ? (
              <>
                New here? <Link className="underline" href="/signup">Create an account</Link>
              </>
            ) : (
              <>
                Already registered? <Link className="underline" href="/login">Sign in</Link>
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
