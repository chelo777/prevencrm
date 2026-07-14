import { describe, expect, it } from "vitest";
import { humanizeFieldName, humanizeFormValue } from "./humanize";

describe("humanizeFormValue", () => {
  it("reemplaza guiones bajos y capitaliza", () => {
    expect(humanizeFormValue("entre_36_y_49_años")).toBe("Entre 36 y 49 años");
  });

  it("maneja barras y acentos", () => {
    expect(humanizeFormValue("soy_monotributista_/_autónomo")).toBe(
      "Soy monotributista / autónomo",
    );
  });

  it("deja casi intacto un valor ya legible", () => {
    expect(humanizeFormValue("Santa Fe")).toBe("Santa Fe");
  });

  it("colapsa espacios repetidos", () => {
    expect(humanizeFormValue("lo__antes___posible")).toBe("Lo antes posible");
  });

  it("string vacío devuelve vacío", () => {
    expect(humanizeFormValue("")).toBe("");
  });
});

describe("humanizeFieldName", () => {
  it("capitaliza la primera letra", () => {
    expect(humanizeFieldName("qué edad tenés")).toBe("Qué edad tenés");
  });

  it("deja intacto lo ya capitalizado", () => {
    expect(humanizeFieldName("Ciudad")).toBe("Ciudad");
  });

  it("trimea espacios", () => {
    expect(humanizeFieldName("  cuál es tu situación laboral ")).toBe(
      "Cuál es tu situación laboral",
    );
  });
});
