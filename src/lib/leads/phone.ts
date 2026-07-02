// ============================================================
// Normalización de teléfono para leads de Meta (Argentina).
//
// Unificada con la dedupe de 022: la clave canónica es "dígitos"
// (regexp_replace(phone, '\D','')), igual que contacts.phone_normalized.
// Guardamos en contacts.phone un E.164 best-effort ("+54...") cuyo
// derivado dígitos coincide con esa columna generada, así el UNIQUE
// (account_id, phone_normalized) deduplica correctamente.
//
// Realidad de las hojas (verificación 2026-07-01):
//   - prefijo "p:" constante  -> se quita
//   - la mayoría "p:+54379..." bien formado
//   - algunos malformados "p:+3624101510" (sin 54) -> se recupera
//     anteponiendo el código de país cuando el largo es de un número
//     local AR (10-11 dígitos).
// ============================================================

const AR_CC = "54";

export interface NormalizedPhone {
  /** E.164 best-effort ("+54..."), o null si no hay dígitos. */
  e164: string | null;
  /** Solo dígitos — la clave de dedupe (coincide con phone_normalized). */
  digits: string;
  /** true cuando el número tiene forma AR plausible; false => revisar. */
  valid: boolean;
}

/** Quita el prefijo "p:" que Meta antepone en las hojas. */
export function stripMetaPhonePrefix(raw: string): string {
  return raw.replace(/^\s*p:\s*/i, "").trim();
}

/**
 * Un E.164 argentino plausible: código de país 54 + 10 u 11 dígitos
 * (línea = 54+10=12; móvil con 9 = 54+9+10=13). Aceptamos 12–13.
 */
export function isPlausibleArgentineE164(digits: string): boolean {
  return /^54\d{10,11}$/.test(digits);
}

/**
 * Normaliza un teléfono crudo de una hoja de Meta a forma AR.
 * Nunca tira: si no puede confirmar el formato, devuelve el mejor
 * esfuerzo con `valid: false` para que el lead se marque a revisar.
 */
export function normalizeArgentinePhone(
  raw: string | null | undefined,
): NormalizedPhone {
  if (raw == null) return { e164: null, digits: "", valid: false };

  const stripped = stripMetaPhonePrefix(String(raw));
  let digits = stripped.replace(/\D/g, "");
  if (!digits) return { e164: null, digits: "", valid: false };

  // Prefijo internacional "00".
  if (digits.startsWith("00")) digits = digits.slice(2);

  if (!digits.startsWith(AR_CC)) {
    // Trunk 0 de discado nacional.
    digits = digits.replace(/^0+/, "");
    // Número local AR (área + abonado) ~ 10-11 dígitos -> anteponer 54.
    if (digits.length >= 10 && digits.length <= 11) {
      digits = AR_CC + digits;
    }
  }

  const valid = isPlausibleArgentineE164(digits);
  return { e164: "+" + digits, digits, valid };
}

/**
 * Construye el número para wa.me / click-to-chat. Para móviles AR
 * WhatsApp espera el "9" tras el 54 (54 9 área número). Si el número
 * viene sin el 9 y tiene largo de línea (12), lo insertamos; si ya
 * lo tiene o no es AR, se devuelve tal cual (solo dígitos).
 */
export function toWhatsAppNumber(digits: string): string {
  if (!digits) return "";
  if (digits.startsWith("54") && digits[2] !== "9" && digits.length === 12) {
    return "549" + digits.slice(2);
  }
  return digits;
}
