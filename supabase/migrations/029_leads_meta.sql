-- ============================================================
-- 029_leads_meta
--
-- Módulo "Leads Meta": ingesta de Meta Lead Ads (Instant Forms)
-- hacia el flujo nativo de prevencrm (contacto + deal + asignación
-- + notificación) y feedback de conversión a Meta (CAPI).
--
-- Todo ADITIVO. No modifica el comportamiento de tablas existentes
-- salvo dos extensiones aditivas y seguras:
--   * deals        +assigned_agent_id  (para asignar un lead a un asesor)
--   * notifications +deal_id, +type 'lead_assigned'
--
-- Diseño: docs/superpowers/specs/2026-07-01-modulo-leads-meta-design-v2.md
-- Sigue el patrón multi-tenant de 017 (account_id + is_account_member())
-- y la dedupe de teléfono de 022 (contacts.phone_normalized).
-- ============================================================

-- ------------------------------------------------------------
-- 1) Extensiones aditivas a tablas existentes
-- ------------------------------------------------------------

-- Un deal puede quedar asignado a un asesor (antes solo las
-- conversations tenían assigned_agent_id). Nullable: los deals ya
-- existentes quedan sin asignar, sin romper nada.
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS assigned_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deals_assigned_agent ON deals(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_deals_account_pipeline_status
  ON deals(account_id, pipeline_id, status);

-- notifications: nuevo tipo 'lead_assigned' + referencia opcional al deal.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE CASCADE;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'lead_assigned'));

-- ------------------------------------------------------------
-- 2) lead_sources — cada hoja/fuente + su config de mapeo
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Usuario "dueño" de la fuente; se estampa en contacts.user_id /
  -- deals.user_id de los leads ingestados (esas columnas son NOT NULL
  -- y la ingesta corre con service-role, sin auth.uid()).
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'google_sheet'
    CHECK (kind IN ('google_sheet', 'meta_webhook', 'manual')),
  spreadsheet_id TEXT,
  sheet_gid TEXT,
  -- Overrides opcionales de mapeo. Si es NULL/{} el adaptador
  -- auto-detecta todo (id por contenido `l:`, phone por `p:`,
  -- resto por header; desconocidos -> custom fields). Forma:
  --   { "canonical": {"name":"full_name", ...},
  --     "custom": {"<header>":"<field_name>"} }
  column_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  default_stage_id UUID NOT NULL REFERENCES pipeline_stages(id),
  -- Auto-asignación round-robin least-loaded (true) vs. dejar sin
  -- asignar para reparto manual / cola "pull" (false).
  auto_assign BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_sources_account ON lead_sources(account_id);
CREATE INDEX IF NOT EXISTS idx_lead_sources_active
  ON lead_sources(active) WHERE active;

ALTER TABLE lead_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_sources_select ON lead_sources;
DROP POLICY IF EXISTS lead_sources_insert ON lead_sources;
DROP POLICY IF EXISTS lead_sources_update ON lead_sources;
DROP POLICY IF EXISTS lead_sources_delete ON lead_sources;
CREATE POLICY lead_sources_select ON lead_sources FOR SELECT USING (is_account_member(account_id));
CREATE POLICY lead_sources_insert ON lead_sources FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY lead_sources_update ON lead_sources FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY lead_sources_delete ON lead_sources FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- 3) leads — el lead + atribución + control de idempotencia
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_id UUID REFERENCES lead_sources(id) ON DELETE SET NULL,
  -- Clave de dedupe. NOT NULL: las filas sin un `l:...` válido NUNCA
  -- llegan acá (van a lead_intake_errors), así el UNIQUE no tiene el
  -- agujero de los NULL. UNIQUE(account_id, meta_lead_id) abajo.
  meta_lead_id TEXT NOT NULL,
  -- 'claimed' = reservado (claim-first, antes de crear contacto/deal);
  -- 'processed' = contacto+deal creados. Ante crash entre medio, el
  -- próximo ciclo retoma el 'claimed' sin duplicar el deal.
  status TEXT NOT NULL DEFAULT 'claimed'
    CHECK (status IN ('claimed', 'processed')),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  -- El teléfono no se pudo normalizar con confianza: el lead se crea
  -- igual (no se pierde) pero se marca para revisión y no va a WhatsApp.
  phone_valid BOOLEAN NOT NULL DEFAULT TRUE,
  -- Atribución de la campaña (para reporting / CAPI).
  platform TEXT,
  is_organic BOOLEAN,
  campaign_id TEXT,
  campaign_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  ad_id TEXT,
  ad_name TEXT,
  form_id TEXT,
  form_name TEXT,
  lead_created_time TIMESTAMPTZ,
  -- Fila original completa. CONTIENE PII sensible (salud). Acceso
  -- restringido por RLS a admin/owner; retención a definir (§9 spec).
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_account_meta_lead_id
  ON leads(account_id, meta_lead_id);
