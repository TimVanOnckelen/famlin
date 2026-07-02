---
sidebar_position: 4
---

# Inviting family members

There's no public sign-up page — family members join through an invite link an admin generates per group. This is also how you add someone whose email isn't on the [**Allowed email addresses**](./admin-configuration#first-login) list: a valid invite bypasses that check.

1. In `/admin` → **Groups**, select the group you want to invite someone to, or click **New group** to create one first.
2. Under **Invites**, optionally enter the invitee's email — this restricts the link to that exact address — and pick an expiry (7 days, 30 days, or never expires). Click **Generate link**, then **Copy** it.
3. Send the link to the person however you'd normally reach them (text, chat, email). The link points at your own server, e.g. `https://famlin.yourdomain.com/invite/<token>`.

## What happens when they open it

- It opens a small page hosted by your Famlin server, styled and translated to match the app, which hands off to the mobile app via a `famlin://invite/<token>?server=...` deep link. They need the Famlin app already installed for that to do anything — if you've set **App Store / Google Play URLs** in [Admin configuration](./admin-configuration#first-login), the page also shows download buttons.
- If they don't have an account yet, the app walks them through creating one (OIDC or email/password) — the invite itself is the authorization, so it works even if their email isn't allow-listed.
- If they're already logged in on that device, opening the link just adds their existing account to the group.

## Good to know

- Each link is **single-use** — it's consumed as soon as it's successfully used to join. Restricting it to an email address also means only a sign-in with that exact email can consume it; leaving it blank lets anyone with the link claim it.
- Unused invites can be revoked from the same Groups page under **Invites**.
- Treat an invite link like a password — anyone who has it can join the group until it's used, expires, or is revoked. See the [Security policy](./security) page for more on this.
