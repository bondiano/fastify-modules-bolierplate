import argon2 from 'argon2';

/**
 * Argon2id with the OWASP-recommended baseline parameters. We deliberately
 * pin them here so consumers can't accidentally weaken the cost factor by
 * passing options through. If you need stronger settings, fork this module.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(hashed: string, plain: string): Promise<boolean>;
}

export const createPasswordHasher = (): PasswordHasher => ({
  hash: (plain) => argon2.hash(plain, ARGON2_OPTIONS),
  verify: async (hashed, plain) => {
    try {
      return await argon2.verify(hashed, plain);
    } catch {
      // argon2.verify throws on malformed hashes -- treat as a failed match
      // rather than leaking the parse error to callers.
      return false;
    }
  },
});
