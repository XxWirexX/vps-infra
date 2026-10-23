import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * Écrit un fichier de façon atomique : on écrit un fichier temporaire
 * dans le même dossier, puis on le renomme. Traefik (qui surveille le dossier)
 * ne voit donc jamais un fichier à moitié écrit.
 * Le fichier temporaire n'a pas d'extension .yml : Traefik l'ignore.
 */
export async function writeFileAtomic(path: string, content: string) {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `.tmp-${randomBytes(6).toString('hex')}`)
  await writeFile(tmp, content, { mode: 0o644 })
  await rename(tmp, path)
}

/** Exécute les opérations d'écriture une par une, jamais en parallèle. */
let queue: Promise<unknown> = Promise.resolve()
export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}
