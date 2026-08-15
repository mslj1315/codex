import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const rootDockerignore = fileURLToPath(new URL("../../../.dockerignore", import.meta.url));
const apiDockerfile = fileURLToPath(new URL("../Dockerfile", import.meta.url));

describe("root Docker build context", () => {
  it("excludes local dependencies, build output, secrets, and workspace metadata", async () => {
    const rules = await readRules();

    expect(rules).toEqual(expect.arrayContaining([
      "**/node_modules/",
      "**/build/",
      "**/dist/",
      ".gradle/",
      "**/.gradle/",
      "**/.worktrees/",
      ".superpowers/",
      "work/",
      "outputs/",
      ".git/",
      ".env",
      ".env.*",
      "**/*.jks",
      "**/*.keystore",
      "!.env.example"
    ]));
  });

  it("retains the files required by the root-context multi-stage build", async () => {
    const rules = await readRules();

    expect(rules).not.toContain("apps/");
    expect(rules).not.toContain("services/");
    expect(rules).not.toContain("**/src/");
    expect(rules).not.toContain("**/package.json");
    expect(rules).not.toContain("**/package-lock.json");
  });

  it("builds and packages the provider and operator consoles independently", async () => {
    const dockerfile = await readFile(apiDockerfile, "utf8");

    expect(dockerfile).toContain("FROM node:24-alpine AS provider-console-build");
    expect(dockerfile).toContain("COPY --from=provider-console-build /build/apps/provider-console/dist ./provider-console-dist");
    expect(dockerfile).toContain("FROM node:24-alpine AS operator-console-build");
    expect(dockerfile).toContain("COPY apps/operator-console/package.json apps/operator-console/package-lock.json ./");
    expect(dockerfile).toContain("COPY --from=operator-console-build /build/apps/operator-console/dist ./operator-console-dist");
  });
});

async function readRules(): Promise<string[]> {
  return (await readFile(rootDockerignore, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
