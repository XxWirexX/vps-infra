import { access, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/** Fichier lu par nginx (maintenance/nginx.conf) pour le filet de sécurité. */
function flagPath() {
  return join(useRuntimeConfig().flagsDir as string, 'maintenance')
}

export async function isGlobalMaintenance(): Promise<boolean> {
  try {
    await access(flagPath())
    return true
  } catch {
    return false
  }
}

export async function setGlobalMaintenance(enabled: boolean) {
  if (enabled) {
    await writeFileAtomic(flagPath(), `${new Date().toISOString()}\n`)
  } else {
    await unlink(flagPath()).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err
    })
  }
}
