import { NextResponse } from "next/server";

// Íconos PWA: ahora son PNG estáticos en public/icons/ (logo de
// Prevención Salud). Esta ruta queda solo para PWAs ya instaladas y
// suscripciones push que guardaron la URL vieja (/icons/192, /icons/512).

const SIZES = new Set(["192", "512"]);

export async function GET(
  req: Request,
  ctx: { params: Promise<{ size: string }> },
) {
  const { size } = await ctx.params;
  if (!SIZES.has(size)) {
    return new Response("Not found", { status: 404 });
  }
  return NextResponse.redirect(new URL(`/icons/${size}.png`, req.url), 308);
}
