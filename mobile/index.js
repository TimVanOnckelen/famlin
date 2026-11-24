// Hermes has no WebCrypto: the end-to-end encryption (#506) draws its keys
// from crypto.getRandomValues, so provide it before anything else loads.
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.getRandomValues !== 'function') {
  const { getRandomValues } = require('expo-crypto')
  globalThis.crypto = Object.assign(globalThis.crypto ?? {}, { getRandomValues })
}

const { registerRootComponent } = require('expo')
const BrandedRoot = require('./src/branding/BrandedRoot').default

// Replaces expo/AppEntry.js so the family's cached branding is applied
// before App (and every screen module) is evaluated — see BrandedRoot.
registerRootComponent(BrandedRoot)
