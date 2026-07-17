-- 042_router_datos.sql — router de datos (pozo común) + VBO por capitas.
-- Contador DERIVADO de activity_log (lead_assigned − lead_reclaimed desde
-- receiving_since); no hay columna de contador mutable.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS receiving_leads BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receiving_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lead_cap INTEGER;  -- NULL = sin límite

-- Compradores existentes arrancan recibiendo, tanda desde ahora.
UPDATE profiles SET receiving_leads = true, receiving_since = now()
  WHERE is_lead_buyer = true;

ALTER TABLE deals ADD COLUMN IF NOT EXISTS capitas INTEGER;

ALTER TABLE lead_capi_config ADD COLUMN IF NOT EXISTS send_value BOOLEAN NOT NULL DEFAULT false;
UPDATE lead_capi_config SET send_value = true WHERE event_name IN ('calificado', 'closed-won');

-- set_member_receiving: al ACTIVAR, arranca nueva tanda (receiving_since=now()).
CREATE OR REPLACE FUNCTION set_member_receiving(p_user_id UUID, p_receiving BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account UUID; v_role account_role_enum;
BEGIN
  SELECT account_id, account_role INTO v_account, v_role FROM profiles WHERE user_id = p_user_id;
  IF v_account IS NULL THEN RAISE EXCEPTION 'Usuario no encontrado' USING ERRCODE='22023'; END IF;
  IF NOT is_account_member(v_account,'admin') THEN RAISE EXCEPTION 'Solo un admin' USING ERRCODE='42501'; END IF;
  IF v_role='owner' THEN RAISE EXCEPTION 'El dueño no se gestiona por acá' USING ERRCODE='22023'; END IF;
  UPDATE profiles SET receiving_leads = p_receiving,
    receiving_since = CASE WHEN p_receiving THEN now() ELSE receiving_since END,
    updated_at = now()
    WHERE user_id = p_user_id AND account_id = v_account;
END; $$;

-- set_member_cap: cupo por asesor (NULL = sin límite).
CREATE OR REPLACE FUNCTION set_member_cap(p_user_id UUID, p_cap INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account UUID;
BEGIN
  SELECT account_id INTO v_account FROM profiles WHERE user_id = p_user_id;
  IF v_account IS NULL THEN RAISE EXCEPTION 'Usuario no encontrado' USING ERRCODE='22023'; END IF;
  IF NOT is_account_member(v_account,'admin') THEN RAISE EXCEPTION 'Solo un admin' USING ERRCODE='42501'; END IF;
  IF p_cap IS NOT NULL AND p_cap < 0 THEN RAISE EXCEPTION 'Cupo inválido' USING ERRCODE='22023'; END IF;
  UPDATE profiles SET lead_cap = p_cap, updated_at = now()
    WHERE user_id = p_user_id AND account_id = v_account;
END; $$;

-- reset_member_cycle: arranca una tanda nueva SIN borrar historial (mueve receiving_since).
CREATE OR REPLACE FUNCTION reset_member_cycle(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account UUID;
BEGIN
  SELECT account_id INTO v_account FROM profiles WHERE user_id = p_user_id;
  IF v_account IS NULL THEN RAISE EXCEPTION 'Usuario no encontrado' USING ERRCODE='22023'; END IF;
  IF NOT is_account_member(v_account,'admin') THEN RAISE EXCEPTION 'Solo un admin' USING ERRCODE='42501'; END IF;
  UPDATE profiles SET receiving_since = now(), updated_at = now()
    WHERE user_id = p_user_id AND account_id = v_account;
END; $$;

GRANT EXECUTE ON FUNCTION set_member_receiving(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION set_member_cap(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION reset_member_cycle(UUID) TO authenticated;
