import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const DATA_FILE = resolve('data', 'passkeys.json')

export interface StoredPasskey {
  id: string        // base64url
  publicKey: string // Uint8Array sérialisé en base64
  counter: number
  transports?: string[]
}

export function loadPasskeys(): StoredPasskey[] {
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf8')) as StoredPasskey[]
  } catch {
    return []
  }
}

export function savePasskeys(passkeys: StoredPasskey[]): void {
  mkdirSync(dirname(DATA_FILE), { recursive: true })
  writeFileSync(DATA_FILE, JSON.stringify(passkeys, null, 2))
}
