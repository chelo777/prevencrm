'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag, ContactNote, CustomField, ContactCustomValue, Deal, MessageTemplate } from '@/types';
import {
  TemplatePicker,
  type TemplateSendValues,
} from '@/components/inbox/template-picker';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Phone,
  Mail,
  Building2,
  Copy,
  Check,
  Loader2,
  Plus,
  Trash2,
  Save,
  X,
  LayoutTemplate,
  ChevronDown,
} from 'lucide-react';
import { humanizeFieldName, humanizeFormValue } from '@/lib/leads/humanize';

interface ContactDetailViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  onUpdated: () => void;
  /** Tab inicial. Desde un lead se abre en "form" para ver las
   *  respuestas del formulario primero. Default: "details". */
  defaultTab?: string;
}

interface StageOption {
  id: string;
  name: string;
  color: string;
}

// Capitas (VBO): entero 1–20. Vale para el input local y como requisito
// para mover un deal a "Calificado" (el CAPI manda custom_data.value con
// este número; si es null, Task 6 omite el value).
function isValidCapitas(raw: string): boolean {
  if (!raw.trim()) return false;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 20;
}

export function ContactDetailView({
  open,
  onOpenChange,
  contactId,
  onUpdated,
  defaultTab = 'details',
}: ContactDetailViewProps) {
  const supabase = createClient();
  const { accountId, canManageMembers } = useAuth();

  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Send template — lets the business initiate (or re-open) a conversation
  // with this contact by sending an approved template. The send route
  // find-or-creates the conversation, so no inbound message is required.
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(false);

  // Details tab
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  // Tags tab
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [contactTagIds, setContactTagIds] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  // Notes tab
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Custom fields tab
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [savingCustom, setSavingCustom] = useState(false);
  const [loadingCustom, setLoadingCustom] = useState(false);

  // Deals tab
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);

  // Estado (etapa) editable en el header, sobre el deal más reciente.
  const [stages, setStages] = useState<StageOption[]>([]);
  const [headerStageId, setHeaderStageId] = useState('');

  // Reasignación (solo admin): asesoras compradoras + a quién está el deal.
  const [asesoras, setAsesoras] = useState<
    { user_id: string; full_name: string | null }[]
  >([]);
  const [assignedAgentId, setAssignedAgentId] = useState('');

  // Capitas (VBO) — requisito para mover el deal a "Calificado" (Task 9).
  const [capitas, setCapitas] = useState<string>('');
  const [savingCapitas, setSavingCapitas] = useState(false);
  const [capitasWarning, setCapitasWarning] = useState(false);

  const fetchContact = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);

    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .single();

    if (data) {
      setContact(data);
      setEditName(data.name ?? '');
      setEditPhone(data.phone);
      setEditEmail(data.email ?? '');
      setEditCompany(data.company ?? '');
    }
    setLoading(false);
  }, [contactId, supabase]);

  const fetchTags = useCallback(async () => {
    if (!contactId) return;

    const [tagsRes, contactTagsRes] = await Promise.all([
      supabase.from('tags').select('*').order('name'),
      supabase.from('contact_tags').select('tag_id').eq('contact_id', contactId),
    ]);

    if (tagsRes.data) setAllTags(tagsRes.data);
    if (contactTagsRes.data) {
      setContactTagIds(contactTagsRes.data.map((ct) => ct.tag_id));
    }
  }, [contactId, supabase]);

  const fetchNotes = useCallback(async () => {
    if (!contactId) return;
    setLoadingNotes(true);

    const { data } = await supabase
      .from('contact_notes')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });

    if (data) setNotes(data);
    setLoadingNotes(false);
  }, [contactId, supabase]);

  const fetchCustomFields = useCallback(async () => {
    if (!contactId) return;
    setLoadingCustom(true);

    const [fieldsRes, valuesRes] = await Promise.all([
      supabase.from('custom_fields').select('*').order('field_name'),
      supabase
        .from('contact_custom_values')
        .select('*')
        .eq('contact_id', contactId),
    ]);

    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v) => {
        map[v.custom_field_id] = v.value ?? '';
      });
      setCustomValues(map);
    }
    setLoadingCustom(false);
  }, [contactId, supabase]);

  const fetchDeals = useCallback(async () => {
    if (!contactId) return;
    setLoadingDeals(true);
    const { data } = await supabase
      .from('deals')
      .select('*, capitas, stage:pipeline_stages(*)')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    setDeals((data ?? []) as Deal[]);
    const first = (data ?? [])[0];
    if (first) {
      setHeaderStageId(first.stage_id as string);
      setAssignedAgentId((first.assigned_agent_id as string | null) ?? '');
      const rawCapitas = (first.capitas as number | null) ?? null;
      setCapitas(rawCapitas != null ? String(rawCapitas) : '');
      setCapitasWarning(false);
    }
    setLoadingDeals(false);
  }, [contactId, supabase]);

  // Asesoras compradoras (para el selector de reasignación del admin).
  const fetchAsesoras = useCallback(async () => {
    if (!accountId || !canManageMembers) return;
    const { data } = await supabase
      .from('profiles')
      .select('user_id, full_name')
      .eq('account_id', accountId)
      .eq('is_lead_buyer', true)
      .order('full_name');
    setAsesoras((data ?? []) as { user_id: string; full_name: string | null }[]);
  }, [accountId, canManageMembers, supabase]);

  // Registra una acción en el event log (append-only). Best-effort: si
  // falla, no rompe la acción principal (RLS exige user_id = auth.uid()).
  const logActivity = useCallback(
    async (action: string, dealId: string | null, meta?: Record<string, unknown>) => {
      if (!accountId) return;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      await supabase.from('activity_log').insert({
        account_id: accountId,
        user_id: uid,
        deal_id: dealId,
        action,
        meta: meta ?? null,
      });
    },
    [accountId, supabase],
  );

  // Catálogo de etapas de la cuenta, para el select de estado del header.
  const fetchStages = useCallback(async () => {
    if (!accountId) return;
    const { data } = await supabase
      .from('pipelines')
      .select('stages:pipeline_stages(id, name, color, position)')
      .eq('account_id', accountId);
    const flat = (data ?? [])
      .flatMap(
        (p) =>
          (p.stages ?? []) as {
            id: string;
            name: string;
            color: string;
            position: number;
          }[],
      )
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ id: s.id, name: s.name, color: s.color }));
    setStages(flat);
  }, [accountId, supabase]);

  useEffect(() => {
    if (open && contactId) {
      fetchContact();
      fetchTags();
      fetchNotes();
      fetchCustomFields();
      fetchDeals();
      fetchStages();
      fetchAsesoras();
    }
  }, [open, contactId, fetchContact, fetchTags, fetchNotes, fetchCustomFields, fetchDeals, fetchStages, fetchAsesoras]);

  async function changeStage(nextStageId: string) {
    const primary = deals[0];
    if (!primary || !nextStageId || nextStageId === headerStageId) return;

    // Gate: mover a "Calificado" requiere capitas válida (1–20). El CAPI
    // (Task 6) manda custom_data.value=capitas al llegar a esa etapa y el
    // cron sella el evento en el primer envío, así que tiene que estar
    // cargada ANTES del movimiento. Nada de window.prompt — bloqueo con
    // toast + aviso inline sobre el input de capitas.
    const targetStage = stages.find((s) => s.id === nextStageId);
    if (targetStage?.name === 'Calificado' && !isValidCapitas(capitas)) {
      toast.error('Cargá las capitas antes de calificar', {
        description: 'Ingresá un número entero de 1 a 20 en "Capitas" (tab Deals) y guardá.',
      });
      setCapitasWarning(true);
      return;
    }

    const prev = headerStageId;
    setHeaderStageId(nextStageId); // optimista
    const { error } = await supabase
      .from('deals')
      .update({ stage_id: nextStageId })
      .eq('id', primary.id);
    if (error) {
      setHeaderStageId(prev);
      toast.error('No se pudo cambiar la etapa');
    } else {
      setCapitasWarning(false);
      logActivity('stage_change', primary.id, { stage_id: nextStageId });
      fetchDeals(); // mantiene la tab Deals en sync
      onUpdated();
    }
  }

  // Guarda capitas validadas (entero 1–20) sobre el deal principal.
  async function saveCapitas() {
    const primary = deals[0];
    if (!primary) return;
    if (!isValidCapitas(capitas)) {
      toast.error('Capitas debe ser un número entero de 1 a 20');
      return;
    }
    setSavingCapitas(true);
    const { error } = await supabase
      .from('deals')
      .update({ capitas: Number(capitas) })
      .eq('id', primary.id);
    if (error) {
      toast.error('No se pudieron guardar las capitas');
    } else {
      toast.success('Capitas guardadas');
      setCapitasWarning(false);
      fetchDeals();
    }
    setSavingCapitas(false);
  }

  // Reasignar el deal a otra asesora (admin). Actualiza assigned_agent_id
  // y registra la acción en el event log.
  async function reassign(nextAgentId: string) {
    const primary = deals[0];
    if (!primary || nextAgentId === assignedAgentId) return;
    const prev = assignedAgentId;
    setAssignedAgentId(nextAgentId); // optimista
    const { error } = await supabase
      .from('deals')
      .update({ assigned_agent_id: nextAgentId || null })
      .eq('id', primary.id);
    if (error) {
      setAssignedAgentId(prev);
      toast.error('No se pudo reasignar');
    } else {
      logActivity('reassigned', primary.id, { assigned_agent_id: nextAgentId });
      toast.success('Lead reasignado');
      fetchDeals();
      onUpdated();
    }
  }

  async function copyPhone() {
    if (!contact) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  }

  async function saveDetails() {
    if (!contactId || !editPhone.trim()) {
      toast.error('El teléfono es obligatorio');
      return;
    }

    setSavingDetails(true);
    const { error } = await supabase
      .from('contacts')
      .update({
        name: editName.trim() || null,
        phone: editPhone.trim(),
        email: editEmail.trim() || null,
        company: editCompany.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId);

    if (error) {
      toast.error('No se pudo actualizar el contacto');
    } else {
      toast.success('Contacto actualizado');
      fetchContact();
      onUpdated();
    }
    setSavingDetails(false);
  }

  async function toggleTag(tagId: string) {
    if (!contactId) return;
    setSavingTags(true);

    const isSelected = contactTagIds.includes(tagId);

    if (isSelected) {
      const { error } = await supabase
        .from('contact_tags')
        .delete()
        .eq('contact_id', contactId)
        .eq('tag_id', tagId);
      if (!error) {
        setContactTagIds((prev) => prev.filter((id) => id !== tagId));
        onUpdated();
      }
    } else {
      const { error } = await supabase
        .from('contact_tags')
        .insert({ contact_id: contactId, tag_id: tagId });
      if (!error) {
        setContactTagIds((prev) => [...prev, tagId]);
        onUpdated();
      }
    }
    setSavingTags(false);
  }

  async function addNote() {
    if (!contactId || !newNote.trim()) return;
    setSavingNote(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user || !accountId) {
      toast.error('No hay sesión iniciada');
      setSavingNote(false);
      return;
    }

    const { error } = await supabase.from('contact_notes').insert({
      contact_id: contactId,
      account_id: accountId,
      user_id: user.id,
      note_text: newNote.trim(),
    });

    if (error) {
      toast.error('No se pudo agregar la nota');
    } else {
      setNewNote('');
      fetchNotes();
      toast.success('Nota agregada');
    }
    setSavingNote(false);
  }

  async function deleteNote(noteId: string) {
    const { error } = await supabase
      .from('contact_notes')
      .delete()
      .eq('id', noteId);

    if (error) {
      toast.error('No se pudo borrar la nota');
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success('Nota borrada');
    }
  }

  async function saveCustomFields() {
    if (!contactId) return;
    setSavingCustom(true);

    try {
      // Delete existing values and re-insert
      await supabase
        .from('contact_custom_values')
        .delete()
        .eq('contact_id', contactId);

      const rows = Object.entries(customValues)
        .filter(([, val]) => val.trim())
        .map(([fieldId, val]) => ({
          contact_id: contactId,
          custom_field_id: fieldId,
          value: val.trim(),
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('contact_custom_values')
          .insert(rows);
        if (error) throw error;
      }

      toast.success('Campos personalizados guardados');
    } catch {
      toast.error('No se pudieron guardar los campos personalizados');
    }
    setSavingCustom(false);
  }

  async function handleSendTemplate(
    template: MessageTemplate,
    values: TemplateSendValues,
  ) {
    if (!contactId) return;
    setSendingTemplate(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // No conversation_id — the route find-or-creates one for this
          // contact, mirroring the inbox template-send payload otherwise.
          contact_id: contactId,
          message_type: 'template',
          template_name: template.name,
          template_language: template.language,
          template_message_params: {
            body: values.body,
            headerText: values.headerText,
            buttonParams: values.buttonParams,
          },
          template_params: values.body,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason = payload?.error || `HTTP ${res.status}`;
        toast.error(`No se pudo enviar la plantilla: ${reason}`);
        return;
      }

      toast.success(`Plantilla "${template.name}" enviada`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'error de red';
      toast.error(`No se pudo enviar la plantilla: ${reason}`);
    } finally {
      setSendingTemplate(false);
    }
  }

  function getInitials(name?: string | null) {
    if (!name) return '?';
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-lg w-full p-0"
      >
        {loading || !contact ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Header */}
            <SheetHeader className="p-4 border-b border-border/50">
              <div className="flex items-center gap-3">
                <Avatar className="size-12 bg-muted border border-border">
                  <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                    {getInitials(contact.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <SheetTitle className="text-popover-foreground truncate">
                    {contact.name || 'Desconocido'}
                  </SheetTitle>
                  <SheetDescription className="text-muted-foreground text-xs mt-0.5">
                    Detalle del contacto
                  </SheetDescription>
                  <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                    <button
                      onClick={copyPhone}
                      className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
                    >
                      <Phone className="size-3" />
                      {contact.phone}
                      {copiedPhone ? (
                        <Check className="size-3 text-primary" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </button>
                    {contact.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="size-3" />
                        {contact.email}
                      </span>
                    )}
                    {contact.company && (
                      <span className="flex items-center gap-1">
                        <Building2 className="size-3" />
                        {contact.company}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {deals[0] && stages.length > 0 && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Estado</span>
                  {(() => {
                    const color =
                      stages.find((s) => s.id === headerStageId)?.color ??
                      '#94a3b8';
                    return (
                      <span className="relative inline-flex">
                        <select
                          value={headerStageId}
                          onChange={(e) => changeStage(e.target.value)}
                          aria-label="Cambiar etapa"
                          className="cursor-pointer appearance-none rounded-full py-1 pl-2.5 pr-6 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          style={{ backgroundColor: `${color}22`, color }}
                        >
                          {stages.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          aria-hidden
                          className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2"
                          style={{ color }}
                        />
                      </span>
                    );
                  })()}
                </div>
              )}
              {canManageMembers && deals[0] && asesoras.length > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Asignada a
                  </span>
                  <select
                    value={assignedAgentId}
                    onChange={(e) => reassign(e.target.value)}
                    aria-label="Reasignar lead"
                    className="cursor-pointer rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Sin asignar</option>
                    {asesoras.map((a) => (
                      <option key={a.user_id} value={a.user_id}>
                        {a.full_name || a.user_id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="mt-3">
                <Button
                  size="sm"
                  onClick={() => setTemplatePickerOpen(true)}
                  disabled={sendingTemplate}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {sendingTemplate ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <LayoutTemplate className="size-4" />
                  )}
                  Enviar plantilla
                </Button>
              </div>
            </SheetHeader>

            {/* Tabs */}
            <Tabs
              key={contactId ?? 'none'}
              defaultValue={defaultTab}
              className="flex-1 flex flex-col min-h-0"
            >
              <TabsList className="bg-muted/50 border-b border-border mx-4 mt-3">
                <TabsTrigger
                  value="form"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  Formulario
                </TabsTrigger>
                <TabsTrigger
                  value="details"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  Detalles
                </TabsTrigger>
                <TabsTrigger
                  value="tags"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  Etiquetas
                </TabsTrigger>
                <TabsTrigger
                  value="notes"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  Notas
                </TabsTrigger>
                <TabsTrigger
                  value="custom"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  Campos personalizados
                </TabsTrigger>
                <TabsTrigger
                  value="deals"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  Deals
                </TabsTrigger>
              </TabsList>

              {/* Formulario Tab — respuestas del lead, legibles y read-only */}
              <TabsContent value="form" className="flex-1 overflow-y-auto px-4 py-3">
                {loadingCustom ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  (() => {
                    const formRows = customFields
                      .map((f) => ({
                        name: f.field_name,
                        value: customValues[f.id] ?? '',
                      }))
                      .filter(
                        (r) =>
                          r.value.trim() &&
                          r.name.trim().toLowerCase() !== 'id',
                      )
                      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
                    if (formRows.length === 0) {
                      return (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                          Este lead no cargó respuestas en el formulario.
                        </p>
                      );
                    }
                    return (
                      <dl className="space-y-2">
                        {formRows.map((r) => (
                          <div
                            key={r.name}
                            className="rounded-lg border border-border/50 bg-muted/50 p-3"
                          >
                            <dt className="text-xs text-muted-foreground">
                              {humanizeFieldName(r.name)}
                            </dt>
                            <dd className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">
                              {humanizeFormValue(r.value)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    );
                  })()
                )}
              </TabsContent>

              {/* Details Tab */}
              <TabsContent value="details" className="flex-1 overflow-y-auto px-4 py-3">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">Nombre</Label>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">
                      Teléfono <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">Email</Label>
                    <Input
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">Empresa</Label>
                    <Input
                      value={editCompany}
                      onChange={(e) => setEditCompany(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <Button
                    onClick={saveDetails}
                    disabled={savingDetails}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                    size="sm"
                  >
                    {savingDetails ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    Guardar cambios
                  </Button>
                </div>
              </TabsContent>

              {/* Tags Tab */}
              <TabsContent value="tags" className="flex-1 overflow-y-auto px-4 py-3">
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Tocá una etiqueta para agregarla o quitarla de este contacto.
                  </p>
                  {allTags.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No hay etiquetas. Creá etiquetas en Configuración.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {allTags.map((tag) => {
                        const selected = contactTagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            onClick={() => toggleTag(tag.id)}
                            disabled={savingTags}
                            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
                              selected
                                ? 'ring-2 ring-primary ring-offset-1 ring-offset-border'
                                : 'opacity-50 hover:opacity-80'
                            }`}
                            style={{
                              backgroundColor: tag.color + '20',
                              color: tag.color,
                            }}
                          >
                            {selected && <Check className="size-3 mr-1" />}
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Notes Tab */}
              <TabsContent value="notes" className="flex-1 flex flex-col min-h-0 px-4 py-3">
                <div className="space-y-2 mb-3">
                  <Textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Escribí una nota…"
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground min-h-[60px] text-sm resize-none"
                  />
                  <Button
                    onClick={addNote}
                    disabled={!newNote.trim() || savingNote}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    size="sm"
                  >
                    {savingNote ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Plus className="size-3.5" />
                    )}
                    Agregar nota
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2">
                  {loadingNotes ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : notes.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      Todavía no hay notas.
                    </p>
                  ) : (
                    notes.map((note) => (
                      <div
                        key={note.id}
                        className="rounded-lg bg-muted/50 border border-border/50 p-3 group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap flex-1">
                            {note.note_text}
                          </p>
                          <button
                            onClick={() => deleteNote(note.id)}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all cursor-pointer shrink-0"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1.5">
                          {new Date(note.created_at).toLocaleDateString('es-AR', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>

              {/* Custom Fields Tab */}
              <TabsContent value="custom" className="flex-1 overflow-y-auto px-4 py-3">
                {loadingCustom ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : customFields.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No hay campos personalizados. Creálos en Configuración.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {customFields.map((field) => (
                      <div key={field.id} className="space-y-1.5">
                        <Label className="text-muted-foreground text-xs capitalize">
                          {field.field_name}
                        </Label>
                        <Input
                          value={customValues[field.id] ?? ''}
                          onChange={(e) =>
                            setCustomValues((prev) => ({
                              ...prev,
                              [field.id]: e.target.value,
                            }))
                          }
                          placeholder={`Ingresá ${field.field_name}…`}
                          className="bg-muted border-border text-foreground h-8 text-sm placeholder:text-muted-foreground"
                        />
                      </div>
                    ))}
                    <Button
                      onClick={saveCustomFields}
                      disabled={savingCustom}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                      size="sm"
                    >
                      {savingCustom ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                      Guardar campos personalizados
                    </Button>
                  </div>
                )}
              </TabsContent>

              {/* Deals Tab */}
              <TabsContent value="deals" className="flex-1 overflow-y-auto px-4 py-3">
                {loadingDeals ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-primary" />
                  </div>
                ) : deals.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Todavía no hay deals</p>
                ) : (
                  <div className="space-y-2">
                    <div
                      className={`rounded-lg border p-3 ${
                        capitasWarning
                          ? 'border-red-400 bg-red-400/5'
                          : 'border-border bg-muted/50'
                      }`}
                    >
                      <Label
                        htmlFor="deal-capitas"
                        className="text-muted-foreground text-xs"
                      >
                        Capitas
                      </Label>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Input
                          id="deal-capitas"
                          type="number"
                          min={1}
                          max={20}
                          step={1}
                          value={capitas}
                          onChange={(e) => {
                            setCapitas(e.target.value);
                            setCapitasWarning(false);
                          }}
                          placeholder="1–20"
                          className="bg-muted border-border text-foreground h-8 w-24 text-sm"
                        />
                        <Button
                          onClick={saveCapitas}
                          disabled={savingCapitas}
                          size="sm"
                          className="bg-primary hover:bg-primary/90 text-primary-foreground"
                        >
                          {savingCapitas ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Save className="size-3.5" />
                          )}
                          Guardar
                        </Button>
                      </div>
                      {capitasWarning && (
                        <p className="mt-1.5 text-xs text-red-400">
                          Cargá un número entero de 1 a 20 para poder calificar este lead.
                        </p>
                      )}
                    </div>
                    {deals.map((deal) => (
                      <div
                        key={deal.id}
                        className="rounded-lg border border-border bg-muted/50 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {deal.title}
                          </p>
                          {deal.stage && (
                            <span
                              className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor: `${deal.stage.color}20`,
                                color: deal.stage.color,
                              }}
                            >
                              {deal.stage.name}
                            </span>
                          )}
                        </div>
                        {deal.status && deal.status !== 'open' && (
                          <div className="mt-1.5 flex items-center justify-end text-xs">
                            <span
                              className={
                                deal.status === 'won'
                                  ? 'text-primary'
                                  : 'text-red-400'
                              }
                            >
                              {deal.status === 'won' ? 'Ganado' : 'Perdido'}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
    <TemplatePicker
      open={templatePickerOpen}
      onOpenChange={setTemplatePickerOpen}
      onSelect={handleSendTemplate}
    />
    </>
  );
}
