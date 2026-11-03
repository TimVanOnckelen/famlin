#!/usr/bin/env node
// Submits an uploaded iOS build for App Store review via the App Store
// Connect API. `eas build --auto-submit` (mobile-build.yml) only uploads the
// binary to App Store Connect; it never creates the App Store version or
// submits it for review, which used to be a manual step after every release.
//
// Steps: wait for the build (marketing version + build number) to finish
// processing, find or create the editable App Store version for it, attach
// the build, fill in an empty "What's New" text per localization, then add the
// version to a review submission and submit it. Re-running is safe: a version
// that is already waiting for review or released is left alone.
//
// Dependency-free (Node 22: global fetch, node:crypto ES256 signing).
//
// Env: ASC_APP_ID, ASC_API_KEY_ID, ASC_API_KEY_ISSUER_ID, ASC_API_KEY_PATH,
//      APP_VERSION, APP_BUILD_NUMBER (defaults to APP_VERSION),
//      BUILD_WAIT_MINUTES (default 90).

import { createPrivateKey, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'

const API = 'https://api.appstoreconnect.apple.com'

// Fallback "What's New" text, only written where a localization's field is
// still empty, so text entered by hand in App Store Connect is never replaced.
const WHATS_NEW = {
  en: 'Bug fixes and improvements.',
  nl: 'Bugfixes en verbeteringen.',
  zh: '错误修复和改进。',
}

// appVersionState (or the older appStoreState) values.
const EDITABLE_STATES = new Set([
  'PREPARE_FOR_SUBMISSION',
  'READY_FOR_REVIEW',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY',
])
const IN_REVIEW_STATES = new Set(['WAITING_FOR_REVIEW', 'IN_REVIEW', 'WAITING_FOR_EXPORT_COMPLIANCE'])

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const appId = requireEnv('ASC_APP_ID')
const keyId = requireEnv('ASC_API_KEY_ID')
const issuerId = requireEnv('ASC_API_KEY_ISSUER_ID')
const privateKey = createPrivateKey(readFileSync(requireEnv('ASC_API_KEY_PATH')))
const version = requireEnv('APP_VERSION')
const buildNumber = process.env.APP_BUILD_NUMBER || version
const buildWaitMinutes = Number(process.env.BUILD_WAIT_MINUTES || 90)

const b64url = (input) => Buffer.from(input).toString('base64url')

function token() {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' }))
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  })
  return `${header}.${payload}.${b64url(signature)}`
}

class AscError extends Error {
  constructor(status, body) {
    const detail = body?.errors?.map((e) => `${e.code}: ${e.detail ?? e.title}`).join('; ')
    super(`App Store Connect API ${status}${detail ? ` — ${detail}` : ''}`)
    this.status = status
  }
}

async function api(method, path, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }).catch((err) => ({ networkError: err }))

    const retryable = res.networkError || res.status === 429 || res.status >= 500
    if (retryable && attempt < 4) {
      await sleep(attempt * 5000)
      continue
    }
    if (res.networkError) throw res.networkError
    if (res.status === 204) return null
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new AscError(res.status, json)
    return json
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const stateOf = (v) => v.attributes.appVersionState ?? v.attributes.appStoreState
const q = (params) => new URLSearchParams(params).toString()

