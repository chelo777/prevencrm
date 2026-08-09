-- 050_source_assignment_strategy.sql — cómo reparte cada fuente (handoff §4).
--
-- `least_loaded` (default, lo de hoy): pozo común, reparte por carga del ciclo.
-- `quota`: reparte contra las tandas compradas (lead_packages) y sella
-- leads.package_id, que es lo que consume la contabilidad.
--
-- Default 'least_loaded' a propósito: la migración es inerte, ninguna fuente
-- cambia de comportamiento hasta que un admin la pase a 'quota'.

ALTER TABLE lead_sources
  ADD COLUMN IF NOT EXISTS assignment_strategy TEXT NOT NULL DEFAULT 'least_loaded'
  CHECK (assignment_strategy IN ('least_loaded','quota'));
