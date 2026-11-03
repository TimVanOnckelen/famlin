---
sidebar_position: 2
---

# Install on Umbrel or CasaOS

If you run a home server with Umbrel, CasaOS or ZimaOS, you can install Famlin from its app store with a few clicks. No terminal and no configuration files are needed: the database and secrets are set up for you.

:::note Coming soon to the official stores
Famlin is not in the official Umbrel and CasaOS app stores yet. Until it is, add Famlin's own store as described below. It works the same way and gets the same updates.
:::

## Umbrel

1. Open your Umbrel and go to the **App Store**.
2. Click the three dots in the top right and choose **Community App Stores**.
3. Paste `https://github.com/TimVanOnckelen/famlin-umbrel-app-store` and add it.
4. Open the new store, choose **Famlin** and click **Install**.
5. When it is ready, click **Open** and create the first (administrator) account on the setup screen.

## CasaOS and ZimaOS

1. Open the **App Store** and open its settings.
2. Add this source: `https://github.com/TimVanOnckelen/famlin-casaos-app-store/archive/refs/heads/main.zip`.
3. Search for **Famlin** and click **Install**.
4. Open Famlin from the dashboard and create the first (administrator) account.

## After installing

1. Create your family and invite members, see [Inviting family](./inviting-family.md).
2. Photos and videos are kept in the app's data folder on your server. Turn on scheduled backups under *Server settings, Backups* in the admin page.

## Letting your family in from outside your home

Phone apps and invite links need an address that works away from home. Use your platform's own remote access, or put Famlin behind a Cloudflare Tunnel, see [Cloudflare Tunnel](https://famlin.app/docs/cloudflare-tunnel). On Umbrel the proxy is already configured. On CasaOS, set the `TRUST_PROXY` setting to `true` when you use a reverse proxy or tunnel.

## Updating

The store shows an update when a new Famlin version is released. Famlin migrates its database automatically when it starts.
