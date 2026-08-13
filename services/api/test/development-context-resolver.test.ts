import { describe, expect, it } from "vitest";
import { developmentContextResolver } from "../src/imports/routes.js";

describe("developmentContextResolver", () => {
  it("requires loopback even when the exact development marker is supplied", async () => {
    const context = await developmentContextResolver({ ip: "203.0.113.10", headers: { "x-development-context": "ent_demo:store_demo:actor_demo" } } as never);
    expect(context).toBeUndefined();
  });

  it("accepts an exact marker from a loopback Android debug request", async () => {
    const context = await developmentContextResolver({ ip: "127.0.0.1", headers: { "x-development-context": "ent_demo:store_demo:actor_demo" } } as never);
    expect(context).toEqual({ enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo" });
  });

  it("rejects a loopback request with an altered marker", async () => {
    const context = await developmentContextResolver({ ip: "::1", headers: { "x-development-context": "ent_demo:store_demo:other" } } as never);
    expect(context).toBeUndefined();
  });
});
