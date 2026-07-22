import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { buildEventPayload, buildUserData } from "./capi";

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

const base = {
  datasetId: "d",
  accessToken: "t",
  eventName: "calificado",
  eventId: "l1:calificado",
  eventTimeSec: 1,
  userData: {},
  leadId: "l:5",
};

describe("buildEventPayload — VBO", () => {
  it("manda custom_data.value con capitas", () => {
    expect(buildEventPayload({ ...base, value: 4 }).data[0].custom_data).toEqual({
      value: 4,
      currency: "ARS",
    });
  });

  it("SIN custom_data si value es null (nunca sella value=1)", () => {
    expect(
      buildEventPayload({ ...base, value: null }).data[0].custom_data,
    ).toBeUndefined();
  });
});

describe("buildUserData — matching de Meta", () => {
  it("hashea external_id, ciudad (sin acento) y CP", () => {
    const data = buildUserData({
      email: null,
      phone: null,
      name: null,
      externalId: "ABC-123",
      city: "Villa María",
      zip: " 5900 ",
    });
    expect(data.external_id).toEqual([sha256("abc-123")]);
    expect(data.ct).toEqual([sha256("villamaria")]); // sin acento ni espacios
    expect(data.zp).toEqual([sha256("5900")]); // trim
  });

  it("omite ciudad/CP/external_id vacíos o ausentes", () => {
    const data = buildUserData({
      email: null,
      phone: null,
      name: null,
      city: "   ",
      zip: "",
    });
    expect(data.ct).toBeUndefined();
    expect(data.zp).toBeUndefined();
    expect(data.external_id).toBeUndefined();
  });

  it("sigue mandando teléfono en E.164 hasheado", () => {
    const data = buildUserData({ email: null, phone: "p:+5493416590100", name: null });
    expect(data.ph).toEqual([sha256("5493416590100")]);
  });
});
