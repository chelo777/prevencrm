-- ============================================================
-- 037_agent_row_isolation.sql — aislamiento por asesor asignado
--
-- Handoff: docs/superpowers/specs/2026-07-13-router-multiasesor-handoff.md §3.1
--
-- Hoy is_account_member(account_id) alcanza para ver leads/deals/
-- contacts/conversations de TODA la cuenta — correcto para un CRM de
-- equipo compartido, pero este negocio VENDE leads exclusivos a cada
-- compradora. Sin este cambio, la primera agente invitada (Paula) vería
-- los leads de Fabi, Giuli y Ale — incluidas sus respuestas de salud.
--
-- Regla nueva (para las 4 tablas):
--   owner/admin        -> ven TODO (is_account_member(account_id,'admin'))
--   agent (o cualquiera) -> ve SOLO lo suyo:
--     deals/conversations : assigned_agent_id = auth.uid() OR user_id = auth.uid()
--     contacts            : user_id = auth.uid() OR tiene un deal/conversation asignado
--     leads               : su deal (via deal_id) está asignado a auth.uid()
--
-- El `OR user_id = auth.uid()` cubre al creador manual (el botón
-- "+Add Deal"/"+Add Contact" del Kanban, ajeno al flujo de compra de
-- leads) — sin esto, un agente dejaría de ver lo que él mismo crea a
-- mano apenas se activa el aislamiento.
--
-- Los writes automáticos (cron de ingesta, CAPI) corren con
-- service-role y bypasean RLS — esto solo endurece los accesos
-- manuales desde la UI. Cero impacto hoy: un solo profile (owner) en
-- toda la cuenta. Bloqueante antes de invitar a la primera compradora.
--
-- Idempotente — segura de correr múltiples veces.
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
  OR (
    is_account_member(account_id)
    AND (assigned_agent_id = auth.uid() OR user_id = auth.uid())
  )
);
CREATE POLICY deals_insert ON deals FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent') AND user_id = auth.uid()
);
CREATE POLICY deals_update ON deals FOR UPDATE USING (
  is_account_member(account_id, 'admin')
  OR (
    is_account_member(account_id, 'agent')
    AND (assigned_agent_id = auth.uid() OR user_id = auth.uid())
  )
);
CREATE POLICY deals_delete ON deals FOR DELETE USING (
  is_account_member(account_id, 'admin')
  OR (
    is_account_member(account_id, 'agent')
    AND (assigned_agent_id = auth.uid() OR user_id = auth.uid())
  )
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
  OR (
    is_account_member(account_id)
    AND (assigned_agent_id = auth.uid() OR user_id = auth.uid())
  )
);
CREATE POLICY conversations_insert ON conversations FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent') AND user_id = auth.uid()
);
CREATE POLICY conversations_update ON conversations FOR UPDATE USING (
  is_account_member(account_id, 'admin')
  OR (
    is_account_member(account_id, 'agent')
    AND (assigned_agent_id = auth.uid() OR user_id = auth.uid())
  )
);
CREATE POLICY conversations_delete ON conversations FOR DELETE USING (
  is_account_member(account_id, 'admin')
  OR (
    is_account_member(account_id, 'agent')
    AND (assigned_agent_id = auth.uid() OR user_id = auth.uid())
  )
);

-- ------------------------------------------------------------
-- CONTACTS
--
-- No tiene assigned_agent_id propio: la visibilidad se deriva de si
-- el agente tiene un deal o una conversation asignados para ese
-- contacto (o si él mismo lo creó a mano).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS contacts_select ON contacts;
DROP POLICY IF EXISTS contacts_insert ON contacts;
DROP POLICY IF EXISTS contacts_update ON contacts;
DROP POLICY IF EXISTS contacts_delete ON contacts;

CREATE POLICY contacts_select ON contacts FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR (
    is_account_member(account_id)
    AND (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM deals d
        WHERE d.contact_id = contacts.id AND d.assigned_agent_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.contact_id = contacts.id AND c.assigned_agent_id = auth.uid()
      )
    )
  )
);
CREATE POLICY contacts_insert ON contacts FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent') AND user_id = auth.uid()
);
CREATE POLICY contacts_update ON contacts FOR UPDATE USING (
  is_account_member(account_id, 'admin')
  OR (
    is_account_member(account_id, 'agent')
    AND (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM deals d
        WHERE d.contact_id = contacts.id AND d.assigned_agent_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.contact_id = contacts.id AND c.assigned_agent_id = auth.uid()
      )
    )
  )
);
CREATE POLICY contacts_delete ON contacts FOR DELETE USING (
  is_account_member(account_id, 'admin')
  OR (
    is_account_member(account_id, 'agent')
    AND (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM deals d
        WHERE d.contact_id = contacts.id AND d.assigned_agent_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.contact_id = contacts.id AND c.assigned_agent_id = auth.uid()
      )
    )
  )
);

-- ------------------------------------------------------------
-- LEADS
--
-- Sin user_id propio ni forma manual de crearlos en la UI (nacen del
-- cron de ingesta, con service-role) — la visibilidad depende
-- enteramente de a quién esté asignado su deal. leads_insert y
-- leads_delete no cambian (el insert es siempre service-role; el
-- delete ya era admin-only).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS leads_select ON leads;
DROP POLICY IF EXISTS leads_update ON leads;

CREATE POLICY leads_select ON leads FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR (
    is_account_member(account_id)
    AND EXISTS (
      SELECT 1 FROM deals d
      WHERE d.id = leads.deal_id AND d.assigned_agent_id = auth.uid()
    )
  )
);
CREATE POLICY leads_update ON leads FOR UPDATE USING (
  is_account_member(account_id, 'admin')
  OR (
    is_account_member(account_id, 'agent')
    AND EXISTS (
      SELECT 1 FROM deals d
      WHERE d.id = leads.deal_id AND d.assigned_agent_id = auth.uid()
    )
  )
);
