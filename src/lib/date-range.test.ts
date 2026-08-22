import { describe, it, expect } from "vitest";
import { rangeFromParams, rangeLabel, resolvePeriod } from "./date-range";

// Reloj fijo: martes 9 de agosto de 2026.
const NOW = new Date("2026-08-09T15:00:00Z");

describe("resolvePeriod", () => {
  it("todo → sin límites", () => {
    expect(resolvePeriod("todo", NOW)).toEqual({ since: null, until: null });
  });

  it("hoy → el mismo día en ambos extremos", () => {
    expect(resolvePeriod("hoy", NOW)).toEqual({
      since: "2026-08-09",
      until: "2026-08-09",
    });
  });

  it("7 días incluye hoy (7 días en total, no 8)", () => {
    expect(resolvePeriod("7d", NOW)).toEqual({
      since: "2026-08-03",
      until: "2026-08-09",
    });
  });

  it("30 días incluye hoy", () => {
    expect(resolvePeriod("30d", NOW)).toEqual({
      since: "2026-07-11",
      until: "2026-08-09",
    });
  });

  it("este mes va del día 1 a hoy", () => {
    expect(resolvePeriod("mes", NOW)).toEqual({
      since: "2026-08-01",
      until: "2026-08-09",
    });
  });

  it("mes pasado toma el mes completo", () => {
    expect(resolvePeriod("mes-pasado", NOW)).toEqual({
      since: "2026-07-01",
      until: "2026-07-31",
    });
  });
});

describe("rangeFromParams", () => {
  it("sin parámetros → todo", () => {
    const { preset, range } = rangeFromParams({}, NOW);
    expect(preset).toBe("todo");
    expect(range).toEqual({ since: null, until: null });
  });

  it("las fechas explícitas mandan sobre el preset", () => {
    const { preset, range } = rangeFromParams(
      { periodo: "7d", desde: "2026-06-01", hasta: "2026-06-30" },
      NOW,
    );
    expect(preset).toBe("custom");
    expect(range).toEqual({ since: "2026-06-01", until: "2026-06-30" });
  });

  it("rango invertido se da vuelta en vez de quedar vacío", () => {
    const { range } = rangeFromParams(
      { desde: "2026-06-30", hasta: "2026-06-01" },
      NOW,
    );
    expect(range).toEqual({ since: "2026-06-01", until: "2026-06-30" });
  });

  it("fecha basura se ignora", () => {
    const { preset, range } = rangeFromParams({ desde: "ayer" }, NOW);
    expect(preset).toBe("todo");
    expect(range).toEqual({ since: null, until: null });
  });

  it("preset desconocido cae en todo", () => {
    expect(rangeFromParams({ periodo: "siempre" }, NOW).preset).toBe("todo");
  });

  it("solo 'desde' es válido (abierto hacia adelante)", () => {
    const { preset, range } = rangeFromParams({ desde: "2026-08-01" }, NOW);
    expect(preset).toBe("custom");
    expect(range).toEqual({ since: "2026-08-01", until: null });
  });
});

describe("rangeLabel", () => {
  it("todo", () => {
    expect(rangeLabel("todo", { since: null, until: null })).toBe(
      "Todo el histórico",
    );
  });

  it("preset usa su nombre", () => {
    expect(rangeLabel("7d", resolvePeriod("7d", NOW))).toBe("Últimos 7 días");
  });

  it("custom muestra las fechas", () => {
    expect(rangeLabel("custom", { since: "2026-08-01", until: "2026-08-09" })).toBe(
      "01/08 → 09/08",
    );
  });
});
