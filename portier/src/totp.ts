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

export function verifyTotp(secretHex: string, token: string, window = 1): boolean {
  const code = parseInt(token, 10)
  if (isNaN(code)) return false

  const counter = BigInt(Math.floor(Date.now() / 1000 / 30))

  for (let i = -window; i <= window; i++) {
    if (hotp(secretHex, counter + BigInt(i)) === code) return true
  }
  return false
}
