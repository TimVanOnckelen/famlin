---
sidebar_position: 2.5
---

# Cloudflare Tunnel

A Cloudflare Tunnel lets family members reach your Famlin server over HTTPS **without opening any ports** on your router and without managing certificates. A small `cloudflared` container on your server makes an outbound connection to Cloudflare, and Cloudflare forwards visitors through it. It also works when your ISP blocks ports 80/443 or puts you behind CGNAT, which rules out [automatic HTTPS with Caddy](./server-setup.md#option-a-automatic-https-with-caddy).

## Trade-offs

- **Cloudflare terminates TLS.** Traffic is decrypted at Cloudflare and re-sent to your server through the tunnel, so Cloudflare can technically see it (see [Security](./security.md)). If that is not acceptable, use Caddy or your own reverse proxy.
- **Your domain must be on Cloudflare** (its DNS managed there). A domain bought elsewhere can be added by switching its nameservers to Cloudflare, which is free.
- **The free plan limits request bodies to 100 MB.** Famlin accepts up to 200 MB per file, so a very large video upload through the tunnel fails on the free plan. Photos and normal phone videos are fine. Paid Cloudflare plans raise the limit.
- Cloudflare's account is a dependency: if it is down or your account is suspended, your family cannot reach the server from outside (your home network keeps working).

## Set up

You need a free Cloudflare account and a domain added to it (**Websites → Add a domain**, pick the Free plan, and update the nameservers at your registrar as Cloudflare instructs). Wait until the domain shows as **Active**.

### 1. Create the tunnel

1. In the Cloudflare dashboard open **Zero Trust**. The first time, choose a team name and the Free plan (a payment method may be requested; the free plan is not charged).
2. Go to **Networks → Tunnels** and click **Create a tunnel**.
3. Choose **Cloudflared** as the connector type, give the tunnel a name such as `famlin`, and save it.
4. On the next screen, pick **Docker** as the environment. Cloudflare shows a command containing `--token eyJ...`. Copy only the long token (the part after `--token`); you do not need to run Cloudflare's command, the overlay does it for you.

### 2. Add the public hostname

Still in the tunnel wizard (or later under **Networks → Tunnels → your tunnel → Edit → Public Hostname**), add a hostname:

- **Subdomain / Domain:** e.g. `famlin` on `yourdomain.com`, giving `famlin.yourdomain.com`.
- **Path:** leave empty.
- **Service type:** `HTTP`
- **URL:** `famlin-backend:3000`, i.e. `http://famlin-backend:3000`. Use the container name, not `localhost`, because `cloudflared` runs in its own container.

Save. Cloudflare creates the DNS record for you.

### 3. Start Famlin with the tunnel

Download `docker-compose.tunnel.yml` (attached to every [GitHub release](https://github.com/TimVanOnckelen/famlin/releases) next to `docker-compose.yml`, and in the repository root) into the same folder as your `docker-compose.yml`, then:

```bash
echo 'CLOUDFLARE_TUNNEL_TOKEN=eyJ...your-token...' >> .env
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d
```

Compose refuses to start if the token is missing. The overlay needs Docker Compose v2.24 or newer. It stops publishing port 3000 on the host and sets `TRUST_PROXY=true` so invite links use your public `https://` address. Use the same `-f` flags for every later `docker compose` command (or set `COMPOSE_FILE=docker-compose.yml:docker-compose.tunnel.yml` in `.env`).

In the Cloudflare dashboard the tunnel should now show as **Healthy**. Open `https://famlin.yourdomain.com/admin` and finish the first-run setup.

## Troubleshooting

- **Tunnel shows "Inactive" or "Down":** run `docker compose -f docker-compose.yml -f docker-compose.tunnel.yml logs cloudflared`. An "unauthorized" or token error means the token was copied incompletely; recreate it from the tunnel's **Overview** page.
- **Error 502 Bad Gateway from Cloudflare:** the public hostname URL is wrong or the backend is not up. It must be `http://famlin-backend:3000` (not `https`, not `localhost`), and `docker compose ps` should show `famlin-backend` as healthy.
- **Large video uploads fail with a network error** but photos work: you have hit the 100 MB free-plan limit described above.
- **Invite links or the QR code show `http://` or a wrong address:** make sure you started with the tunnel overlay (`TRUST_PROXY=true`).
