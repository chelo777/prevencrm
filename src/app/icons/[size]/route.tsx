import { ImageResponse } from "next/og";

// Íconos PWA (manifest + notificaciones push) generados en runtime con
// la misma marca que src/app/icon.tsx — cuadrado violeta + globo de
// chat. Fondo a sangre completa (sin borde redondeado propio): Android
// aplica su máscara y así sirve tanto para purpose "any" como
// "maskable".

export const runtime = "edge";

const SIZES = new Set([192, 512]);

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ size: string }> },
) {
  const { size } = await ctx.params;
  const px = Number(size);
  if (!SIZES.has(px)) {
    return new Response("Not found", { status: 404 });
  }

  const glyph = Math.round(px * 0.5);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#7c3aed",
        }}
      >
        <svg
          width={glyph}
          height={glyph}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
    ),
    {
      width: px,
      height: px,
      headers: {
        "Cache-Control": "public, max-age=604800, immutable",
      },
    },
  );
}
