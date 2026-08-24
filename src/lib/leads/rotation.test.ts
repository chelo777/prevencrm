import { describe, it, expect } from "vitest";
import { pickLeastRecentlyServed } from "./rotation";

// Rotación 1-a-1: recibe el que hace MÁS TIEMPO que no recibe, sin mirar
// cuánto acumuló. Es lo que reemplaza al "gana el que menos tiene", que
// dejaba seca a una tanda de 35/50 mientras otra de 0/50 se ponía al día.

interface Cand {
  id: string;
  lastServedAt: string | null;
  createdAt: string;
}

const pick = (cands: Cand[], rand = () => 0) =>
  pickLeastRecentlyServed(
    cands,
    (c) => c.lastServedAt,
    (c) => c.createdAt,
    rand,
  );

const c = (id: string, lastServedAt: string | null, createdAt = "2026-08-01"): Cand => ({
  id,
  lastServedAt,
  createdAt,
});

describe("pickLeastRecentlyServed", () => {
  it("sin candidatos devuelve null", () => {
    expect(pick([])).toBeNull();
  });

  it("gana el que hace más tiempo que no recibe", () => {
    const elegido = pick([
      c("reciente", "2026-08-22T10:00:00Z"),
      c("viejo", "2026-08-22T08:00:00Z"),
    ]);
    expect(elegido?.id).toBe("viejo");
  });

  it("el que NUNCA recibió va antes que cualquiera que ya recibió", () => {
    const elegido = pick([
      c("ya-recibio", "2020-01-01T00:00:00Z"),
      c("nunca", null),
    ]);
    expect(elegido?.id).toBe("nunca");
  });

  it("entre los que nunca recibieron, primero el más viejo", () => {
    const elegido = pick([
      c("nueva", null, "2026-08-22"),
      c("vieja", null, "2026-08-01"),
    ]);
    expect(elegido?.id).toBe("vieja");
  });

  it("empate exacto: desempata al azar entre los empatados", () => {
    const empatados = [
      c("a", "2026-08-22T08:00:00Z"),
      c("b", "2026-08-22T08:00:00Z"),
    ];
    expect(pick(empatados, () => 0)?.id).toBe("a");
    expect(pick(empatados, () => 0.99)?.id).toBe("b");
  });

  // ── El caso que motivó el cambio ──
  it("reparte 1-a-1 sin importar cuánto acumuló cada uno", () => {
    // A recién abierta, B ya lleva 35 entregados. Antes A se llevaba los 35
    // siguientes seguidos; ahora se alternan desde el primer lead.
    const estado = new Map<string, string | null>([
      ["A-nueva", null],
      ["B-con-35", "2026-08-22T09:00:00Z"],
    ]);
    const orden: string[] = [];

    for (let i = 0; i < 6; i++) {
      const elegido = pick(
        [...estado].map(([id, last]) => c(id, last)),
      );
      orden.push(elegido!.id);
      // Estampamos la entrega, como hace el repositorio al sellar.
      estado.set(elegido!.id, `2026-08-22T10:0${i}:00Z`);
    }

    expect(orden).toEqual([
      "A-nueva",
      "B-con-35",
      "A-nueva",
      "B-con-35",
      "A-nueva",
      "B-con-35",
    ]);
  });

  it("quien se suma a mitad de camino entra en la ronda, no la acapara", () => {
    const estado = new Map<string, string | null>([
      ["A", "2026-08-22T10:00:00Z"],
      ["B", "2026-08-22T10:01:00Z"],
    ]);
    const orden: string[] = [];

    // Al cuarto reparto entra C, que nunca recibió.
    for (let i = 0; i < 6; i++) {
      if (i === 3) estado.set("C-nueva", null);
      const elegido = pick([...estado].map(([id, last]) => c(id, last)));
      orden.push(elegido!.id);
      estado.set(elegido!.id, `2026-08-22T11:0${i}:00Z`);
    }

    // C entra una vez y sigue la rotación pareja: no se lleva una ráfaga.
    expect(orden).toEqual(["A", "B", "A", "C-nueva", "B", "A"]);
  });

  it("una pausa no genera deuda: al volver toma UN turno, no varios", () => {
    // B estuvo pausada y vuelve. Su lastServedAt es viejo, así que recibe
    // primero — pero una sola vez, porque al recibir se pone al día.
    const estado = new Map<string, string | null>([
      ["A", "2026-08-22T12:00:00Z"],
      ["B-volvio", "2026-08-20T09:00:00Z"],
    ]);
    const orden: string[] = [];
    for (let i = 0; i < 4; i++) {
      const elegido = pick([...estado].map(([id, last]) => c(id, last)));
      orden.push(elegido!.id);
      estado.set(elegido!.id, `2026-08-22T13:0${i}:00Z`);
    }
    expect(orden).toEqual(["B-volvio", "A", "B-volvio", "A"]);
  });
});
