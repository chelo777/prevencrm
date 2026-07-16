-- ============================================================
-- 037_agent_row_isolation.sql — aislamiento por asesor asignado
--
-- Este negocio VENDE leads exclusivos a cada compradora. Sin este
-- cambio, la primera asesora (agent) invitada vería los leads de todas
-- las demás — incluidas respuestas de salud. Endurece la visibilidad:
--   owner/admin -> ven TODO (is_account_member(account_id,'admin'))
--   agent       -> ve SOLO lo suyo (asignado a auth.uid() o creado por él)
--
-- Cobertura (revisada contra el inventario completo de RLS, no solo las
-- 4 raíces — el council marcó que faltaban tablas):
--   RAÍCES aisladas acá: deals, conversations, contacts, leads.
--   HIJAS reescritas acá: contact_notes, lead_capi_events (chequeaban
--     account_id directo → no cascadeaban).
--   HIJAS que CASCADEAN SOLAS (no se tocan): contact_custom_values,
--     contact_tags, messages, message_reactions, broadcast_recipients —
--     su policy ya es EXISTS sobre la raíz, y esa subconsulta queda
--     sujeta a la RLS ya endurecida de la raíz. (Verificar en el gate de
--     dos usuarios reales.)
--   CONFIG sensible endurecida a admin-only en SELECT: whatsapp_config,
--     api_keys, webhook_endpoints (hoy cualquier miembro las leía).
--   COMPARTIDAS a propósito (catálogos + telemetría de cuenta, no se
--     tocan): tags, custom_fields, pipelines, pipeline_stages,
--     message_templates, quick_messages, lead_sources, lead_capi_config,
--     automations, flows, broadcasts, lead_intake_errors, lead_sync_runs,
--     member_presence. Ya aisladas por user_id: notifications,
--     push_subscriptions.
--
-- Writes automáticos (cron/CAPI) corren con service-role y bypasean RLS.
-- Idempotente. Cero impacto con un solo profile (owner cae en rama admin).
-- ============================================================

-- ------------------------------------------------------------
-- DEALS
-- ------------------------------------------------------------
DROP POLICY IF EXISTS deals_select ON deals;
DROP POLICY IF EXISTS deals_insert ON deals;
DROP POLICY IF EXISTS deals_update ON deals;
DROP POLICY IF EXISTS deals_delete ON deals;

CREATE POLICY deals_select ON deals FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id)
      AND (assigned_agent_id = auth.uid() OR user_id = auth.uid()))
);
CREATE POLICY deals_insert ON deals FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent') AND user_id = auth.uid()
);
CREATE POLICY deals_update ON deals FOR UPDATE USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id, 'agent')
      AND (assigned_agent_id = auth.uid() OR user_id = auth.uid()))
);
CREATE POLICY deals_delete ON deals FOR DELETE USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id, 'agent')
      AND (assigned_agent_id = auth.uid() OR user_id = auth.uid()))
);

-- ------------------------------------------------------------
-- CONVERSATIONS
-- ------------------------------------------------------------
DROP POLICY IF EXISTS conversations_select ON conversations;
DROP POLICY IF EXISTS conversations_insert ON conversations;
DROP POLICY IF EXISTS conversations_update ON conversations;
DROP POLICY IF EXISTS conversations_delete ON conversations;

CREATE POLICY conversations_select ON conversations FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id)
      AND (assigned_agent_id = auth.uid() OR user_id = auth.uid()))
);
CREATE POLICY conversations_insert ON conversations FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent') AND user_id = auth.uid()
);
CREATE POLICY conversations_update ON conversations FOR UPDATE USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id, 'agent')
      AND (assigned_agent_id = auth.uid() OR user_id = auth.uid()))
);
CREATE POLICY conversations_delete ON conversations FOR DELETE USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id, 'agent')
      AND (assigned_agent_id = auth.uid() OR user_id = auth.uid()))
);

