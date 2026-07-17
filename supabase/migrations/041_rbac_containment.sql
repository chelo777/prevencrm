-- ============================================================
-- 041_rbac_containment.sql — sprint de contención post-auditoría RBAC
--
-- Cierra los dos hallazgos que rompen el "muro real" (no UX):
--   1. `blocked` cosmético en API → ahora is_account_member excluye
--      bloqueados, así que RLS le deniega TODO a un usuario pausado
--      (browser client incluido). El chequeo de app-layer en
--      getCurrentAccount (ForbiddenError) es la otra mitad.
--   2. Fuga de PII de salud entre asesoras:
--      a. lead_intake_errors (raw_row: nombre/tel/respuestas de salud
--         crudas de la cuarentena) → SELECT/UPDATE admin-only.
--      b. leads.raw_payload (respuestas de salud) → REVOKE SELECT de
--         authenticated/anon: nadie lo lee por PostgREST; solo el
--         cron/CAPI lo escribe con service-role. Row-level RLS no puede
--         proteger una columna; el REVOKE sí. Ningún query de usuario
--         hace select('*') ni pide raw_payload (verificado), así que no
--         rompe nada.
--
-- NO purga datos ya capturados (decisión de retención del dueño).
-- Idempotente. Reversible (re-GRANT / policies).
-- ============================================================

-- ------------------------------------------------------------
-- (1) is_account_member: un miembro BLOQUEADO deja de ser miembro a
-- ojos de RLS. auth.uid() bloqueado → EXISTS falso → toda policy que
-- llama is_account_member deniega. El owner nunca es bloqueable
-- (set_member_blocked lo rechaza), así que no hay riesgo de auto-lockout.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_account_member(
  target_account_id uuid,
  min_role account_role_enum DEFAULT 'viewer'::account_role_enum
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND p.blocked = false
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$function$;

-- ------------------------------------------------------------
-- (2a) lead_intake_errors — PII de salud cruda en cuarentena. Su
-- gestión (revisar/resolver) es tarea de admin (mismo dueño de fuentes).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS lead_intake_errors_select ON lead_intake_errors;
CREATE POLICY lead_intake_errors_select ON lead_intake_errors FOR SELECT USING (
  is_account_member(account_id, 'admin')
);

DROP POLICY IF EXISTS lead_intake_errors_update ON lead_intake_errors;
CREATE POLICY lead_intake_errors_update ON lead_intake_errors FOR UPDATE USING (
  is_account_member(account_id, 'admin')
);

-- ------------------------------------------------------------
-- (2b) leads.raw_payload — respuestas del formulario (PII/salud).
-- Protección a nivel COLUMNA (RLS es row-level, no alcanza). OJO: en
-- Postgres un GRANT SELECT a nivel TABLA implica SELECT en TODAS las
-- columnas, así que un `REVOKE SELECT (col)` es NO-OP. Hay que revocar el
-- SELECT de tabla y re-otorgar columna por columna, excluyendo
-- raw_payload. El cron/CAPI (único que escribe, repository.ts) corre con
-- service-role → conserva sus grants. La app nunca lee raw_payload (solo
-- lo escribe): las respuestas que ve la asesora salen de
-- contact_custom_values, no de esta columna.
--
-- MANTENIMIENTO: una columna NUEVA en `leads` debe agregarse a este GRANT
-- o quedará ilegible para la app (falla en CERRADO — feature rota y
-- visible, no una fuga silenciosa).
-- ------------------------------------------------------------
REVOKE SELECT ON public.leads FROM anon;
REVOKE SELECT ON public.leads FROM authenticated;
GRANT SELECT (
  id, account_id, source_id, meta_lead_id, status, contact_id, deal_id,
  phone_valid, platform, is_organic, campaign_id, campaign_name, adset_id,
  adset_name, ad_id, ad_name, form_id, form_name, lead_created_time,
  created_at, updated_at, sheet_status, synced_stage_id
) ON public.leads TO authenticated;
