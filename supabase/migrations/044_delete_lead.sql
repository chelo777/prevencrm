-- 044_delete_lead.sql — borrado de lead admin-only, atómico y sin huérfanos.
--
-- Borrar solo el contacto deja el lead y el deal colgando (leads.contact_id es
-- SET NULL). Esta RPC borra en el orden correcto: eventos CAPI del lead → lead
-- → su deal → el contacto (solo si no le queda OTRO lead/deal apuntándolo, para
-- que borrar UN duplicado no se lleve al resto). SECURITY DEFINER + admin-only.

CREATE OR REPLACE FUNCTION delete_lead(p_lead_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account UUID;
  v_deal UUID;
  v_contact UUID;
BEGIN
  SELECT account_id, deal_id, contact_id INTO v_account, v_deal, v_contact
    FROM leads WHERE id = p_lead_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Lead no encontrado' USING ERRCODE = '22023';
  END IF;
  IF NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'Solo un admin puede eliminar leads' USING ERRCODE = '42501';
  END IF;

  -- 1) Eventos CAPI del lead (referencian lead_id).
  DELETE FROM lead_capi_events WHERE lead_id = p_lead_id;
  -- 2) El lead (referencia deal_id/contact_id).
  DELETE FROM leads WHERE id = p_lead_id;
  -- 3) Su deal.
  IF v_deal IS NOT NULL THEN
    DELETE FROM deals WHERE id = v_deal;
  END IF;
  -- 4) El contacto — SOLO si ya no le queda ningún otro lead ni deal (así,
  --    borrar un duplicado no elimina al contacto que comparte con los demás).
  --    El cascade del contacto se lleva notas/valores/tags/conversaciones/mensajes.
  IF v_contact IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM leads WHERE contact_id = v_contact)
     AND NOT EXISTS (SELECT 1 FROM deals WHERE contact_id = v_contact) THEN
    DELETE FROM contacts WHERE id = v_contact;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_lead(UUID) TO authenticated;
