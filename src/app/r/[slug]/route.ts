import { NextResponse } from "next/server";

// Redirect público asesora → su WhatsApp. Sortea el bloqueo de Meta a los
// links directos de WhatsApp en los formularios instantáneos: el thank-you
// apunta acá (nuestro dominio, que Meta sí acepta) y desde el server
// saltamos a api.whatsapp.com/send. NUNCA wa.me: su redirect rompe los
// emojis de 4 bytes (verificado). Mensaje precargado por asesora.

export const dynamic = "force-dynamic";

const MENSAJE_DEFAULT =
  "Hola, completé el formulario y me gustaría recibir asesoramiento personalizado";

interface Asesora {
  /** Dígitos E.164 sin "+", formato celular AR (549…). */
  phone: string;
  mensaje?: string;
}

// Mapa slug → asesora. Ampliar con las demás cuando tengan su número.
const ASESORAS: Record<string, Asesora> = {
  stefy: { phone: "5493512774629" },
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const asesora = ASESORAS[slug.trim().toLowerCase()];
  if (!asesora) {
    return new NextResponse("Asesora no encontrada", { status: 404 });
  }
  const text = encodeURIComponent(asesora.mensaje ?? MENSAJE_DEFAULT);
  const url = `https://api.whatsapp.com/send?phone=${asesora.phone}&text=${text}`;
  return NextResponse.redirect(url, 302);
}
