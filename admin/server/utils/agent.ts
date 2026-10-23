import { request } from 'node:http'

/**
 * Appel à l'agent du serveur, par son socket Unix (monté dans le conteneur).
 * L'agent est le seul à pouvoir agir sur GitHub, Docker et les clés SSH :
 * le panel ne fait que lui transmettre des demandes validées.
 */
export function callAgent<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const socketPath = useRuntimeConfig().agentSocket as string
  const payload = body === undefined ? undefined : JSON.stringify(body)

  return new Promise<T>((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path,
        method,
        timeout: 10_000,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let raw = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (raw += chunk))
        res.on('end', () => {
          let data: any
          try {
            data = JSON.parse(raw)
          } catch {
            return reject(createError({ statusCode: 502, message: "Réponse illisible de l'agent." }))
          }
          if ((res.statusCode ?? 500) >= 400) {
            return reject(createError({ statusCode: res.statusCode === 404 ? 404 : 400, message: data?.error || "Erreur de l'agent." }))
          }
          resolve(data as T)
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', () =>
      reject(createError({
        statusCode: 503,
        message: "L'agent du serveur est injoignable (sudo systemctl status agent).",
      })),
    )
    if (payload) req.write(payload)
    req.end()
  })
}
