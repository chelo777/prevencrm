-- 053_campaign_insights_daily.sql — gasto de Meta DÍA POR DÍA.
--
-- campaign_insights guarda una sola fila por campaña con el gasto de toda la
-- vida (date_preset=maximum). Sirve para el total, pero no permite preguntar
-- "cuánto me salió el lead desde que entró Fabi": para eso hace falta la serie
-- temporal. Esta tabla la guarda, un registro por campaña y día.
--
-- El total lifetime sigue viviendo en campaign_insights (es el que Meta
-- reporta como verdad para "Todo"); esta tabla es el desglose para los rangos.

CREATE TABLE IF NOT EXISTS campaign_insights_daily (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  meta_campaign_id TEXT NOT NULL,
  day              DATE NOT NULL,
  spend            NUMERIC(12,2),
  impressions      BIGINT,
  clicks           BIGINT,
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, meta_campaign_id, day)
);

-- El filtro siempre entra por cuenta + rango de días.
CREATE INDEX IF NOT EXISTS idx_campaign_insights_daily_range
  ON campaign_insights_daily(account_id, day);

ALTER TABLE campaign_insights_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_insights_daily_admin_read ON campaign_insights_daily;
CREATE POLICY campaign_insights_daily_admin_read ON campaign_insights_daily
  FOR SELECT USING (is_account_member(account_id, 'admin'::account_role_enum));
