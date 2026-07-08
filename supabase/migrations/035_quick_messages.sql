-- ============================================================
-- 035_quick_messages.sql — Mensajes rápidos (plantillas click-to-chat)
--
-- Plantillas de mensaje estilo Privyr para el flujo wa.me: el asesor
-- toca el botón de WhatsApp, elige una plantilla, las variables
-- ({{nombre}}, {{primer_nombre}}, {{campaña}}) se rellenan con los
-- datos del lead y se abre su WhatsApp con el texto listo.
--
-- Compartidas por cuenta: las gestiona owner/admin, las usa cualquier
-- miembro. Nada de datos sensibles: solo texto de plantilla.
--
-- Idempotente — segura de correr múltiples veces.
-- ============================================================

CREATE TABLE IF NOT EXISTS quick_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quick_messages_account
  ON quick_messages(account_id, position);

ALTER TABLE quick_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quick_messages_select ON quick_messages;
DROP POLICY IF EXISTS quick_messages_insert ON quick_messages;
DROP POLICY IF EXISTS quick_messages_update ON quick_messages;
DROP POLICY IF EXISTS quick_messages_delete ON quick_messages;

CREATE POLICY quick_messages_select ON quick_messages
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY quick_messages_insert ON quick_messages
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY quick_messages_update ON quick_messages
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY quick_messages_delete ON quick_messages
  FOR DELETE USING (is_account_member(account_id, 'admin'));
