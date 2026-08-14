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

  it("accepts the exact marker from explicitly enumerated emulator bridge addresses", async () => {
    // The emulator reaches host 10.0.2.2; Fastify may observe its fixed guest source as 10.0.2.16.
    for (const ip of ["10.0.2.2", "10.0.2.16"]) {
      const context = await developmentContextResolver({ ip, headers: { "x-development-context": "ent_demo:store_demo:actor_demo" } } as never);
      expect(context).toEqual({ enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo" });
    }
  });

  it("rejects a loopback request without the exact marker", async () => {
    const context = await developmentContextResolver({ ip: "::1", headers: { "x-development-context": "ent_demo:store_demo:other" } } as never);
    expect(context).toBeUndefined();
  });

  it("rejects all other private and public source addresses with the marker", async () => {
    for (const ip of ["10.0.2.15", "10.1.0.1", "192.168.1.20", "172.16.0.1", "203.0.113.10"]) {
      const context = await developmentContextResolver({ ip, headers: { "x-development-context": "ent_demo:store_demo:actor_demo" } } as never);
      expect(context).toBeUndefined();
    }
  });
});
