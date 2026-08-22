import { describe, it, expect } from "vitest";
import {
  applyLeadFilter,
  describeFilter,
  parseLeadFilter,
  scopeFilterToRole,
} from "./lead-filter";

// El filtro de la bandeja vive en la URL. La misma definición la usan la
// página (para listar) y el bulk (para saber sobre QUÉ opera), así que
// "lo que ves seleccionado" y "lo que se modifica" no pueden divergir.

describe("parseLeadFilter", () => {
  it("lee los filtros de la URL", () => {
    const f = parseLeadFilter({
      etapa: "st_1",
      etiqueta: "tag_1",
      asesora: "u_9",
      dup: "1",
      periodo: "hoy",
    });
    expect(f).toMatchObject({
      stageId: "st_1",
      tagId: "tag_1",
      assignedTo: "u_9",
      onlyDuplicates: true,
      period: "hoy",
    });
  });

  it("un filtro vacío no filtra nada", () => {
    const f = parseLeadFilter({});
    expect(f.stageId).toBeNull();
    expect(f.tagId).toBeNull();
    expect(f.assignedTo).toBeNull();
    expect(f.onlyDuplicates).toBe(false);
  });

  it("ignora valores que no son string (?etapa=a&etapa=b)", () => {
    const f = parseLeadFilter({ etapa: ["a", "b"], etiqueta: undefined });
    expect(f.stageId).toBeNull();
    expect(f.tagId).toBeNull();
  });

  it("traduce el rango de fechas a un intervalo concreto", () => {
    const f = parseLeadFilter(
      { desde: "2026-08-01", hasta: "2026-08-15" },
      new Date("2026-08-22T12:00:00Z"),
    );
    expect(f.since).toBe("2026-08-01");
    expect(f.until).toBe("2026-08-15");
  });
});

// ------------------------------------------------------------
// EL control de acceso. Un asesor que pide "todos los leads" sólo
// puede tocar los suyos, aunque manipule la URL o el body a mano.
// La RLS es el muro real; esto es la segunda puerta, explícita y testeada.
// ------------------------------------------------------------
describe("alcance por rol", () => {
  it("a un agent le FUERZA su propio user_id, pida lo que pida", () => {
    const pedido = parseLeadFilter({}); // "todos"
    const scoped = scopeFilterToRole(pedido, "agent", "u_yo");
    expect(scoped.assignedTo).toBe("u_yo");
  });

  it("un agent no puede pedir los leads de otro asesor", () => {
    const pedido = parseLeadFilter({ asesora: "u_otro" });
    const scoped = scopeFilterToRole(pedido, "agent", "u_yo");
    expect(scoped.assignedTo).toBe("u_yo"); // su pedido se descarta
  });

  it("un agent tampoco puede pedir los leads SIN asignar", () => {
    const pedido = parseLeadFilter({ asesora: "none" });
    const scoped = scopeFilterToRole(pedido, "agent", "u_yo");
    expect(scoped.assignedTo).toBe("u_yo");
  });

  it("un viewer queda igual de acotado que un agent", () => {
    const scoped = scopeFilterToRole(parseLeadFilter({}), "viewer", "u_yo");
    expect(scoped.assignedTo).toBe("u_yo");
  });

  it("admin y owner sí ven y operan sobre todo", () => {
    expect(scopeFilterToRole(parseLeadFilter({}), "admin", "u_yo").assignedTo).toBeNull();
    expect(scopeFilterToRole(parseLeadFilter({}), "owner", "u_yo").assignedTo).toBeNull();
    // y pueden apuntar a una asesora concreta
    expect(
      scopeFilterToRole(parseLeadFilter({ asesora: "u_otro" }), "admin", "u_yo").assignedTo,
    ).toBe("u_otro");
  });

  it("admin puede pedir los leads sin asignar", () => {
    const scoped = scopeFilterToRole(parseLeadFilter({ asesora: "none" }), "admin", "u_yo");
    expect(scoped.assignedTo).toBe("none");
  });

  it("el filtro 'solo duplicados' es de admin: a un agent se le cae", () => {
    const scoped = scopeFilterToRole(
      parseLeadFilter({ dup: "1" }),
      "agent",
      "u_yo",
    );
    expect(scoped.onlyDuplicates).toBe(false);
  });

  it("acotar es idempotente (no se puede ensanchar re-aplicándolo)", () => {
    const once = scopeFilterToRole(parseLeadFilter({}), "agent", "u_yo");
    const twice = scopeFilterToRole(once, "agent", "u_yo");
    expect(twice.assignedTo).toBe("u_yo");
  });
});

