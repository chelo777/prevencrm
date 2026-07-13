-- ============================================================
-- Fase 0 (router multi-asesor): profiles.is_lead_buyer.
--
-- El rol de cuenta (owner/admin/agent) y "compra tandas de leads" son
-- cosas distintas: Ale es owner Y compradora; Marcelo es owner y NO
-- compradora. Este flag reemplaza el chequeo de rol que hoy decide
-- quién entra al reparto automático de leads (pickLeastLoaded).
--
-- Backfill a true según el mismo criterio que usaba el reparto hasta
-- ahora (owner/admin/agent) para no cambiar el comportamiento actual:
-- hoy el único perfil (Marcelo, owner) sigue recibiendo los leads
-- mientras Ale opera bajo su cuenta sin login propio.
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_lead_buyer BOOLEAN NOT NULL DEFAULT false;

UPDATE profiles SET is_lead_buyer = true WHERE account_role IN ('owner', 'admin', 'agent');
