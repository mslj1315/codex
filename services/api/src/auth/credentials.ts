import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 32;

export type RandomBytes = (size: number) => Buffer;

export async function hashPassword(password: string, random: RandomBytes = randomBytes): Promise<string> {
  const salt = random(SALT_BYTES);
  const derived = await derive(password, salt);
  return `scrypt$v1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, serialized: string): Promise<boolean> {
  const parsed = parse(serialized);
  if (!parsed) return false;
  const derived = await derive(password, parsed.salt);
  return derived.length === parsed.expected.length && timingSafeEqual(derived, parsed.expected);
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return await scrypt(password, salt, DERIVED_KEY_BYTES);
}

function parse(serialized: string): { salt: Buffer; expected: Buffer } | undefined {
  const [algorithm, version, salt, expected, extra] = serialized.split("$");
  if (algorithm !== "scrypt" || version !== "v1" || !salt || !expected || extra !== undefined) return undefined;
  try {
    const saltBytes = Buffer.from(salt, "base64url");
    const expectedBytes = Buffer.from(expected, "base64url");
    if (saltBytes.length !== SALT_BYTES || expectedBytes.length !== DERIVED_KEY_BYTES) return undefined;
    return { salt: saltBytes, expected: expectedBytes };
  } catch {
    return undefined;
  }
}
