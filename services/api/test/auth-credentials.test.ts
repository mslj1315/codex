import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/credentials.js";

describe("auth credentials", () => {
  it("hashes a password and verifies only the original value", async () => {
    const hash = await hashPassword("correct horse battery staple", () => Buffer.alloc(16, 7));

    expect(hash).toMatch(/^scrypt\$v1\$/);
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("rejects malformed serialized hashes", async () => {
    await expect(verifyPassword("password", "not-a-password-hash")).resolves.toBe(false);
  });
});
