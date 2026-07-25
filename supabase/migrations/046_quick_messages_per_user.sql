-- 046_quick_messages_per_user.sql — mensajes rápidos PRIVADOS por asesor.
--
-- Antes: quick_messages eran per-account (compartidas) y solo admin las
-- creaba/editaba/borraba → los asesores no podían tener las suyas, y abrir la
-- edición compartida los haría pisarse entre ellos (uno edita/borra y le cambia
-- la plantilla a los demás). Ahora CADA usuario tiene las SUYAS (user_id): las
-- ve, crea, edita, borra y reordena sin tocar las de nadie. Aislamiento
-- simétrico (owner/admin también maneja solo las propias).
--
-- message_templates (plantillas Meta del WABA oficial) NO se tocan: requieren
-- aprobación de Meta y son a nivel cuenta.

ALTER TABLE quick_messages
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Backfill: las existentes quedan del dueño de la cuenta.
UPDATE quick_messages qm
SET user_id = a.owner_user_id
FROM accounts a
WHERE a.id = qm.account_id AND qm.user_id IS NULL;

-- RLS por-usuario (reemplaza las políticas per-account admin-only).
DROP POLICY IF EXISTS quick_messages_select ON quick_messages;
DROP POLICY IF EXISTS quick_messages_insert ON quick_messages;
DROP POLICY IF EXISTS quick_messages_update ON quick_messages;
DROP POLICY IF EXISTS quick_messages_delete ON quick_messages;

-- Cada quien ve SOLO las suyas (y solo si es miembro activo — is_account_member
-- ya excluye bloqueados).
CREATE POLICY quick_messages_select ON quick_messages
  FOR SELECT USING (user_id = auth.uid() AND is_account_member(account_id));

-- Crear: solo las propias, y con rol agent+.
CREATE POLICY quick_messages_insert ON quick_messages
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND is_account_member(account_id, 'agent'::account_role_enum)
  );

-- Editar/borrar: solo las propias.
CREATE POLICY quick_messages_update ON quick_messages
  FOR UPDATE
  USING (user_id = auth.uid() AND is_account_member(account_id))
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));

CREATE POLICY quick_messages_delete ON quick_messages
  FOR DELETE USING (user_id = auth.uid() AND is_account_member(account_id));
