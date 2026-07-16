import type { Metadata } from "next";
import { DashboardShell } from "./dashboard-shell";
import { AccessBlocked } from "@/components/layout/access-blocked";
import { createClient } from "@/lib/supabase/server";

// Server layout whose only job is to declare "do not index" metadata
// for the authed app. robots.ts already disallows these paths at the
// crawler-level and middleware redirects unauthenticated visitors, so
// this is belt-and-suspenders — but SEO-critical if a URL ever leaks
// via a link shared externally.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Enforcement server-side de `blocked` en cada carga: una asesora
  // pausada no ve el CRM (RLS igual protege los datos). El shell cliente
  // lo re-chequea para cubrir la navegación SPA dentro del layout.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("blocked")
      .eq("user_id", user.id)
      .maybeSingle();
    if (prof?.blocked) return <AccessBlocked />;
  }

  return <DashboardShell>{children}</DashboardShell>;
}