CREATE INDEX IF NOT EXISTS idx_leads_account_created
  ON leads(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_deal ON leads(deal_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(account_id, status);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leads_select ON leads;
DROP POLICY IF EXISTS leads_insert ON leads;
DROP POLICY IF EXISTS leads_update ON leads;
DROP POLICY IF EXISTS leads_delete ON leads;
-- Cualquier miembro ve los leads de su cuenta (la bandeja). Los
-- writes normales corren con service-role (bypassa RLS); igual damos
-- políticas coherentes para escrituras manuales de agentes.
CREATE POLICY leads_select ON leads FOR SELECT USING (is_account_member(account_id));
CREATE POLICY leads_insert ON leads FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY leads_update ON leads FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY leads_delete ON leads FOR DELETE USING (is_account_member(account_id, 'admin'));

-- Realtime para que la bandeja se actualice al vuelo.
ALTER TABLE leads REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'leads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE leads;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4) lead_intake_errors — cuarentena de filas no ingestables
--    (sin `l:...` válido, etc.). No ensucian el UNIQUE de leads.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_intake_errors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_id UUID REFERENCES lead_sources(id) ON DELETE SET NULL,
  raw_row JSONB,
  reason TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_intake_errors_account
  ON lead_intake_errors(account_id, created_at DESC);

ALTER TABLE lead_intake_errors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_intake_errors_select ON lead_intake_errors;
DROP POLICY IF EXISTS lead_intake_errors_update ON lead_intake_errors;
CREATE POLICY lead_intake_errors_select ON lead_intake_errors FOR SELECT USING (is_account_member(account_id));
CREATE POLICY lead_intake_errors_update ON lead_intake_errors FOR UPDATE USING (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- 5) lead_capi_events — una fila por evento de conversión a Meta
--    (B5). UNIQUE(lead_id, event_name) evita el doble envío.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_capi_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  -- Determinístico ({lead_id}:{event_name}) para que Meta deduplique
  -- server-side aunque reintentemos.
  event_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  sent_at TIMESTAMPTZ,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(lead_id, event_name)
);

CREATE INDEX IF NOT EXISTS idx_lead_capi_events_account
  ON lead_capi_events(account_id, status);

ALTER TABLE lead_capi_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_capi_events_select ON lead_capi_events;
CREATE POLICY lead_capi_events_select ON lead_capi_events FOR SELECT USING (is_account_member(account_id));
-- Insert/update solo por service-role (la reconciliación de CAPI).

-- ------------------------------------------------------------
-- 6) lead_capi_config — config de conversión por cuenta.
--    El TOKEN va por env (META_CAPI_ACCESS_TOKEN), NUNCA en la DB.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_capi_config (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  dataset_id TEXT,
  -- Nombre de la etapa del pipeline que dispara el envío (ej. "Calificado").
  trigger_stage_name TEXT NOT NULL DEFAULT 'Calificado',
  -- Evento estándar de Meta a enviar.
  event_name TEXT NOT NULL DEFAULT 'Lead'
    CHECK (event_name IN ('Lead', 'Qualified', 'Purchase', 'Schedule', 'Contact')),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE lead_capi_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_capi_config_select ON lead_capi_config;
DROP POLICY IF EXISTS lead_capi_config_insert ON lead_capi_config;
DROP POLICY IF EXISTS lead_capi_config_update ON lead_capi_config;
CREATE POLICY lead_capi_config_select ON lead_capi_config FOR SELECT USING (is_account_member(account_id));
CREATE POLICY lead_capi_config_insert ON lead_capi_config FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY lead_capi_config_update ON lead_capi_config FOR UPDATE USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- 7) lead_sync_runs — bitácora/health-check de cada corrida del cron
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_sync_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  source_id UUID REFERENCES lead_sources(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  rows_read INTEGER NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  quarantined INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  ok BOOLEAN NOT NULL DEFAULT TRUE,
  message TEXT
);

