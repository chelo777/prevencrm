-- ============================================================
-- 031 — Fuente directa Meta Graph API (polling, sin Google).
-- Aditiva e idempotente.
--   * kind 'meta_api' en lead_sources.
--   * meta_page_id: página de Facebook de la fuente.
--   * meta_form_ids: ids de formularios elegidos ([] = todos los
--     formularios ACTIVE de la página, incluidos los futuros).
--   * Índice único: una fuente meta_api activa por página y cuenta.
-- El token (META_LEADS_ACCESS_TOKEN) vive SOLO en env, nunca acá.
-- ============================================================

ALTER TABLE lead_sources DROP CONSTRAINT IF EXISTS lead_sources_kind_check;
ALTER TABLE lead_sources ADD CONSTRAINT lead_sources_kind_check
  CHECK (kind IN ('google_sheet', 'meta_webhook', 'meta_api', 'manual'));

ALTER TABLE lead_sources ADD COLUMN IF NOT EXISTS meta_page_id TEXT;
ALTER TABLE lead_sources ADD COLUMN IF NOT EXISTS meta_form_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_sources_account_meta_page
  ON lead_sources(account_id, meta_page_id)
  WHERE active AND kind = 'meta_api';
