# Famlin

Private, self-hosted familie-updates-app. Gebouwd met Fastify + Prisma + Postgres backend en een Expo React Native app.

## Snelstart (alleen Docker nodig)

Je hoeft niets lokaal te installeren behalve Docker.

### 1. Omgevingsvariabelen

Kopieer het voorbeeldbestand in de project root en pas de waarden aan:

```bash
cp .env.example .env
```

Vul in `.env` minstens in:

- `JWT_SECRET` — willekeurige lange string (≥32 karakters)
- `GOOGLE_CLIENT_ID` — je Google OAuth iOS/Android client ID
- `ALLOWED_EMAILS` — comma-gescheiden whitelist van familie-e-mailadressen

> Voor **lokale backend development zonder Docker** kun je ook `backend/.env` gebruiken. In Docker worden de waarden uit de root `.env` gebruikt.

### 2. Backend starten

```bash
docker compose up --build
```

De API is dan beschikbaar op http://localhost:3000.

### 3. Database seeden (voorbeelddata)

In een tweede terminal:

```bash
docker compose exec famlin-backend npx prisma db seed
```

Dit maakt een groep "Familie de Vries" met voorbeeldgebruikers en berichten.

### 4. Mobiele app testen

#### Optie A — Expo web preview in Docker

```bash
docker compose -f docker-compose.mobile.yml up
```

Open http://localhost:8081 in je browser.

> Let op: native functies zoals pushmeldingen, camera en Google OAuth werken niet in de web preview.

#### Optie B — Lokale Expo development build

Als je wel Node lokaal hebt (en de backend al in Docker draait):

```bash
cd mobile
cp .env.example .env
# Pas .env aan met je EXPO_PUBLIC_GOOGLE_CLIENT_ID
npm install
npm run ios      # of npm run android
```

Scan de QR-code met Expo Go (iOS) of de Expo Go app (Android).

> **Belangrijk:** Expo leest `.env` uit de `mobile/` map, niet uit de project root. Zet `EXPO_PUBLIC_GOOGLE_CLIENT_ID` en `EXPO_PUBLIC_API_URL` dus in `mobile/.env`.
>
> Zorg dat `EXPO_PUBLIC_API_URL=http://localhost:3000` staat zodat de app tegen je Docker backend praat.

## Projectstructuur

```
famlin/
  backend/          Fastify API, Prisma schema, Docker image
  mobile/           Expo React Native app
  docker-compose.yml        productie/standaard backend stack
  docker-compose.override.yml   lokale dev met hot reload
  docker-compose.mobile.yml     Expo web preview in Docker
```

## Handige commando's

```bash
# Backend logs volgen
docker compose logs -f famlin-backend

# Database resetten
docker compose down -v
docker compose up --build

# Prisma migrations aanmaken
docker compose exec famlin-backend npx prisma migrate dev --name beschrijving

# Prisma Studio openen
docker compose exec famlin-backend npx prisma studio
```

## Productie deploy (Synology)

1. Zorg dat je reverse proxy (Traefik/Nginx) Famlin doorstuurt naar poort 3000.
2. Gebruik `docker-compose.yml` zonder `docker-compose.override.yml`.
3. Zet je `.env` op de NAS.
4. Zorg dat `famlin-db-data` in je bestaande Docker-data folder staat zodat het meegenomen wordt in je backup.

## App Store / Play Store builds

```bash
cd mobile
npx eas build --platform ios
npx eas build --platform android
```

Zorg dat je:
- een EAS project hebt aangemaakt (`eas init`)
- Apple Developer account + certificaten hebt voor iOS
- Google Play Console listing hebt voor Android

## Google OAuth client IDs

Je hebt **aparte OAuth client IDs** nodig voor de backend, de iOS app en de Android app:

1. Maak in Google Cloud Console een OAuth 2.0 client ID aan van type **Web application** → dit is je backend `GOOGLE_CLIENT_ID`
2. Maak een OAuth 2.0 client ID aan van type **iOS** met bundle ID `be.xeweb.famlin` → dit is je `EXPO_PUBLIC_GOOGLE_CLIENT_ID` voor iOS tests
3. Maak een OAuth 2.0 client ID aan van type **Android** met package name `be.xeweb.famlin` → dit gebruik je later voor de Android build

> Let op: gebruik voor de mobiele app de **iOS/Android client ID**, niet de Web client ID.

## Troubleshooting

### `EMFILE: too many open files, watch` (macOS)

Expo's file watcher gebruikt te veel bestanden. Twee oplossingen:

1. **Watchman installeren** (aanbevolen):
   ```bash
   brew install watchman
   ```

2. Of tijdelijk het aantal open bestanden verhogen:
   ```bash
   ulimit -n 8192
   npm run ios
   ```

### Poort 8081 is bezet door Docker

Als je lokaal `npm run ios` draait terwijl de Docker mobile preview ook loopt, kiest Expo automatisch een andere poort. Stop de Docker preview als je lokaal wilt werken:

```bash
docker compose -f docker-compose.mobile.yml down
```

### `expo-secure-store` werkt niet op web

De app gebruikt automatisch `AsyncStorage` op web en `SecureStore` op iOS/Android. Dit is al geconfigureerd in `mobile/src/utils/storage.ts`.
