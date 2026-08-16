import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Android authenticated workspace structure", () => {
  it("starts the authenticated app root from the configured local API runtime", async () => {
    const screen = await readFile(new URL("../../../apps/android/app/src/main/java/com/restaurantops/MainActivity.kt", import.meta.url), "utf8");
    expect(screen).toContain("LocalImportApiRuntime.canUseLocalApi");
    expect(screen).toContain("AuthenticatedAppRoot(");
    expect(screen).toContain("AuthenticatedApiClient(repository)");
    expect(screen).toContain("AppSessionState.RemoteWorkspace");
  });
});
