import { redirect } from "next/navigation";
import { getCurrentAccount } from "@/lib/auth/account";
import { hasMinRole } from "@/lib/auth/roles";
import { createAccountingRepository } from "@/lib/accounting/repository";
import { loadAccountingSnapshot } from "@/lib/accounting/service";
import { AccountingPanel } from "@/components/accounting/accounting-panel";

export const dynamic = "force-dynamic";

// Panel de contabilidad de compradoras de datos (tandas + pagos).
//
// Server component: TODA la plata se calcula acá y viaja ya resuelta como
// props. Ningún componente cliente consulta las tablas de contabilidad —
// además de que la RLS (049) las deja solo para owner/admin.
//
// El gating por módulos no cubre /admin (no es un slug de MODULES), así que
// el corte de rol vive acá y en cada ruta API (requireRole('admin')).

export default async function ContabilidadPage() {
  const { supabase, accountId, role } = await getCurrentAccount();
  if (!hasMinRole(role, "admin")) redirect("/leads");

  const repo = createAccountingRepository(supabase, accountId);
  const snapshot = await loadAccountingSnapshot(repo);

  // Nombres de las compradoras para la tabla (is_lead_buyer marca quién
  // compra datos; mostramos también a quien ya tenga tandas cargadas).
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, full_name, is_lead_buyer, account_role")
    .eq("account_id", accountId)
    .order("full_name");

  const buyers = (profiles ?? [])
    .map((p) => ({
      userId: p.user_id as string,
      name: (p.full_name as string | null)?.trim() || "Sin nombre",
      isLeadBuyer: Boolean(p.is_lead_buyer),
    }))
    .filter(
      (p) =>
        p.isLeadBuyer ||
        snapshot.packages.some((pkg) => pkg.buyerUserId === p.userId),
    );

  return (
    <AccountingPanel
      totals={snapshot.totals}
      buyerTotals={snapshot.buyers}
      packages={snapshot.packages}
      payments={snapshot.payments}
      buyers={buyers}
    />
  );
}
