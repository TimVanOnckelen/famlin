---
sidebar_position: 6
title: Publishing the iOS app
---

# Publishing the iOS app

Famlin ships one shared, pre-built iOS app, but nothing stops you from building and distributing your own via EAS. Either way, App Review checks the same things — and because Famlin is self-hosted, a couple of them need more than "the code is there." This page lists the App Store requirements that shaped the app's design, what already satisfies them, and what you have to supply yourself in App Store Connect.

## What the app already does

| Guideline | Requirement | How Famlin meets it |
| --- | --- | --- |
| 4.8 — Login Services | An app offering a third-party login must also offer a privacy-preserving equivalent | **Sign in with Apple** is offered on iOS next to the SSO button, on both the login and invite screens. It needs no server configuration — see [Sign in with Apple](/docs/admin-configuration#sign-in-with-apple) |
| 5.1.1(ii) — Purpose strings | Each purpose string must say what the data is used for, with a concrete example | `ios.infoPlist` in `mobile/app.config.js` sets explicit photo-library, photo-add and location strings, and the `expo-image-picker` / `expo-media-library` / `expo-location` plugins repeat them so no default text survives |
| 5.1.1(v) — Account deletion | An app supporting account creation must offer in-app account deletion | **Profile → Delete account** in both the mobile and web apps, backed by `DELETE /api/auth/me`. Type-to-confirm, then a permanent cascading delete — no deactivate-only state, and no "email us to delete" |
| 1.5 — Safety | The Support URL must reach a page where users can ask questions and get support | [famlin.app/support](https://famlin.app/support/) — FAQ plus the GitHub Q&A and issue links. Use it as the Support URL, not the marketing home page |

If you edit a purpose string, keep it specific. "Famlin needs photo access" fails review; the string has to name the use and give an example.

## What you have to supply

### Sign in with Apple capability

Sign in with Apple needs the entitlement on your App ID. `mobile/app.config.js` sets `ios.usesAppleSignIn: true` and registers the `expo-apple-authentication` plugin, so an EAS build with managed credentials enables the capability for you. If you manage credentials yourself, enable **Sign In with Apple** for your App ID in the Apple Developer portal before building.

Your build also has its own bundle identifier, and Apple's identity tokens are issued to *that* identifier. Add it to **Extra Apple bundle IDs** in `/admin` → Server settings so your server accepts them — see [Sign in with Apple](/docs/admin-configuration#sign-in-with-apple).

### A reachable demo server

This is the one that isn't a code change. Famlin's login screen asks for a *server address* before anything else, because there's no central Famlin service to sign up to. A reviewer with no address gets no further than the first screen — and an app that appears to do nothing gets rejected under guideline 2.2 as an incomplete or trial build.

So the **App Review Information** section in App Store Connect has to hand them a working instance:

- A publicly reachable Famlin server URL (HTTPS, no VPN, no IP allow-list) with a few groups, posts, photos and comments already in it, so the feed isn't empty.
- Demo account credentials for that server, with the exact server address to type on the first screen written out in the notes — reviewers won't infer it.
- A note explaining that Famlin is self-hosted and every user connects to their own family's server, which is why the app asks for an address first.

Running the server in read-only mode (`READ_ONLY=true`) is a reasonable way to keep a public demo instance from being filled with junk, but be aware the apps disable mutations in that mode — if the reviewer needs to demonstrate posting or account deletion, don't use it.

### An account-deletion screen recording

Since the 5.1.1(v) rejection, App Review asks for a screen recording of the deletion flow captured on a physical device: signing in with the demo account, navigating to the deletion option, and the flow through to confirmation. Record it once, attach it in the **Notes** field of App Review Information, and it carries over to future submissions.

### Store metadata

- **Support URL**: `https://famlin.app/support/` (or your own equivalent if you distribute your own build — it must be a real support page, not a landing page).
- **Privacy Policy URL**: `https://famlin.app/privacy/`.
- Both pages are static HTML under `website/` and deploy with the marketing site; see the deploy section of [Contributing](./contributing).

## Version bumps

`mobile/app.json`'s `version` and `ios.buildNumber` are maintained by release-please, and `app.config.js` derives the Android `versionCode` from them. Don't edit them by hand for a submission — cut a release and build from that.
