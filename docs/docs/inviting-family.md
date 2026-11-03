---
sidebar_position: 4
---

# Inviting family members

There's no public sign-up page — family members join through an invite link an admin generates per group. This is also how you add someone whose email isn't on the [**Allowed email addresses**](./admin-configuration#first-login) list: a valid invite bypasses that check.

1. In `/admin`, click **Add member** — either from the **Users** page, or from a group's detail pane on the **Groups** page (which preselects that group; click **New group** first if it doesn't exist yet).
2. In the **Invite** tab (the default mode), pick the group if it isn't already preselected, optionally enter the invitee's email — this restricts the link to that exact address — and pick an expiry (7 days, 30 days, or never expires). Click **Generate link**, then **Copy** it.
3. Send the link to the person however you'd normally reach them (text, chat, email). The link points at your own server, e.g. `https://famlin.yourdomain.com/invite/<token>`.

## What happens when they open it

The invitation opens a page hosted by your Famlin server. Choose **Continue in
the browser** to join on the web, or **Open in the Famlin app** to use the mobile
app. Store download buttons remain available for people who want to install it.

### In the browser

The link opens `/join/<token>` and shows the family name, description and who
invited you. You can open this page without being signed in.

- **New account:** choose **Create an account**, enter your name, email and a
  password of at least 8 characters, then create the account and join. A valid
  invitation bypasses the allowed-email list.
- **Existing account:** choose **Sign in** and enter your email and password,
  or use the configured single sign-on provider. The invitation accompanies
  sign-in, including the SSO redirect, so signing in also joins the family.
- **Already signed in:** choose **Join &lt;family&gt;** to confirm. You are then taken
  to the feed filtered to that family. If the invite is for a different email,
  sign out on the invitation page and use the invited account.

Email-restricted invitations prefill the invited email address. Expired, used
or invalid links show a clear message; ask the admin for a new link if needed.
A temporary connection error offers a retry instead of treating the link as
invalid.

### In the mobile app

The app hand-off uses a `famlin://invite/<token>?server=...` deep link. If you
do not have an account, the app walks you through creating one with SSO or
email/password. If you are already signed in, you can join with that account.

## Your first invite from the setup wizard

Right after you create the first admin account, the setup wizard (also at `/admin/getting-started`) can create your first family and an invite link in one go. The link can be copied, or shared through your device's share sheet on browsers that support it. It is a normal single-use invite that expires after 14 days; you can manage and revoke it under **Groups** like any other. Until someone has been invited, the dashboard's **Getting started** checklist keeps reminding you.

## Connecting the mobile app with a QR code

Not every relative needs an invite link just to *find* your server. The admin
dashboard (**Connect the mobile app** card) and every member's web profile
(**Connect your phone**) show a QR code for `https://<your-server>/connect`. The code is generated in your browser and contains only the server address — no account, token or invite.

- **With the phone's camera**: scanning it opens the server's `/connect` page, which has an **Open in the Famlin app** button (the `famlin://connect?server=...` deep link), the App Store / Google Play buttons, and the server address for typing it in by hand. If the app is already signed in to this server, nothing changes; if it is signed in to a *different* server, it asks before signing out — it never sends the existing session to another server.
- **From inside the app**: on the login screen, tap **Scan QR code**. The app asks for camera access (used only for scanning; nothing is saved), reads the code and checks the server just as if you had typed the address.

The QR code only tells the app *which server* to talk to. People still need an account — via an [invite link](#what-happens-when-they-open-it) or one an admin created — to sign in.

## Good to know

- Each link is **single-use** — it's consumed as soon as it's successfully used to join. Restricting it to an email address also means only a sign-in with that exact email can consume it; leaving it blank lets anyone with the link claim it.
- Unused invites can be revoked from the same Groups page under **Invites**.
- Treat an invite link like a password — anyone who has it can join the group until it's used, expires, or is revoked. See the [Security policy](./security) page for more on this.
