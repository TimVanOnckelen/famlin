---
sidebar_position: 3
---

# Demo instance

Famlin includes a read-only demo mode for public showcases. It uses the same image as a normal installation but pre-seeds the database with sample data and blocks all mutating requests (`POST`/`PUT`/`PATCH`/`DELETE`) except login endpoints, so visitors can browse but cannot post, comment, upload, or modify anything. For a normal family installation, use [Server setup](/server-setup).

## Run the demo locally

```bash
curl -O https://raw.githubusercontent.com/TimVanOnckelen/famlin/main/docker-compose.demo.yml
# Set a JWT secret and Postgres password, then start:
JWT_SECRET=your-jwt-secret POSTGRES_PASSWORD=your-db-password \
  docker compose -f docker-compose.demo.yml up -d
```

Log in with `admin@example.com` / `test123456` or `test@example.com` / `test123456` to browse the sample family.

The sample data is in English and covers every feature: posts with photos, a milestone, a poll, an event with RSVPs, a trip with check-ins, a shared album, a Family Circle, a gift list with the draw done, family chat, wiki pages, live stories and a Highlight, favorites, an "on this day" memory, and notifications for both demo accounts. The photos are simple illustrations the seed paints into the uploads directory; only the default local storage driver serves them from there. Existing files are left alone, so on a host whose disk is wiped on restart, such as Cloud Run, they're repainted on every start. Live stories and the "on this day" memory are refreshed on every start because both depend on the current date. The seed only creates missing rows; to replace an older demo with the current sample data, empty its database (for Compose: `docker compose -f docker-compose.demo.yml down -v`) and start it again.

While read-only mode is on, both login screens identify the server as a demo and show a demo account—`test@example.com` on the web app and `admin@example.com` on `/admin`—with a button that fills it in. After signing in, a banner explains that it's a demo, and any blocked action shows a notice instead of failing silently. Blocked writes return a `403` whose body contains `"code": "READ_ONLY"`.

:::warning Don't hand the demo instance to an app store reviewer
Read-only mode blocks every mutation except the login endpoints, account deletion (`DELETE /api/auth/me`) included. A reviewer therefore can't post, comment, or delete their account. Give App Review a normal, writable instance and a **non-admin** account; `admin@example.com` is the seed's only admin, and the last remaining admin deliberately can't delete itself.
:::

## Deploy on a free Google Cloud VM

The cheapest always-free option is a Compute Engine `e2-micro` instance in `us-central1`, `us-east1`, or `us-west1`:

1. Create a VM with Container-Optimized OS or Debian/Ubuntu.
2. Install Docker and Docker Compose.
3. Download `docker-compose.demo.yml` and create an `.env` file with `JWT_SECRET` and `POSTGRES_PASSWORD`.
4. Open firewall port `3000`, or put a reverse proxy in front.
5. Run `docker compose -f docker-compose.demo.yml up -d`.

## Deploy on Google Cloud Run

A read-only demo fits Cloud Run's free tier: it scales to zero between visits and gets an HTTPS `*.run.app` address. Cloud Run has no database of its own, so pair it with a free hosted Postgres such as [Neon](https://neon.tech). Use the direct connection string, not the `-pooler` one, with `?sslmode=require`.

Create the service from the Famlin image with:

- **Container port** `3000`, **memory** `1 GiB`, **billing** request-based, **scaling** min `0` / max `1`, and public **authentication**.
- **Command** `sh` with arguments `-c` and `npx prisma migrate deploy && node dist/prisma/seed.js && exec node dist/server.js`, so every start migrates and seeds before serving. Set these with `gcloud run services update <service> --command=sh --args="-c,<that line>"`; the console's argument field doesn't pass `-c` through reliably.
- **Variables** `DATABASE_URL`, `JWT_SECRET` (set explicitly so cold starts don't sign everyone out), `READ_ONLY=true`, and `TRUST_PROXY=true`.

Cloud Run can't pull from `ghcr.io` directly; the setup below adds an Artifact Registry remote repository that proxies it.

## Auto-deploy to Cloud Run

The `deploy-demo` job in `.github/workflows/docker-dev.yml` rolls a Cloud Run demo forward to every new `dev` image after it's published on a merge to `main`. It deploys by digest and only changes the image—the service keeps its variables, command, and scaling. The job is opt-in and is skipped without the repository variables below.

GitHub signs in to Google through Workload Identity Federation, so no key or password is stored. The federation only accepts runs of this repository's `main` branch. Everything involved stays within free tiers; the one possible cost is image storage beyond Artifact Registry's free 0.5 GB, prevented by the cleanup policy below.

### One-time setup

Run these commands in Cloud Shell. Replace the first three values with your own; the remaining commands use them as they are.

```bash
PROJECT=famlin REGION=europe-west1 SERVICE=famlin-demo
GITHUB_REPO=TimVanOnckelen/famlin
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
SA="famlin-demo-deployer@$PROJECT.iam.gserviceaccount.com"
```

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com iamcredentials.googleapis.com sts.googleapis.com
```

```bash
gcloud artifacts repositories create ghcr --location="$REGION" --repository-format=docker --mode=remote-repository --remote-docker-repo=https://ghcr.io
```

```bash
cat > cleanup.json <<'EOF'
[
  {"name": "keep-newest", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 2}},
  {"name": "delete-older", "action": {"type": "Delete"}, "condition": {"tagState": "ANY"}}
]
EOF
gcloud artifacts repositories set-cleanup-policies ghcr --location="$REGION" --policy=cleanup.json --no-dry-run
```

```bash
gcloud iam service-accounts create famlin-demo-deployer --display-name="Famlin demo deployer"
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role=roles/run.developer --condition=None
gcloud iam service-accounts add-iam-policy-binding "$PROJECT_NUMBER-compute@developer.gserviceaccount.com" --member="serviceAccount:$SA" --role=roles/iam.serviceAccountUser
```

The last line lets the deployer act as the service's runtime account. If your service uses a different service account, use that one instead of the default compute account.

```bash
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc famlin --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='$GITHUB_REPO' && assertion.ref=='refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$GITHUB_REPO"
```

Print the values for GitHub:

```bash
cat <<EOF
DEMO_CLOUD_RUN_SERVICE=$SERVICE
DEMO_GCP_PROJECT=$PROJECT
DEMO_GCP_REGION=$REGION
DEMO_GCP_SERVICE_ACCOUNT=$SA
DEMO_GCP_WIF_PROVIDER=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/famlin
DEMO_IMAGE_REPOSITORY=$REGION-docker.pkg.dev/$PROJECT/ghcr
EOF
```

Add each line as a repository **variable** (not a secret) under **Settings → Secrets and variables → Actions → Variables**. The next merge to `main` deploys the demo, and the job log shows the deployed image. To stop auto-deploying, delete `DEMO_CLOUD_RUN_SERVICE`.

A newer image doesn't rewrite the demo's database: the seed only adds missing rows. To reset the demo to the current sample data, empty the database and start a new revision.
