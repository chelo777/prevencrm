import { describe, it, expect } from "vitest";
import { buildEventPayload } from "./capi";

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
