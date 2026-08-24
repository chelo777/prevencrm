-- ============================================================
-- 054_lead_rotation.sql — reparto 1-a-1 + reclamo que avisa al admin
--
-- 1) lead_packages.last_delivered_at
--    El reparto por tandas elegía la de MENOS entregados. Con una tanda en
--    0/50 y otra en 35/50, la primera se llevaba los 35 leads siguientes
--    seguidos y la segunda quedaba seca hasta emparejarse. Ahora el turno lo
--    decide quién hace más tiempo que no recibe, así que hace falta guardar
--    ese instante. `delivered` sigue existiendo, pero sólo para el cupo.
--
--    Se podría derivar de leads.created_at, pero esa fecha es la del lead EN
--    META, no la de la entrega: con un import histórico el orden saldría mal.
--
-- 2) notifications: tipo `lead_reclaimed` + lead_id
--    Un lead sin trabajar ya no se reasigna solo a otro asesor: queda sin
--    asignar y se le avisa al admin, que decide qué hacer. La notificación
--    necesita apuntar al lead (hoy la tabla sólo sabe de conversaciones).
--
-- Aditiva e idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Rotación de tandas
-- ------------------------------------------------------------
ALTER TABLE lead_packages
  ADD COLUMN IF NOT EXISTS last_delivered_at TIMESTAMPTZ;

COMMENT ON COLUMN lead_packages.last_delivered_at IS
  'Cuándo se entregó el último lead a esta tanda. Decide el turno en el reparto 1-a-1; NULL = todavía no recibió ninguno.';

-- Backfill: la rotación arranca calibrada con lo ya entregado, en vez de
-- reiniciarse a ciegas y darle una ráfaga a la que recién recibió.
-- created_at del lead es lo más cercano a la fecha de entrega que hay para
-- los leads ya sellados; de acá en adelante lo estampa la app al sellar.
UPDATE lead_packages p
SET last_delivered_at = sub.max_created
FROM (
  SELECT package_id, MAX(created_at) AS max_created
  FROM leads
  WHERE package_id IS NOT NULL
  GROUP BY package_id
) sub
WHERE p.id = sub.package_id
  AND p.last_delivered_at IS NULL;

-- El reparto lee sólo las tandas abiertas y ordena por este campo.
CREATE INDEX IF NOT EXISTS idx_lead_packages_rotation
  ON lead_packages(account_id, status, last_delivered_at NULLS FIRST);

-- ------------------------------------------------------------
-- 2. Notificación de lead liberado
-- ------------------------------------------------------------
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE CASCADE;

COMMENT ON COLUMN notifications.lead_id IS
  'Lead al que apunta la notificación (deep-link /leads?lead=<id>). NULL para las de conversación.';
-- Existe deal_id desde 029, pero el deep-link de la bandeja es ?lead=<leadId>:
-- guardar el lead evita resolver deal -> lead en cada click.

-- Tipos permitidos: hay que ENUMERAR LOS TRES.
--
-- 027 creó el CHECK con sólo 'conversation_assigned' y 029 lo amplió con
-- 'lead_assigned' (las notificaciones de lead nuevo, 2044 filas en producción
-- al momento de esta migración). Una versión previa de este archivo listaba
-- sólo 'conversation_assigned' y 'lead_reclaimed': el ADD CONSTRAINT falló
-- contra las filas existentes y la transacción revirtió todo. Si hubiera
-- pasado, habría roto el aviso de leads nuevos.
--
-- Al ampliar este CHECK, listar SIEMPRE los tipos ya en uso.
--
-- Se borra por catálogo y no por nombre: el constraint se recreó en 029, así
-- que el nombre podría no ser el de 027. Si asumiéramos uno y no fuera ese, el
-- DROP IF EXISTS no haría nada, el CHECK viejo seguiría vivo y todo INSERT de
-- 'lead_reclaimed' fallaría en producción.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'notifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'lead_assigned', 'lead_reclaimed'));
