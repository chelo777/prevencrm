-- ============================================================
-- 030 — Wizard de fuentes + sync de estados planilla→CRM.
-- Aditiva e idempotente.
--   * leads.sheet_status: último lead_status visto en la hoja.
--   * leads.synced_stage_id: última etapa aplicada por la sync
--     (NULL = la planilla no controla el deal; regla humano-manda).
--   * lead_sync_runs.stage_synced: contador por corrida.
--   * Fuentes duplicadas: se desactivan (conservando la más vieja)
--     y un índice único parcial evita duplicar de nuevo.
-- ============================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS sheet_status TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS synced_stage_id UUID
  REFERENCES pipeline_stages(id) ON DELETE SET NULL;

ALTER TABLE lead_sync_runs ADD COLUMN IF NOT EXISTS stage_synced INTEGER NOT NULL DEFAULT 0;

-- Desactivar fuentes duplicadas (misma cuenta + planilla + pestaña),
-- conservando la más vieja. No se borra: leads.source_id las referencia.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY account_id, spreadsheet_id, COALESCE(sheet_gid, '0')
           ORDER BY created_at ASC
         ) AS rn
  FROM lead_sources
  WHERE active AND kind = 'google_sheet'
)
UPDATE lead_sources SET active = FALSE
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_sources_account_sheet
  ON lead_sources(account_id, spreadsheet_id, COALESCE(sheet_gid, '0'))
  WHERE active;
