import { describe, expect, it } from "vitest";
import {
  effectiveModules,
  canAccessPath,
  moduleForPath,
  firstAllowedModule,
  DEFAULT_ASESOR_MODULES,
} from "./modules";

describe("effectiveModules", () => {
  it("admin y owner ven todos los módulos", () => {
    expect(effectiveModules("admin", ["leads"]).length).toBeGreaterThan(1);
    expect(effectiveModules("owner", null)).toContain("pipelines");
  });

  it("agent sin allowed_modules cae al default", () => {
    expect(effectiveModules("agent", null)).toEqual(DEFAULT_ASESOR_MODULES);
    expect(effectiveModules("agent", undefined)).toEqual(["leads"]);
  });

  it("agent con allowed_modules ve solo esos (válidos)", () => {
    expect(effectiveModules("agent", ["leads", "pipelines"])).toEqual([
      "leads",
      "pipelines",
    ]);
  });

  it("agent filtra slugs inválidos", () => {
    expect(effectiveModules("agent", ["leads", "inventado"])).toEqual(["leads"]);
  });

  it("agent con lista vacía no ve ningún módulo", () => {
    expect(effectiveModules("agent", [])).toEqual([]);
  });
});

describe("moduleForPath", () => {
  it("mapea por primer segmento", () => {
    expect(moduleForPath("/leads")).toBe("leads");
    expect(moduleForPath("/leads/sources")).toBe("leads");
    expect(moduleForPath("/quick-messages")).toBe("quick-messages");
  });
  it("ruta no-módulo devuelve null", () => {
    expect(moduleForPath("/settings")).toBeNull();
    expect(moduleForPath("/")).toBeNull();
  });
});

describe("canAccessPath", () => {
  it("agent gateado a leads: entra a /leads, no a /pipelines", () => {
    expect(canAccessPath("agent", ["leads"], "/leads")).toBe(true);
    expect(canAccessPath("agent", ["leads"], "/leads/sources")).toBe(true);
    expect(canAccessPath("agent", ["leads"], "/pipelines")).toBe(false);
  });
  it("/settings siempre permitido (perfil propio)", () => {
    expect(canAccessPath("agent", ["leads"], "/settings")).toBe(true);
    expect(canAccessPath("agent", [], "/settings?tab=profile")).toBe(true);
  });
  it("admin entra a todo", () => {
    expect(canAccessPath("admin", null, "/pipelines")).toBe(true);
    expect(canAccessPath("admin", null, "/automations")).toBe(true);
  });
});

describe("firstAllowedModule", () => {
  it("agent → su primer módulo", () => {
    expect(firstAllowedModule("agent", ["pipelines", "leads"])).toBe(
      "pipelines",
    );
    expect(firstAllowedModule("agent", null)).toBe("leads");
  });
  it("agent sin módulos → null", () => {
    expect(firstAllowedModule("agent", [])).toBeNull();
  });
});
