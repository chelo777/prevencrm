-- ============================================================
-- 033 — CAPI multi-etapa: varias reglas etapa→evento por cuenta.
--
-- Conversion Leads recomienda enviar el funnel completo (calificado,
-- no-calificado, perdido, closed-won), no solo el cierre. La tabla
-- tenía PK = account_id (una sola regla); pasa a PK propio + unique
-- por (cuenta, etapa, evento). reconcileAllCapi ya itera todas las
-- filas activas y el dedupe por (lead_id, event_name) ya soporta
-- múltiples eventos por lead — no hay cambios de código.
-- ============================================================

ALTER TABLE lead_capi_config DROP CONSTRAINT IF EXISTS lead_capi_config_pkey;
ALTER TABLE lead_capi_config ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT uuid_generate_v4();
ALTER TABLE lead_capi_config ADD PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_capi_config_rule
  ON lead_capi_config(account_id, trigger_stage_name, event_name);
