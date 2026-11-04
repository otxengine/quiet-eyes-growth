/**
 * AES-256-GCM token encryption/decryption.
 *
 * Storage format: `<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 *
 * Why GCM?
 *  - Authenticated encryption: any tampering of the ciphertext or tag is detected.
 *  - No padding oracle attacks (unlike CBC).
 *  - Each encryption uses a fresh random 12-byte IV, so the same plaintext
 *    always produces different ciphertexts (IND-CPA secure).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM  = 'aes-256-gcm';
const IV_LENGTH  = 12; // bytes — NIST recommended for GCM
const TAG_LENGTH = 16; // bytes — GCM auth tag (128-bit)
const KEY_LENGTH = 32; // bytes — AES-256

/**
 * Derive the encryption key from the environment.
 * Expects META_ENCRYPTION_KEY to be a 64-character hex string (32 bytes).
 * Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
function getKey(): Buffer {
  const hex = process.env.META_ENCRYPTION_KEY || '';
  if (hex.length !== KEY_LENGTH * 2) {
    throw new Error(
      `META_ENCRYPTION_KEY must be a ${KEY_LENGTH * 2}-char hex string. ` +
      `Generate one: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext string (e.g. a Meta access token).
 * Returns a storable string: `iv:authTag:ciphertext` (all hex-encoded).
 */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv  = randomBytes(IV_LENGTH);

  const cipher    = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag       = cipher.getAuthTag(); // must be called after final()

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a token produced by encryptToken().
 * Throws if the auth tag doesn't match (tampered data).
 */
export function decryptToken(stored: string): string {
  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format — expected iv:tag:ciphertext');
  }

  const [ivHex, tagHex, ctHex] = parts;
  const key        = getKey();
  const iv         = Buffer.from(ivHex,  'hex');
  const tag        = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ctHex,  'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
