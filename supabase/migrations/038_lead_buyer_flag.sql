-- ============================================================
-- profiles.is_lead_buyer — quién entra al reparto automático de leads.
--
-- El rol de cuenta (owner/admin/agent) y "compra tandas de leads" son
-- cosas distintas: una asesora es agent Y compradora; el admin/owner es
-- admin y NO compradora. Este flag reemplaza el chequeo de rol que
-- decide el reparto automático (pickLeastLoaded / listAssignableAgents).
--
-- Backfill preservando el comportamiento actual (owner/admin/agent).
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_lead_buyer BOOLEAN NOT NULL DEFAULT false;

UPDATE profiles SET is_lead_buyer = true WHERE account_role IN ('owner', 'admin', 'agent');
