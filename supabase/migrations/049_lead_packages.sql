-- 049_lead_packages.sql — contabilidad de compradoras de datos (tandas + pagos).
--
-- Modelo del handoff §4 (lead_packages, lead_package_payments, leads.package_id)
-- y §6.1 (campaign_insights). Aditiva: no toca datos existentes.
--
-- DESVÍO DELIBERADO del handoff §4: allí la RLS decía "el comprador ve SUS
-- paquetes y pagos". Acá la contabilidad es **admin-only**: una asesora NO ve
-- contabilidad, ni siquiera la propia (precio por dato, deuda y margen son
-- información comercial del dueño). Pedido explícito del negocio.

-- ------------------------------------------------------------
-- Tandas compradas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_packages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  buyer_user_id UUID NOT NULL REFERENCES auth.users(id),
  ordinal       INT  NOT NULL,                -- "Paula #3"
  leads_target  INT  NOT NULL DEFAULT 50 CHECK (leads_target > 0),
  price         NUMERIC(12,2) NOT NULL DEFAULT 300000 CHECK (price >= 0),
  currency      TEXT NOT NULL DEFAULT 'ARS',
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','completed','cancelled')),
  committed_at  DATE,                         -- fecha comprometida de pago
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lead_packages_account ON lead_packages(account_id);
CREATE INDEX IF NOT EXISTS idx_lead_packages_buyer ON lead_packages(buyer_user_id);
-- El ordinal es por comprador dentro de la cuenta ("Paula #3").
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_packages_buyer_ordinal
  ON lead_packages(account_id, buyer_user_id, ordinal);

-- ------------------------------------------------------------
-- Pagos (parciales: varios por tanda)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_package_payments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES lead_packages(id) ON DELETE CASCADE,
  paid_on    DATE NOT NULL,
  amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_package_payments_package
  ON lead_package_payments(package_id);

-- ------------------------------------------------------------
-- Trazabilidad: qué lead se entregó contra qué tanda
-- ------------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES lead_packages(id);
CREATE INDEX IF NOT EXISTS idx_leads_package ON leads(package_id);

-- ------------------------------------------------------------
-- Gasto por campaña (handoff §6.1) — poblada por el cron de sync.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_insights (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  meta_campaign_id TEXT NOT NULL,
  campaign_name    TEXT,
  spend            NUMERIC(12,2),
  impressions      BIGINT,
  reach            BIGINT,
  clicks           BIGINT,
  ctr              NUMERIC(6,3),
  cpm              NUMERIC(12,2),
  frequency        NUMERIC(6,2),
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, meta_campaign_id)
);

-- ------------------------------------------------------------
-- RLS — contabilidad SOLO owner/admin. Las escrituras van por rutas API
-- con requireRole('admin'); el cron usa service role (bypassea RLS).
-- ------------------------------------------------------------
ALTER TABLE lead_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_package_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_packages_admin_all ON lead_packages;
CREATE POLICY lead_packages_admin_all ON lead_packages
  FOR ALL
  USING (is_account_member(account_id, 'admin'::account_role_enum))
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));

-- Los pagos heredan el gate del paquete padre.
DROP POLICY IF EXISTS lead_package_payments_admin_all ON lead_package_payments;
CREATE POLICY lead_package_payments_admin_all ON lead_package_payments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM lead_packages p
      WHERE p.id = lead_package_payments.package_id
        AND is_account_member(p.account_id, 'admin'::account_role_enum)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lead_packages p
      WHERE p.id = lead_package_payments.package_id
        AND is_account_member(p.account_id, 'admin'::account_role_enum)
    )
  );

DROP POLICY IF EXISTS campaign_insights_admin_read ON campaign_insights;
CREATE POLICY campaign_insights_admin_read ON campaign_insights
  FOR SELECT USING (is_account_member(account_id, 'admin'::account_role_enum));