describe("describeFilter (texto de la confirmación)", () => {
  it("sin filtros avisa que son todos", () => {
    expect(describeFilter(parseLeadFilter({}))).toBe("todos los leads");
  });

  it("nombra los filtros activos", () => {
    const txt = describeFilter(
      parseLeadFilter({ etapa: "st_1", periodo: "hoy" }),
      { stageName: "Nuevo", periodLabel: "hoy" },
    );
    expect(txt).toContain("Nuevo");
    expect(txt).toContain("hoy");
  });
});

// ------------------------------------------------------------
// Traducción del filtro a la consulta. Un test con un query builder
// falso: garantiza que el recorte por asesor no se quede en el objeto
// y efectivamente llegue al WHERE.
// ------------------------------------------------------------
class FakeQuery {
  calls: string[] = [];
  eq(col: string, val: unknown) {
    this.calls.push(`eq(${col},${val})`);
    return this;
  }
  is(col: string, val: unknown) {
    this.calls.push(`is(${col},${val})`);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.calls.push(`in(${col},[${(vals as string[]).length}])`);
    return this;
  }
  gte(col: string, val: unknown) {
    this.calls.push(`gte(${col},${val})`);
    return this;
  }
  lte(col: string, val: unknown) {
    this.calls.push(`lte(${col},${val})`);
    return this;
  }
}

describe("applyLeadFilter", () => {
  it("el asesor acotado se traduce en un WHERE por assigned_agent_id", () => {
    const q = new FakeQuery();
    const filter = scopeFilterToRole(parseLeadFilter({}), "agent", "u_yo");
    applyLeadFilter(q as never, filter, null);
    expect(q.calls).toContain("eq(deal.assigned_agent_id,u_yo)");
  });

  it("'sin asignar' usa IS NULL, no una comparación con el string", () => {
    const q = new FakeQuery();
    const filter = scopeFilterToRole(parseLeadFilter({ asesora: "none" }), "admin", "u_a");
    applyLeadFilter(q as never, filter, null);
    expect(q.calls).toContain("is(deal.assigned_agent_id,null)");
  });

  it("el período acota created_at por los dos extremos", () => {
    const q = new FakeQuery();
    const filter = parseLeadFilter({ desde: "2026-08-01", hasta: "2026-08-15" });
    applyLeadFilter(q as never, filter, null);
    expect(q.calls).toContain("gte(created_at,2026-08-01)");
    expect(q.calls.some((c) => c.startsWith("lte(created_at,2026-08-15"))).toBe(true);
  });

  it("un admin sin filtros no agrega ninguna restricción", () => {
    const q = new FakeQuery();
    applyLeadFilter(q as never, scopeFilterToRole(parseLeadFilter({}), "admin", "u_a"), null);
    expect(q.calls).toEqual([]);
  });

  it("'solo duplicados' sin duplicados no devuelve TODO (falla cerrado)", () => {
    const q = new FakeQuery();
    const filter = parseLeadFilter({ dup: "1" });
    applyLeadFilter(q as never, filter, new Set<string>());
    // Un IN vacío traería la tabla entera; se fuerza un id imposible.
    expect(q.calls).toContain("in(contact_id,[1])");
  });
});
