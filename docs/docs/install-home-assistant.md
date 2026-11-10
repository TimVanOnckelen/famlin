---
sidebar_position: 3
---

# Install as a Home Assistant add-on

If you already run Home Assistant OS or a Supervised install, you can run Famlin as an add-on. It includes its own database, so there is nothing else to set up.

:::note[Coming soon to the official add-on store]
Famlin is not in Home Assistant's default add-on store. Add Famlin's add-on repository as described below.
:::

## Install

1. Click [![Add repository to my Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FTimVanOnckelen%2Ffamlin-ha-addon) to add the repository. Or do it by hand: go to **Settings, Add-ons, Add-on store**, click the three dots in the top right, choose **Repositories** and add `https://github.com/TimVanOnckelen/famlin-ha-addon`.
2. Open the **Add-on store** and refresh the page.
3. Find **Famlin** in the list, click it and choose **Install**. The first install builds the add-on and can take several minutes.
4. Click **Start**. Watch the **Log** tab until you see Famlin listening.
5. Click **Open Web UI** and create the first (administrator) account.

## Settings

| Option | Default | Meaning |
| --- | --- | --- |
| `trust_proxy` | off | Turn on when Famlin is reached through a reverse proxy or tunnel such as Cloudflared or Caddy. |

## Backups

All data (database, photos and videos, secrets) lives inside the add-on, so Home Assistant's own backups include it. The add-on is briefly stopped while a backup runs.

## Letting your family in from outside your home

Famlin does not use Home Assistant ingress because the phone apps need a normal web address. Nabu Casa remote access cannot forward this port. Use the **Cloudflared** add-on, see [Cloudflare Tunnel](https://famlin.app/docs/cloudflare-tunnel), or forward a port on your router and use the **Caddy** or **DuckDNS** add-on for HTTPS. Then turn on `trust_proxy`.

## Updating

Update the add-on when Home Assistant offers it. Famlin migrates its database automatically on start.
