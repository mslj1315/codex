import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Android content profile screen structure", () => {
  it("keeps all required choices and the submit action in a scrollable content container", async () => {
    const screen = await readFile(new URL("../../../apps/android/app/src/main/java/com/restaurantops/MainActivity.kt", import.meta.url), "utf8");
    const profileScreen = screen.slice(screen.indexOf("private fun ContentProfileScreen"), screen.indexOf("private fun ProfileChoice"));
    expect(profileScreen).toContain("verticalScroll(rememberScrollState())");
    expect(profileScreen.indexOf("ProfileChoice(\"Industry\"")).toBeGreaterThan(-1);
    expect(profileScreen.indexOf("Button(onClick")).toBeGreaterThan(profileScreen.indexOf("ProfileChoice(\"Operating mode\""));
  });
});
