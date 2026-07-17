-- 043_deals_assigned_at.sql — watermark de asignación para el reclamo.
--
-- El reclamo (listStaleAssignedLeads) medía la antigüedad por deals.created_at,
-- que NO cambia al reasignar → una vez pasado el umbral, el lead se rebotaba en
-- cada corrida del cron (u1→u2→u3…). assigned_at marca cuándo el asesor ACTUAL
-- recibió el lead; se resetea en cada asignación/reasignación, así el reloj de
-- staleness arranca de nuevo por asesor.
--
-- Aditiva. Backfill = created_at para los ya asignados (quedan excluidos por el
-- gate reclaim_after igual, pero evita nulls).

ALTER TABLE deals ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

UPDATE deals SET assigned_at = created_at
  WHERE assigned_agent_id IS NOT NULL AND assigned_at IS NULL;