async function waitForBuild() {
  const deadline = Date.now() + buildWaitMinutes * 60_000
  const path = `/v1/builds?${q({
    'filter[app]': appId,
    'filter[version]': buildNumber,
    'filter[preReleaseVersion.version]': version,
    'filter[preReleaseVersion.platform]': 'IOS',
    limit: '1',
  })}`
  for (;;) {
    const build = (await api('GET', path)).data[0]
    const state = build?.attributes.processingState
    if (state === 'VALID') return build
    if (state === 'FAILED' || state === 'INVALID') {
      throw new Error(`Build ${version} (${buildNumber}) failed processing: ${state}`)
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Build ${version} (${buildNumber}) not processed after ${buildWaitMinutes} minutes (state: ${state ?? 'not uploaded yet'})`
      )
    }
    console.log(`Waiting for build ${version} (${buildNumber}): ${state ?? 'not uploaded yet'}`)
    await sleep(60_000)
  }
}

/** Returns the editable App Store version for `version`, or null when there's nothing to submit. */
async function prepareVersion() {
  const versions = (
    await api('GET', `/v1/apps/${appId}/appStoreVersions?${q({ 'filter[platform]': 'IOS', limit: '50' })}`)
  ).data

  const existing = versions.find((v) => v.attributes.versionString === version)
  if (existing) {
    const state = stateOf(existing)
    if (EDITABLE_STATES.has(state)) return existing
    console.log(`Version ${version} is already ${state}; nothing to submit.`)
    return null
  }

  const inReview = versions.find((v) => IN_REVIEW_STATES.has(stateOf(v)))
  if (inReview) {
    throw new Error(
      `Version ${inReview.attributes.versionString} is still ${stateOf(inReview)}. ` +
        `Remove it from review in App Store Connect, then re-run this job to submit ${version}.`
    )
  }

  // Apple allows one editable version at a time — reuse it for this release.
  const editable = versions.find((v) => EDITABLE_STATES.has(stateOf(v)))
  if (editable) {
    console.log(`Renaming editable version ${editable.attributes.versionString} to ${version}`)
    return (
      await api('PATCH', `/v1/appStoreVersions/${editable.id}`, {
        data: { type: 'appStoreVersions', id: editable.id, attributes: { versionString: version } },
      })
    ).data
  }

  console.log(`Creating App Store version ${version}`)
  return (
    await api('POST', '/v1/appStoreVersions', {
      data: {
        type: 'appStoreVersions',
        attributes: { platform: 'IOS', versionString: version },
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    })
  ).data
}

async function fillWhatsNew(versionId) {
  const localizations = (await api('GET', `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`)).data
  for (const loc of localizations) {
    if (loc.attributes.whatsNew?.trim()) continue
    const lang = loc.attributes.locale.split('-')[0]
    const whatsNew = WHATS_NEW[lang] ?? WHATS_NEW.en
    console.log(`Setting "What's New" for ${loc.attributes.locale}`)
    await api('PATCH', `/v1/appStoreVersionLocalizations/${loc.id}`, {
      data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: { whatsNew } },
    })
  }
}

async function submitForReview(versionId) {
  const open = (
    await api(
      'GET',
      `/v1/reviewSubmissions?${q({
        'filter[app]': appId,
        'filter[platform]': 'IOS',
        'filter[state]': 'READY_FOR_REVIEW',
      })}`
    )
  ).data[0]
  const submission =
    open ??
    (
      await api('POST', '/v1/reviewSubmissions', {
        data: {
          type: 'reviewSubmissions',
          attributes: { platform: 'IOS' },
          relationships: { app: { data: { type: 'apps', id: appId } } },
        },
      })
    ).data

  try {
    await api('POST', '/v1/reviewSubmissionItems', {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id: submission.id } },
          appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
        },
      },
    })
  } catch (err) {
    // 409 when the version is already part of this (reused) submission.
    if (!(err instanceof AscError && err.status === 409)) throw err
    const items = (await api('GET', `/v1/reviewSubmissions/${submission.id}/items?include=appStoreVersion`)).data
    const already = items.some((item) => item.relationships?.appStoreVersion?.data?.id === versionId)
    if (!already) throw err
  }

  await api('PATCH', `/v1/reviewSubmissions/${submission.id}`, {
    data: { type: 'reviewSubmissions', id: submission.id, attributes: { submitted: true } },
  })
}

const build = await waitForBuild()
console.log(`Build ${version} (${buildNumber}) is processed`)

const appStoreVersion = await prepareVersion()
if (appStoreVersion) {
  await api('PATCH', `/v1/appStoreVersions/${appStoreVersion.id}/relationships/build`, {
    data: { type: 'builds', id: build.id },
  })
  await fillWhatsNew(appStoreVersion.id)
  await submitForReview(appStoreVersion.id)
  console.log(`Version ${version} submitted for App Store review`)
}
