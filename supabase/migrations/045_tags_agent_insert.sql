-- 045_tags_agent_insert.sql — los asesores (agent+) pueden CREAR etiquetas.
--
-- Antes: tags_insert exigía admin. Un agente solo podía ASIGNAR etiquetas
-- existentes, no crear nuevas → fricción al etiquetar (si no existía la que
-- necesitaba, no podía hacer nada sin un admin). Ahora un agente crea etiquetas
-- en SU cuenta (la RLS sigue atando account_id a su membresía). UPDATE/DELETE
-- quedan admin-only: crear+usar es operativo; renombrar/borrar es gestión.

DROP POLICY IF EXISTS tags_insert ON tags;
CREATE POLICY tags_insert ON tags
  FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'::account_role_enum));
