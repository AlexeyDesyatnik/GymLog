import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/** Slow enough that a stolen hash is costly to guess from, quick enough for a sign-in (tens of ms). */
const SCRYPT: ScryptOptions = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

/** A password as it is kept: its scrypt hash with a random salt, and the settings it was made with. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
}

/** Whether the password is the one kept as this hash. */
export async function passwordMatches(password: string, hash: string): Promise<boolean> {
  const [scheme, N, r, p, salt, key] = hash.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), {
    ...SCRYPT,
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A hash no password matches, checked against for an unknown login so it takes as long as a known one. */
export const NO_PASSWORD = await hashPassword(randomBytes(32).toString("base64"));

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFC"), salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}
