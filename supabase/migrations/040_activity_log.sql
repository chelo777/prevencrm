-- ============================================================
-- 040 — activity_log: registro append-only de acciones de la asesora.
--
-- Sembrado (council): sin mostrar en UI todavía. Es el insumo del CAPI
-- de calidad y del "ver si actualizan" hecho bien (un log, no vigilancia
-- intrusiva). El admin ve todo; cada asesora ve solo lo suyo. Append-only:
-- no hay policies de UPDATE/DELETE, así que RLS los niega desde cliente.
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  -- stage_change | contacted | note_added | reassigned | ...
  action TEXT NOT NULL,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_account ON activity_log(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_deal ON activity_log(deal_id);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activity_log_select ON activity_log;
DROP POLICY IF EXISTS activity_log_insert ON activity_log;

-- Admin ve todo; agente ve solo lo suyo.
CREATE POLICY activity_log_select ON activity_log FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id) AND user_id = auth.uid())
);
-- Cada uno registra sus propias acciones.
CREATE POLICY activity_log_insert ON activity_log FOR INSERT WITH CHECK (
  is_account_member(account_id) AND user_id = auth.uid()
);
