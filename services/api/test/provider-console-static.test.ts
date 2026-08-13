import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.js";

const servers: Array<ReturnType<typeof buildServer>> = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("provider console static delivery", () => {
  it("serves the console entry point, SPA routes, and assets only below /provider", async () => {
    const dist = await createFixtureDist();
    const app = buildServer({ providerConsoleDistDir: dist });
    servers.push(app);

    const entry = await app.inject({ method: "GET", url: "/provider/" });
    expect(entry.statusCode).toBe(200);
    expect(entry.headers["content-type"]).toContain("text/html");
    expect(entry.body).toContain("fixture console");

    const deepLink = await app.inject({ method: "GET", url: "/provider/customers/store-1?view=feedback" });
    expect(deepLink.statusCode).toBe(200);
    expect(deepLink.headers["content-type"]).toContain("text/html");
    expect(deepLink.body).toContain("fixture console");

    const asset = await app.inject({ method: "GET", url: "/provider/assets/app.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("javascript");
    expect(asset.body).toContain("fixture asset");

    expect((await app.inject({ method: "GET", url: "/provider/assets/missing.js" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/v1/not-a-route" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/not-provider" })).statusCode).toBe(404);
  });

  it("keeps the API operational when static delivery is not configured", async () => {
    const app = buildServer();
    servers.push(app);

    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ status: "ok" });
    expect((await app.inject({ method: "GET", url: "/provider/" })).statusCode).toBe(404);
  });

  it("keeps the API operational when the configured dist directory is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-console-missing-"));
    temporaryDirectories.push(root);
    const app = buildServer({ providerConsoleDistDir: join(root, "does-not-exist") });
    servers.push(app);

    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/provider/" })).statusCode).toBe(404);
  });
});

async function createFixtureDist(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "provider-console-dist-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "<!doctype html><title>fixture console</title>");
  await writeFile(join(root, "assets", "app.js"), "console.log('fixture asset');");
  return root;
}
