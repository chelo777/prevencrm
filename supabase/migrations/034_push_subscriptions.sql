-- ============================================================
-- 034_push_subscriptions.sql — Web Push (PWA)
--
-- Una fila por dispositivo suscripto. El endpoint es único a nivel
-- global (lo emite el push service del navegador); si el usuario
-- re-suscribe el mismo dispositivo se upsertea por endpoint.
--
-- Las claves p256dh/auth NO son secretos del servidor (son la clave
-- pública del dispositivo + auth secret del canal), pero solo el
-- dueño puede leer/gestionar sus filas vía RLS. El envío corre
-- server-side con service-role (cron de ingesta).
--
-- Idempotente — seguro de correr múltiples veces.
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_account ON push_subscriptions(account_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subs_select ON push_subscriptions;
DROP POLICY IF EXISTS push_subs_insert ON push_subscriptions;
DROP POLICY IF EXISTS push_subs_update ON push_subscriptions;
DROP POLICY IF EXISTS push_subs_delete ON push_subscriptions;

CREATE POLICY push_subs_select ON push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY push_subs_insert ON push_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_account_member(account_id));
CREATE POLICY push_subs_update ON push_subscriptions
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY push_subs_delete ON push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);
