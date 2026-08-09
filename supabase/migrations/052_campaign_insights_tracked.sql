-- 052_campaign_insights_tracked.sql — qué campañas cuentan para la contabilidad.
--
-- El gasto Meta del panel sumaba TODAS las campañas con insight, incluidas las
-- muertas (el histórico importado). Con eso el margen sale falso: se descuenta
-- plata de campañas que ya no traen nada.
--
-- `tracked` decide si una campaña entra en el gasto Meta y en el prorrateo de
-- costo por tanda. Default true: una campaña nueva se mide sola (no querés
-- olvidarte de prenderla y sub-contar el costo); las viejas se apagan a mano
-- desde el panel.

ALTER TABLE campaign_insights
  ADD COLUMN IF NOT EXISTS tracked BOOLEAN NOT NULL DEFAULT true;

-- Solo admin puede cambiar el flag (la tabla ya era admin-only para leer).
DROP POLICY IF EXISTS campaign_insights_admin_update ON campaign_insights;
CREATE POLICY campaign_insights_admin_update ON campaign_insights
  FOR UPDATE
  USING (is_account_member(account_id, 'admin'::account_role_enum))
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));
