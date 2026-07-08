"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRandomString = generateRandomString;
exports.generateCodeChallenge = generateCodeChallenge;
exports.clearBrowserOidcLogin = clearBrowserOidcLogin;
exports.startBrowserOidcLogin = startBrowserOidcLogin;
exports.completeBrowserOidcLogin = completeBrowserOidcLogin;
const auth_1 = require("./auth");
// Browser-only OIDC Authorization Code + PKCE flow, shared by the SPA
// surfaces (web/'s LoginPage; backend/admin can adopt it too) so the
// security-sensitive parts — verifier/state generation, the CSRF state
// check, and the token exchange branching — live in exactly one place.
// Uses window.crypto/sessionStorage/fetch, but only inside these functions
// (never at module-eval time), so native consumers can keep importing the
// package barrel safely as long as they don't call these.
const VERIFIER_KEY = 'famlin_oidc_verifier';
const STATE_KEY = 'famlin_oidc_state';
const CONFIG_KEY = 'famlin_oidc_config';
function base64UrlEncode(bytes) {
    let binary = '';
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function generateRandomString(length = 64) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
}
async function generateCodeChallenge(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64UrlEncode(new Uint8Array(digest));
}
// Aborts an in-flight login round trip — completeBrowserOidcLogin() calls
// this itself, but a callback that arrives with ?error= (user denied consent
// at the provider) never reaches the exchange, so the caller must clear the
// stored state explicitly on that path.
function clearBrowserOidcLogin() {
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.removeItem(CONFIG_KEY);
}
// Stores the verifier/state/config for the round trip and returns the
// provider authorization URL — the caller navigates to it. The config is
// persisted alongside the verifier so the callback leg doesn't depend on a
// fresh (and possibly different) /oidc-config response.
async function startBrowserOidcLogin(config, redirectUri) {
    const verifier = generateRandomString();
    const challenge = await generateCodeChallenge(verifier);
    const state = generateRandomString(32);
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);
    sessionStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    const url = new URL(config.authorizationEndpoint);
    url.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: config.scopes,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
    }).toString();
    return url.toString();
}
// Finishes the round trip after the provider redirected back with
// ?code=&state=: validates the state against the stored one (CSRF binding),
// exchanges the code — server-side for providers that require a client
// secret (e.g. Google), directly against the token endpoint otherwise — and
// always clears the stored round-trip state, success or failure. Errors are
// thrown with slug messages, not user-facing text; callers translate.
async function completeBrowserOidcLogin(code, state, redirectUri) {
    try {
        const storedState = sessionStorage.getItem(STATE_KEY);
        const verifier = sessionStorage.getItem(VERIFIER_KEY);
        const configJson = sessionStorage.getItem(CONFIG_KEY);
        if (!storedState || !verifier || !configJson || state !== storedState) {
            throw new Error('oidc_state_mismatch');
        }
        const config = JSON.parse(configJson);
        if (config.usesClientSecret) {
            // Providers that require a client secret reject a secretless PKCE
            // exchange from the browser — hand the code to the backend instead,
            // which holds the secret and does the exchange.
            return await (0, auth_1.exchangeOidcCode)(code, redirectUri, verifier);
        }
        const tokenRes = await fetch(config.tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
                client_id: config.clientId,
                code_verifier: verifier,
            }),
        });
        if (!tokenRes.ok) {
            throw new Error('oidc_token_exchange_failed');
        }
        const tokenData = await tokenRes.json();
        if (!tokenData.id_token) {
            throw new Error('oidc_token_exchange_failed');
        }
        return await (0, auth_1.loginWithOidc)(tokenData.id_token);
    }
    finally {
        clearBrowserOidcLogin();
    }
}
