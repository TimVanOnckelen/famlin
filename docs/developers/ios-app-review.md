---
sidebar_position: 6
title: The iOS app
---

# The iOS app

**Apple approval for the official Famlin iOS app is pending.** Until it comes through, there's no App Store listing to link to — family on iPhone or iPad can use the member web app every Famlin server serves at its own address, and self-hosters who want a native build can build their own with EAS (see [Contributing](./contributing)).

The design decisions below exist because of Apple's App Review guidelines, so they're worth knowing about whether you run the official app or your own build.

## How the app meets the guidelines

| Guideline | Requirement | How Famlin meets it |
| --- | --- | --- |
| 4.8 — Login Services | An app offering a third-party login must also offer a privacy-preserving equivalent | **Sign in with Apple** is offered on iOS next to the SSO button, on both the login and invite screens. It needs no server configuration — see [Sign in with Apple](/docs/admin-configuration#sign-in-with-apple) |
| 5.1.1(ii) — Purpose strings | Each purpose string must say what the data is used for, with a concrete example | `ios.infoPlist` in `mobile/app.config.js` sets explicit photo-library, photo-add and location strings, and the `expo-image-picker` / `expo-media-library` / `expo-location` plugins repeat them so no default text survives |
| 5.1.1(v) — Account deletion | An app supporting account creation must offer in-app account deletion | **Profile → Delete account** in both the mobile and web apps, backed by `DELETE /api/auth/me`. Type-to-confirm, then a permanent cascading delete — no deactivate-only state, and no "email us to delete" |
| 1.5 — Safety | The Support URL must reach a page where users can ask questions and get support | [famlin.app/support](https://famlin.app/support/) — FAQ plus the GitHub Q&A and issue links |

If you edit a purpose string, keep it specific. "Famlin needs photo access" fails review; the string has to name the use and give an example.

## Sign in with Apple capability

Sign in with Apple needs the entitlement on your App ID. `mobile/app.config.js` sets `ios.usesAppleSignIn: true` and registers the `expo-apple-authentication` plugin, so an EAS build with managed credentials enables the capability for you. If you manage credentials yourself, enable **Sign In with Apple** for your App ID in the Apple Developer portal before building.

Your build also has its own bundle identifier, and Apple's identity tokens are issued to *that* identifier. Add it to **Extra Apple bundle IDs** in `/admin` → Server settings so your server accepts them — see [Sign in with Apple](/docs/admin-configuration#sign-in-with-apple).

## Version bumps

`mobile/app.json`'s `version` and `ios.buildNumber` are maintained by release-please, and `app.config.js` derives the Android `versionCode` from them. Don't edit them by hand — cut a release and build from that.
