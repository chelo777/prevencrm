-- ============================================================
-- 032 — CAPI: eventos personalizados (Conversion Leads).
--
-- Los adsets reales optimizan por QUALITY_LEAD con evento custom
-- 'closed-won' (promoted_object.custom_event_str, modo
-- onsite_crm_single_event). El CHECK original solo admitía nombres
-- estándar; se relaja a "no vacío" para permitir eventos custom.
-- ============================================================

ALTER TABLE lead_capi_config DROP CONSTRAINT IF EXISTS lead_capi_config_event_name_check;
ALTER TABLE lead_capi_config ADD CONSTRAINT lead_capi_config_event_name_check
  CHECK (length(trim(event_name)) > 0);
