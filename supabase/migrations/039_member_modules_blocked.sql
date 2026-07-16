-- ============================================================
-- 039 — gating de módulos por usuario + bloquear/habilitar.
--
--   profiles.allowed_modules TEXT[]  — módulos visibles para agent/viewer.
--     NULL = usar el default de código (['leads']). Admin/owner lo ignoran.
--   profiles.blocked BOOLEAN         — acceso pausado (el layout server
--     corta + se invalida la sesión; RLS igual protege los datos).
--
-- Como la RLS de profiles solo deja editar la fila propia, los cambios
-- sobre OTROS perfiles van por estas RPCs SECURITY DEFINER (patrón 018):
-- admin+ en la MISMA cuenta, con WHERE account_id propio, sin tocar owner
-- ni (para blocked) a sí mismo.
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS allowed_modules TEXT[];
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- set_member_modules(p_user_id, p_modules) — admin+ setea los módulos
-- visibles de un miembro de su cuenta.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_member_modules(p_user_id UUID, p_modules TEXT[])
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_account UUID;
BEGIN
  SELECT account_id INTO v_account FROM profiles WHERE user_id = p_user_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado' USING ERRCODE = '22023';
  END IF;
  IF NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'Solo un admin puede configurar módulos' USING ERRCODE = '42501';
  END IF;
  UPDATE profiles
    SET allowed_modules = p_modules, updated_at = now()
    WHERE user_id = p_user_id AND account_id = v_account;
END;
$$;

-- ------------------------------------------------------------
-- set_member_blocked(p_user_id, p_blocked) — admin+ pausa/reactiva el
-- acceso de un miembro. No al owner, no a sí mismo.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_member_blocked(p_user_id UUID, p_blocked BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_role account_role_enum;
BEGIN
  SELECT account_id, account_role INTO v_account, v_role
    FROM profiles WHERE user_id = p_user_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado' USING ERRCODE = '22023';
  END IF;
  IF NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'Solo un admin puede pausar accesos' USING ERRCODE = '42501';
  END IF;
  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'No se puede pausar al dueño de la cuenta' USING ERRCODE = '22023';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'No podés pausarte a vos mismo' USING ERRCODE = '22023';
  END IF;
  UPDATE profiles
    SET blocked = p_blocked, updated_at = now()
    WHERE user_id = p_user_id AND account_id = v_account;
END;
$$;

GRANT EXECUTE ON FUNCTION set_member_modules(UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION set_member_blocked(UUID, BOOLEAN) TO authenticated;
