import { createHmac } from 'node:crypto'

function hotp(secretHex: string, counter: bigint): number {
  const key = Buffer.from(secretHex, 'hex')
  const msg = Buffer.alloc(8)
  msg.writeBigInt64BE(counter)

  const hmac = createHmac('sha1', key).update(msg).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)

  return code % 1_000_000
}

/**
 * Vérifie un token TOTP.
 * Renvoie le compteur qui a correspondu (pour l'anti-rejeu), ou null si invalide.
 */
export function verifyTotp(secretHex: string, token: string, window = 1): bigint | null {
  const code = parseInt(token, 10)
  if (isNaN(code)) return null

  const counter = BigInt(Math.floor(Date.now() / 1000 / 30))

  for (let i = -window; i <= window; i++) {
    const c = counter + BigInt(i)
    if (hotp(secretHex, c) === code) return c
  }
  return null
}
