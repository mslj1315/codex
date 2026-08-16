import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.js";

const servers: Array<ReturnType<typeof buildServer>> = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("unified admin console static delivery", () => {
  it("serves the console entry point, SPA routes, and assets only below /admin", async () => {
    const directory = await mkdtemp(join(tmpdir(), "admin-console-dist-"));
    directories.push(directory);
    await mkdir(join(directory, "assets"));
    await writeFile(join(directory, "index.html"), "<!doctype html><title>unified admin</title>");
    await writeFile(join(directory, "assets", "app.js"), "console.log('admin asset');");
    const app = buildServer({ adminConsoleDistDir: directory });
    servers.push(app);

    expect((await app.inject({ method: "GET", url: "/admin/" })).body).toContain("unified admin");
    expect((await app.inject({ method: "GET", url: "/admin/model-configs" })).body).toContain("unified admin");
    expect((await app.inject({ method: "GET", url: "/admin/assets/app.js" })).body).toContain("admin asset");
    expect((await app.inject({ method: "GET", url: "/admin/assets/missing.js" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/provider/assets/app.js" })).statusCode).toBe(404);
  });

  it("redirects legacy console paths to the unified admin without serving their bundles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "admin-console-dist-"));
    directories.push(directory);
    await mkdir(join(directory, "assets"));
    await writeFile(join(directory, "index.html"), "<!doctype html><title>unified admin</title>");
    await writeFile(join(directory, "assets", "app.js"), "console.log('admin asset');");
    const app = buildServer({ adminConsoleDistDir: directory });
    servers.push(app);

    for (const path of ["/provider/", "/provider/customers/store-a", "/operator/", "/operator/templates"]) {
      const response = await app.inject({ method: "GET", url: path });
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/admin/");
    }
    expect((await app.inject({ method: "GET", url: "/provider/assets/app.js" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/operator/assets/app.js" })).statusCode).toBe(404);
  });
});
