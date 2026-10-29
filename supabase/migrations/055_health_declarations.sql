-- ============================================================
-- 055_health_declarations.sql — Declaraciones de salud por enlace
--
-- El asesor genera desde el detalle del lead un enlace único
-- (/ds/<token>) y se lo manda por WhatsApp. El prospecto completa el
-- formulario en el celular (titular + grupo familiar, preguntas extra
-- para mujeres), toca "Guardar" y salta al WhatsApp del asesor con la
-- declaración ya escrita. La misma declaración queda como nota del
-- contacto, así se lee igual en el CRM y en WhatsApp.
--
-- 1) profiles.whatsapp_phone — el WhatsApp al que vuelve el prospecto.
--    Lo carga cada asesor en Ajustes → Tu perfil.
--
-- 2) health_declarations
--    - token_hash: SHA-256 del token del enlace; el token en claro nunca
--      se guarda (mismo patrón que account_invitations).
--    - advisor_phone: copia del WhatsApp del asesor al crear el enlace,
--      así la página pública no necesita leer profiles.
--    - answers / summary: DATOS DE SALUD. Igual que raw_payload de leads,
--      nunca salen del sistema hacia Meta (CAPI).
--
--    La página pública lee y responde con service role filtrando por
--    token_hash. Desde el cliente solo hay SELECT (con la misma
--    visibilidad que contact_notes) e INSERT del propio asesor: no hay
--    policies de UPDATE/DELETE, una declaración respondida no se edita.
--
-- Aditiva e idempotente.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT;

COMMENT ON COLUMN profiles.whatsapp_phone IS
  'WhatsApp del asesor en dígitos (549…). Destino de las declaraciones de salud respondidas.';

CREATE TABLE IF NOT EXISTS health_declarations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  advisor_phone TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted')),
  answers JSONB,
  summary TEXT,
  submitted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_health_declarations_token
  ON health_declarations(token_hash);
CREATE INDEX IF NOT EXISTS idx_health_declarations_contact
  ON health_declarations(contact_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON health_declarations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON health_declarations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE health_declarations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS health_declarations_select ON health_declarations;
DROP POLICY IF EXISTS health_declarations_insert ON health_declarations;

-- Misma visibilidad que contact_notes (037): admin todo, el asesor lo
-- de los contactos que tiene asignados.
CREATE POLICY health_declarations_select ON health_declarations FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id) AND EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = health_declarations.contact_id
      AND (
        c.user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.id AND d.assigned_agent_id = auth.uid())
        OR EXISTS (SELECT 1 FROM conversations cv WHERE cv.contact_id = c.id AND cv.assigned_agent_id = auth.uid())
      )
  ))
);

CREATE POLICY health_declarations_insert ON health_declarations FOR INSERT WITH CHECK (
  is_account_member(account_id) AND created_by = auth.uid()
);
