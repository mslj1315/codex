import { scrypt as nodeScrypt } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/credentials.js";

describe("auth credentials", () => {
  it("hashes a password and verifies only the original value", async () => {
    const hash = await hashPassword("correct horse battery staple", () => Buffer.alloc(16, 7));

    expect(hash).toMatch(/^\$2[aby]\$/);
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("rejects malformed serialized hashes", async () => {
    await expect(verifyPassword("password", "not-a-password-hash")).resolves.toBe(false);
  });

  it("continues to verify a legacy scrypt hash while new hashes remain bcrypt", async () => {
    const legacy = await legacyScryptHash("correct horse battery staple");

    await expect(verifyPassword("correct horse battery staple", legacy)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", legacy)).resolves.toBe(false);
    expect(await hashPassword("next password")).toMatch(/^\$2[aby]\$/);
  });
});

async function legacyScryptHash(password: string): Promise<string> {
  const salt = Buffer.alloc(16, 7);
  const derive = promisify(nodeScrypt) as (value: string, salt: Buffer, length: number) => Promise<Buffer>;
  const derived = await derive(password, salt, 32);
  return `scrypt$v1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}
