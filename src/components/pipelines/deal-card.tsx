"use client";

import { useState } from "react";
import type { Deal, PipelineStage } from "@/types";
import { Calendar, Check, MessageCircle, X } from "lucide-react";
import { toWhatsAppNumber } from "@/lib/leads/phone";
import { QuickSendSheet } from "@/components/quick-messages/quick-send-sheet";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

export function DealCard({ deal, stage, onEdit, isOverlay }: DealCardProps) {
  const [waOpen, setWaOpen] = useState(false);
  const contactName = deal.contact?.name?.trim() || null;
  const phone = deal.contact?.phone ?? null;
  const wa = toWhatsAppNumber(phone ? phone.replace(/\D/g, "") : "");
  // El módulo de leads titula el deal con el nombre del contacto — en
  // ese caso no repetimos el nombre en la línea de contacto.
  const showName = Boolean(
    contactName &&
      contactName.toLowerCase() !== deal.title.trim().toLowerCase(),
  );
  const assigneeLabel = deal.assignee?.full_name || null;

  return (
    <>
    <button
      type="button"
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      className={`group relative w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 pl-4 pr-3 py-2.5 text-left shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 text-sm font-semibold leading-snug text-foreground break-words">
          {deal.title}
        </h4>
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Check className="h-3 w-3" />
            Won
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            <X className="h-3 w-3" />
            Lost
          </span>
        )}
      </div>

      {/* Línea de contacto: nombre solo si difiere del título; teléfono
          como click-to-chat de WhatsApp; asignado a la derecha. */}
      {(showName || phone || assigneeLabel) && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-xs">
            {showName && (
              <span className="truncate text-muted-foreground">
                {contactName}
              </span>
            )}
            {phone &&
              (wa ? (
                <span
                  role="link"
                  title="Abrir WhatsApp"
                  onClick={(e) => {
                    e.stopPropagation();
                    setWaOpen(true);
                  }}
                  className="inline-flex shrink-0 items-center gap-1 text-emerald-500 hover:underline"
                >
                  <MessageCircle className="h-3 w-3" />
                  {phone}
                </span>
              ) : (
                <span className="shrink-0 text-muted-foreground">{phone}</span>
              ))}
          </span>
          {assigneeLabel && (
            <span
              title={assigneeLabel}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
            >
              {initials(assigneeLabel)}
            </span>
          )}
        </div>
      )}

      {deal.expected_close_date && (
        <div className="mt-1.5 flex items-center justify-end">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatDate(deal.expected_close_date)}
          </span>
        </div>
      )}
    </button>
    {wa && !isOverlay && (
      <QuickSendSheet
        open={waOpen}
        onOpenChange={setWaOpen}
        waNumber={wa}
        vars={{ nombre: contactName }}
      />
    )}
    </>
  );
}
