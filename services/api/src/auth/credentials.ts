import bcrypt from "bcryptjs";
import { scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const BCRYPT_COST = 12;
const LEGACY_SALT_BYTES = 16;
const LEGACY_DERIVED_KEY_BYTES = 32;
const scrypt = promisify(nodeScrypt) as (password: string, salt: Buffer, keyLength: number) => Promise<Buffer>;

// Credentials are stored as bcrypt hashes only. The optional second argument is
// retained temporarily so existing callers compile while migration tests evolve.
export async function hashPassword(password: string, _legacyRandom?: unknown): Promise<string> {
  if (!isBcryptPasswordLength(password)) throw new PasswordValidationError();
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function hashNewPassword(password: string, workFactor = BCRYPT_COST): Promise<string> {
  if (!isNewPassword(password)) throw new PasswordValidationError();
  return bcrypt.hash(password, workFactor);
}

export async function verifyPassword(password: string, serialized: string): Promise<boolean> {
  if (/^\$2[aby]\$\d\d\$/.test(serialized)) return bcrypt.compare(password, serialized);
  const legacy = parseLegacyScrypt(serialized);
  if (!legacy) return false;
  const derived = await scrypt(password, legacy.salt, LEGACY_DERIVED_KEY_BYTES);
  return derived.length === legacy.expected.length && timingSafeEqual(derived, legacy.expected);
}

export function isLegacyScryptPasswordHash(value: string): boolean { return parseLegacyScrypt(value) !== undefined; }
export function isBcryptPasswordLength(value: string): boolean { const bytes = Buffer.byteLength(value, "utf8"); return bytes > 0 && bytes <= 72; }
export function isNewPassword(value: string): boolean {
  return Buffer.byteLength(value, "utf8") >= 8 && isBcryptPasswordLength(value) && /[A-Z]/.test(value) && /[a-z]/.test(value);
}
export class PasswordValidationError extends Error {}

function parseLegacyScrypt(serialized: string): { salt: Buffer; expected: Buffer } | undefined {
  const [algorithm, version, salt, expected, extra] = serialized.split("$");
  if (algorithm !== "scrypt" || version !== "v1" || !salt || !expected || extra !== undefined) return undefined;
  try {
    const saltBytes = Buffer.from(salt, "base64url");
    const expectedBytes = Buffer.from(expected, "base64url");
    if (saltBytes.length !== LEGACY_SALT_BYTES || expectedBytes.length !== LEGACY_DERIVED_KEY_BYTES) return undefined;
    return { salt: saltBytes, expected: expectedBytes };
  } catch { return undefined; }
}
