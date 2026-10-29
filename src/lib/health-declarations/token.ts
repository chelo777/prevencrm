// Token del enlace de la declaración (/ds/<token>). Solo server-side.
// 16 bytes base64url = 22 caracteres: corto para el mensaje de WhatsApp
// e imposible de adivinar. En la base se guarda solo el SHA-256.

import { createHash, randomBytes } from "node:crypto";

export function generateDeclarationToken(): string {
  return randomBytes(16).toString("base64url");
}

export function hashDeclarationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Descarta antes de tocar la base lo que no puede ser un token nuestro. */
export function isPlausibleDeclarationToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(token);
}
