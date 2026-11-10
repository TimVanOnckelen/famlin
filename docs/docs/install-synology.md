---
sidebar_position: 2.5
title: Install on Synology
---

# Install on Synology with Container Manager

You can install Famlin entirely through Synology's **Container Manager** on DSM 7.2 or newer—no SSH or Docker command line required. For any other Docker host, use [Server setup](./server-setup.md).

## 1. Install Container Manager

Install **Container Manager** from Package Center if it isn't already installed.

## 2. Create the project folder

In **File Station**, create a folder such as `docker/famlin`. This folder will hold the compose file and your optional environment settings.

## 3. Add the compose file

Download [`docker-compose.yml`](https://github.com/TimVanOnckelen/famlin/blob/main/docker-compose.yml) and upload it to the project folder. Each [GitHub release](https://github.com/TimVanOnckelen/famlin/releases) also provides a version-pinned copy.

You don't need a `.env` file: Famlin generates its database password and login secret automatically. To choose advanced startup settings yourself, create `.env` next to the compose file using [Server setup](./server-setup.md#2-configure-environment-variables).

If Container Manager asks you to paste compose content instead of choosing an existing file, prefer the path option so it also reads the `.env` beside the file.

## 4. Create and start the project

1. Open **Container Manager → Project → Create**.
2. Set **Project name** to `famlin`.
3. Set **Path** to the folder you created, such as `/docker/famlin`.
4. For **Source**, choose **Use existing `docker-compose.yml`**.
5. Continue through the summary and select **Done**.

Container Manager pulls the Postgres and pre-built Famlin images, then starts the project. The first download can take a minute.

## 5. Verify the installation

Open **Project → famlin → Container**. The `famlin-db` and `famlin-backend` containers should be running; the one-shot `famlin-init` container exits after creating the database secret.

Open `famlin-backend → Details → Log` to confirm that database migrations completed and the server started.

## 6. Set up HTTPS

The mobile apps need an HTTPS address. Synology's built-in reverse proxy is a natural fit:

1. Open **Control Panel → Login Portal → Reverse Proxy**.
2. Forward your public HTTPS hostname, such as `famlin.yourdomain.com`, to `localhost:3000` over HTTP.
3. Set `TRUST_PROXY=true` in the project's `.env` file and restart the project.

See [Your own reverse proxy](./server-setup.md#option-c-your-own-reverse-proxy) for the required forwarded headers and upload limits, or use the [Cloudflare Tunnel guide](./cloudflare-tunnel.md) if you can't open ports.

## Updates

Download the latest compose file if it changed. In Container Manager, select the project and use **Action → Build** to pull the newest images, followed by **Action → Start**. This is the GUI equivalent of `docker compose pull && docker compose up -d`.

Then continue with [Admin configuration](./admin-configuration.md) to create your family and invite people.
