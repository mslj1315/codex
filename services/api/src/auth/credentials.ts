import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

// Credentials are stored as bcrypt hashes only. The optional second argument is
// retained temporarily so existing callers compile while migration tests evolve.
export async function hashPassword(password: string, _legacyRandom?: unknown): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, serialized: string): Promise<boolean> {
  if (!/^\$2[aby]\$\d\d\$/.test(serialized)) return false;
  return bcrypt.compare(password, serialized);
}
