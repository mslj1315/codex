import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const rootDockerignore = fileURLToPath(new URL("../../../.dockerignore", import.meta.url));

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
});

async function readRules(): Promise<string[]> {
  return (await readFile(rootDockerignore, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
