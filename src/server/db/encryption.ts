import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const TAG_LENGTH = 16
const SALT_LENGTH = 16

/**
 * Get the encryption key from environment variable.
 * Key must be 64 hex characters (32 bytes) for AES-256.
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY
  if (!keyHex) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is not set. ' +
        'It must be a 64-character hex string (32 bytes) for AES-256.'
    )
  }

  if (keyHex.length !== 64) {
    throw new Error(
      `ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes), ` +
        `but got ${keyHex.length} characters.`
    )
  }

  try {
    return Buffer.from(keyHex, 'hex')
  } catch (err) {
    throw new Error('ENCRYPTION_KEY must be a valid hex string')
  }
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns a string in format: iv:tag:ciphertext (all hex-encoded)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex')
  ciphertext += cipher.final('hex')

  const tag = cipher.getAuthTag()

  // Return as iv:tag:ciphertext
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext}`
}

/**
 * Decrypt a string encrypted with encrypt().
 * Expects format: iv:tag:ciphertext (all hex-encoded)
 */
export function decrypt(encrypted: string): string {
  const key = getEncryptionKey()

  const parts = encrypted.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format. Expected iv:tag:ciphertext')
  }

  const iv = Buffer.from(parts[0], 'hex')
  const tag = Buffer.from(parts[1], 'hex')
  const ciphertext = parts[2]

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`)
  }

  if (tag.length !== TAG_LENGTH) {
    throw new Error(`Invalid tag length: expected ${TAG_LENGTH}, got ${tag.length}`)
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  let plaintext = decipher.update(ciphertext, 'hex', 'utf8')
  plaintext += decipher.final('utf8')

  return plaintext
}

/**
 * Encrypt a token and return as Bytes for Prisma storage.
 * Returns the encrypted data (iv:tag:ciphertext) as a Buffer.
 */
export function encryptToken(token: string): Buffer {
  const encrypted = encrypt(token)
  return Buffer.from(encrypted, 'utf8')
}

/**
 * Decrypt a token from Prisma Bytes storage.
 * Expects the Buffer to contain the encrypted string (iv:tag:ciphertext).
 */
export function decryptToken(encrypted: Buffer | Uint8Array): string {
  // Prisma Bytes fields may return Uint8Array instead of Buffer
  const buf = Buffer.isBuffer(encrypted) ? encrypted : Buffer.from(encrypted)
  const encryptedString = buf.toString('utf8')
  return decrypt(encryptedString)
}