-- ------------------------------------------------------------
-- CONTACTS — sin assigned_agent_id: visibilidad derivada de tener un
-- deal/conversation asignado para ese contacto (o haberlo creado).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS contacts_select ON contacts;
DROP POLICY IF EXISTS contacts_insert ON contacts;
DROP POLICY IF EXISTS contacts_update ON contacts;
DROP POLICY IF EXISTS contacts_delete ON contacts;

CREATE POLICY contacts_select ON contacts FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id) AND (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = contacts.id AND d.assigned_agent_id = auth.uid())
    OR EXISTS (SELECT 1 FROM conversations c WHERE c.contact_id = contacts.id AND c.assigned_agent_id = auth.uid())
  ))
);
CREATE POLICY contacts_insert ON contacts FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent') AND user_id = auth.uid()
);
CREATE POLICY contacts_update ON contacts FOR UPDATE USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id, 'agent') AND (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = contacts.id AND d.assigned_agent_id = auth.uid())
    OR EXISTS (SELECT 1 FROM conversations c WHERE c.contact_id = contacts.id AND c.assigned_agent_id = auth.uid())
  ))
);
CREATE POLICY contacts_delete ON contacts FOR DELETE USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id, 'agent') AND (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = contacts.id AND d.assigned_agent_id = auth.uid())
    OR EXISTS (SELECT 1 FROM conversations c WHERE c.contact_id = contacts.id AND c.assigned_agent_id = auth.uid())
  ))
);

-- ------------------------------------------------------------
-- LEADS — sin user_id ni creación manual: visibilidad 100% derivada de
-- a quién esté asignado su deal_id.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS leads_select ON leads;
DROP POLICY IF EXISTS leads_update ON leads;

CREATE POLICY leads_select ON leads FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id) AND EXISTS (
    SELECT 1 FROM deals d WHERE d.id = leads.deal_id AND d.assigned_agent_id = auth.uid()
  ))
);
CREATE POLICY leads_update ON leads FOR UPDATE USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id, 'agent') AND EXISTS (
    SELECT 1 FROM deals d WHERE d.id = leads.deal_id AND d.assigned_agent_id = auth.uid()
  ))
);

-- ------------------------------------------------------------
-- CONTACT_NOTES — chequeaba is_account_member(account_id) directo (no
-- cascadeaba). Reescrita para derivar de la visibilidad del contacto.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS contact_notes_select ON contact_notes;
CREATE POLICY contact_notes_select ON contact_notes FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id) AND EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = contact_notes.contact_id
      AND (
        c.user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.id AND d.assigned_agent_id = auth.uid())
        OR EXISTS (SELECT 1 FROM conversations cv WHERE cv.contact_id = c.id AND cv.assigned_agent_id = auth.uid())
      )
  ))
);

-- ------------------------------------------------------------
-- LEAD_CAPI_EVENTS — PII + conversiones. Chequeaba account_id directo.
-- Reescrita para derivar via lead -> deal -> assigned_agent_id.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS lead_capi_events_select ON lead_capi_events;
CREATE POLICY lead_capi_events_select ON lead_capi_events FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id) AND EXISTS (
    SELECT 1 FROM leads l JOIN deals d ON d.id = l.deal_id
    WHERE l.id = lead_capi_events.lead_id AND d.assigned_agent_id = auth.uid()
  ))
);

-- ------------------------------------------------------------
-- CONFIG SENSIBLE — endurecer SELECT a admin-only (hoy cualquier miembro
-- leía la fila; secretos van cifrados/hasheados, pero un agent no tiene
-- por qué leer la config de WhatsApp, las API keys ni los webhooks).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS whatsapp_config_select ON whatsapp_config;
CREATE POLICY whatsapp_config_select ON whatsapp_config FOR SELECT USING (
  is_account_member(account_id, 'admin')
);

DROP POLICY IF EXISTS api_keys_select ON api_keys;
CREATE POLICY api_keys_select ON api_keys FOR SELECT USING (
  is_account_member(account_id, 'admin')
);

DROP POLICY IF EXISTS webhook_endpoints_select ON webhook_endpoints;
CREATE POLICY webhook_endpoints_select ON webhook_endpoints FOR SELECT USING (
  is_account_member(account_id, 'admin')
);
