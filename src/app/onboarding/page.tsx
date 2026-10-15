import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/onboarding-form";
import { getSession } from "@/lib/auth";

export const metadata = { title: "Create organization" };

export default async function OnboardingPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.orgId) redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <OnboardingForm />
    </main>
  );
}