CREATE INDEX IF NOT EXISTS idx_lead_sync_runs_account
  ON lead_sync_runs(account_id, started_at DESC);

ALTER TABLE lead_sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_sync_runs_select ON lead_sync_runs;
CREATE POLICY lead_sync_runs_select ON lead_sync_runs FOR SELECT USING (is_account_member(account_id));

-- ------------------------------------------------------------
-- 8) Trigger: notificar al asesor cuando se le asigna un deal.
--    Espeja notify_conversation_assigned() de 027 pero sobre deals
--    (B9). SECURITY DEFINER: es la única vía de INSERT en notifications.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_lead_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Auto-asignación: nada que notificar.
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, deal_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    NEW.assigned_agent_id,
    'lead_assigned',
    NEW.id,
    NEW.contact_id,
    auth.uid(),
    'Nuevo lead asignado',
    COALESCE(v_actor_name, 'El sistema') || ' te asignó a '
      || COALESCE(v_contact_name, 'un contacto')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create lead assignment notification for deal %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_lead_assigned() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_deal_assigned ON deals;
CREATE TRIGGER on_deal_assigned
  AFTER INSERT OR UPDATE OF assigned_agent_id ON deals
  FOR EACH ROW EXECUTE FUNCTION notify_lead_assigned();

-- ------------------------------------------------------------
-- 9) RPC: crear (idempotente) el pipeline "Leads Prepaga" + etapas.
--    Se llama al dar de alta la primera fuente. Devuelve el pipeline_id.
--    SECURITY DEFINER + chequeo explícito de membresía admin.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION ensure_leads_prepaga_pipeline(
  p_account_id UUID,
  p_user_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline_id UUID;
  v_stage TEXT;
  v_pos INTEGER := 0;
  v_stages TEXT[] := ARRAY['Nuevo','Calificado','Cotizado','Closed-Won','Perdido','No-calificado'];
  v_colors TEXT[] := ARRAY['#3b82f6','#8b5cf6','#f59e0b','#10b981','#ef4444','#6b7280'];
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'not authorized for account %', p_account_id;
  END IF;

  SELECT id INTO v_pipeline_id
  FROM pipelines
  WHERE account_id = p_account_id AND name = 'Leads Prepaga'
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    INSERT INTO pipelines (account_id, user_id, name)
    VALUES (p_account_id, p_user_id, 'Leads Prepaga')
    RETURNING id INTO v_pipeline_id;

    FOREACH v_stage IN ARRAY v_stages LOOP
      INSERT INTO pipeline_stages (pipeline_id, name, position, color)
      VALUES (v_pipeline_id, v_stage, v_pos, v_colors[v_pos + 1]);
      v_pos := v_pos + 1;
    END LOOP;
  END IF;

  RETURN v_pipeline_id;
END;
$$;

ALTER FUNCTION ensure_leads_prepaga_pipeline(UUID, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION ensure_leads_prepaga_pipeline(UUID, UUID) TO authenticated, service_role;
