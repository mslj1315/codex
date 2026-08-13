import { newDb } from "pg-mem";
import { describe, expect, it, vi } from "vitest";
import { FakeObjectStorage } from "./support/fake-object-storage.js";

const serviceConstructorCalls = vi.hoisted(() => [] as unknown[][]);

vi.mock("../src/imports/service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/imports/service.js")>();
  return {
    ...actual,
    ImportService: class extends actual.ImportService {
      constructor(...args: ConstructorParameters<typeof actual.ImportService>) {
        serviceConstructorCalls.push(args);
        super(...args);
      }
    }
  };
});

import { buildServer } from "../src/server.js";

describe("server import dependency wiring", () => {
  it("passes the configured object storage and clock to ImportService", async () => {
    const memory = newDb();
    const { Pool } = memory.adapters.createPg();
    const storage = new FakeObjectStorage();
    const now = () => new Date("2026-08-11T09:00:00.000Z");
    const app = buildServer({
      database: new Pool(),
      developmentMode: true,
      objectStorage: storage,
      now
    });

    await app.ready();

    expect(serviceConstructorCalls).toHaveLength(1);
    expect(serviceConstructorCalls[0]?.[1]).toBe(storage);
    expect(serviceConstructorCalls[0]?.[2]).toBe(now);
    await app.close();
  });
});
