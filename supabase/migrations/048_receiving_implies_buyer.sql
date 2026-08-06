-- 048_receiving_implies_buyer.sql — "Recibe leads" ON implica compradora.
--
-- Trampa: la elegibilidad del pool exige is_lead_buyer=true AND
-- receiving_leads=true (listEligibleAgents). El toggle "Recibe leads"
-- (set_member_receiving) seteaba solo receiving_leads → un asesor con
-- is_lead_buyer=false quedaba con receiving=true pero FUERA del pool, y sus
-- leads iban todos a otra (le pasó con Fabi). Ahora prender "Recibe leads"
-- también marca is_lead_buyer=true (un asesor que recibe ES comprador).
-- Apagarlo NO desmarca comprador (queda pausado, sigue en el desplegable de
-- reasignación).

CREATE OR REPLACE FUNCTION public.set_member_receiving(p_user_id uuid, p_receiving boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_account UUID; v_role account_role_enum;
BEGIN
  SELECT account_id, account_role INTO v_account, v_role FROM profiles WHERE user_id = p_user_id;
  IF v_account IS NULL THEN RAISE EXCEPTION 'Usuario no encontrado' USING ERRCODE='22023'; END IF;
  IF NOT is_account_member(v_account,'admin') THEN RAISE EXCEPTION 'Solo un admin' USING ERRCODE='42501'; END IF;
  IF v_role='owner' THEN RAISE EXCEPTION 'El dueño no se gestiona por acá' USING ERRCODE='22023'; END IF;
  UPDATE profiles SET receiving_leads = p_receiving,
    is_lead_buyer = CASE WHEN p_receiving THEN true ELSE is_lead_buyer END,
    receiving_since = CASE WHEN p_receiving THEN now() ELSE receiving_since END,
    updated_at = now()
    WHERE user_id = p_user_id AND account_id = v_account;
END; $function$;
