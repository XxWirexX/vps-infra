import { Hono } from 'hono'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server'
import { getSession, createSession } from './session.js'
import { loadPasskeys, savePasskeys } from './passkeys.js'
import { safeRd } from './utils.js'

const app = new Hono()

// Challenges à usage unique — supprimés dès qu'ils ont servi
let registrationChallenge: string | null = null
let authChallenge: string | null = null

function rp() {
  return {
    id:     process.env.RP_ID     ?? 'wireredblue.xyz',
    origin: process.env.RP_ORIGIN ?? 'https://auth.wireredblue.xyz',
    name:   process.env.RP_NAME   ?? 'Portier',
  }
}

// ── Inscription (session requise) ─────────────────────────────────────────────

app.get('/register/options', async (c) => {
  if (!await getSession(c)) return c.json({ error: 'Non autorisé' }, 401)

  const { id, name } = rp()
  const passkeys = loadPasskeys()

  const options = await generateRegistrationOptions({
    rpName: name,
    rpID:   id,
    userName: 'admin',
    attestationType: 'none',
    authenticatorSelection: {
      residentKey:      'required',
      userVerification: 'required',
    },
    excludeCredentials: passkeys.map(p => ({ id: p.id, transports: p.transports })),
  })

  registrationChallenge = options.challenge
  return c.json(options)
})

app.post('/register/verify', async (c) => {
  if (!await getSession(c)) return c.json({ error: 'Non autorisé' }, 401)

  const challenge = registrationChallenge
  registrationChallenge = null // usage unique

  if (!challenge) return c.json({ error: 'Pas de challenge en attente' }, 400)

  let body: RegistrationResponseJSON
  try { body = await c.req.json() as RegistrationResponseJSON }
  catch { return c.json({ error: 'Body invalide' }, 400) }

  const { id: rpID, origin } = rp()
  let verified = false
  let credential: { id: string; publicKey: Uint8Array; counter: number; transports?: string[] } | undefined

  try {
    const result = await verifyRegistrationResponse({
      response:              body,
      expectedChallenge:     challenge,
      expectedOrigin:        origin,
      expectedRPID:          rpID,
      requireUserVerification: true,
    })
    verified   = result.verified
    credential = result.registrationInfo?.credential
  } catch (e) {
    console.error('verifyRegistrationResponse:', e)
    return c.json({ error: 'Vérification échouée' }, 400)
  }

  if (!verified || !credential) return c.json({ error: 'Vérification échouée' }, 400)

  const passkeys = loadPasskeys()
  passkeys.push({
    id:         credential.id,
    publicKey:  Buffer.from(credential.publicKey).toString('base64'),
    counter:    credential.counter,
    transports: credential.transports,
  })
  savePasskeys(passkeys)

  return c.json({ ok: true })
})

// ── Connexion ─────────────────────────────────────────────────────────────────

app.get('/login/options', async (c) => {
  const { id: rpID } = rp()
  const passkeys = loadPasskeys()

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification:  'required',
    allowCredentials:  passkeys.map(p => ({ id: p.id, transports: p.transports })),
  })

  authChallenge = options.challenge
  return c.json(options)
})

app.post('/login/verify', async (c) => {
  const challenge = authChallenge
  authChallenge = null // usage unique

  if (!challenge) return c.json({ error: 'Pas de challenge en attente' }, 400)

  let body: AuthenticationResponseJSON & { rd?: string }
  try { body = await c.req.json() as AuthenticationResponseJSON & { rd?: string } }
  catch { return c.json({ error: 'Body invalide' }, 400) }

  const rd = typeof body.rd === 'string' ? body.rd : ''

  const passkeys = loadPasskeys()
  const passkey  = passkeys.find(p => p.id === body.id)
  if (!passkey) return c.json({ error: 'Passkey inconnue' }, 400)

  const { id: rpID, origin } = rp()
  let verified = false
  let newCounter = passkey.counter

  try {
    const result = await verifyAuthenticationResponse({
      response:          body,
      expectedChallenge: challenge,
      expectedOrigin:    origin,
      expectedRPID:      rpID,
      credential: {
        id:         passkey.id,
        publicKey:  Buffer.from(passkey.publicKey, 'base64'),
        counter:    passkey.counter,
        transports: passkey.transports,
      },
      requireUserVerification: true,
    })
    verified   = result.verified
    newCounter = result.authenticationInfo?.newCounter ?? passkey.counter
  } catch (e) {
    console.error('verifyAuthenticationResponse:', e)
    return c.json({ error: 'Vérification échouée' }, 401)
  }

  if (!verified) return c.json({ error: 'Vérification échouée' }, 401)

  // Mettre à jour le compteur (anti-rejeu WebAuthn)
  passkey.counter = newCounter
  savePasskeys(passkeys)

  await createSession(c)
  return c.json({ redirect: safeRd(rd) })
})

export default app
