# Claude Code — Startinstructies Famlin

## Project in één zin

**Famlin** is een private, self-hosted familie-updates-app (Facebook-achtig: posts, foto's, comments, likes, mijlpalen) met een Expo/React Native app voor iOS en Android, een Node-backend op Synology, Google OAuth login (gedeeld met bestaande Immich-setup), en read-only integratie met Immich voor foto's.

## Naamgeving in code

Gebruik consequent deze identifiers doorheen het project:

- **App display-naam**: Famlin
- **Repo-naam**: `famlin` (of `famlin-app`)
- **Expo `app.json` slug**: `famlin`
- **iOS bundle identifier**: `be.[jouwdomein].famlin` (pas `[jouwdomein]` aan naar je eigen reverse-domain, bv. `be.xeweb.famlin`)
- **Android package name**: zelfde patroon, bv. `be.xeweb.famlin`
- **Docker container/service-namen**: `famlin-backend`, `famlin-db`
- **Database-naam**: `famlin`

## Architectuur

- **Backend**: Node.js + Fastify (of Express), Postgres, Prisma ORM. Draait als Docker container(s) op Synology naast de bestaande stack (Immich, etc.).
- **Auth**: Google OAuth 2.0, eigen client-ID in hetzelfde Google Cloud project als Immich. Backend valideert Google ID-tokens; eigen sessie/JWT voor de app.
- **Mobile app**: Expo (React Native), zelfde stack als het bestaande Prompt Punk-project (Expo SDK, Zustand voor state). Native iOS + Android build via EAS.
- **Foto's**: geen eigen opslag — read-only calls naar de Immich API om gedeelde albums/foto's op te halen en te tonen.
- **Groepen**: posts horen altijd bij precies 1 groep (bv. "Familie A", "Familie B"). Gebruikers kunnen lid zijn van meerdere groepen tegelijk. Alleen de admin (jij) maakt groepen aan en beheert lidmaatschap — geen self-service group-creation voor MVP.
- **Notificaties**: in-app push via Expo's push-service (vereist een development/production build, werkt niet in Expo Go) + e-mail als fallback/aanvulling.
- **Geen Next.js, geen webversie, geen Supabase** — bewuste keuze, zie eerdere discussie: te zwaar voor Synology, en de native app is de hoofdinterface.

## Stap 1 — Repo en projectstructuur

Vraag Claude Code om een monorepo op te zetten met twee mappen:

```
famlin/
  backend/        (Fastify + Prisma + Postgres)
  mobile/         (Expo app)
  docker-compose.yml
```

Gebruik npm workspaces of gewoon twee losse package.json's — geen overkill met Turborepo/Nx voor een project van deze omvang.

## Stap 2 — Backend opzetten

Prompt voor Claude Code:

> Zet een Fastify-backend op in `backend/` met TypeScript, Prisma als ORM tegen Postgres, en de volgende routes: auth (Google OAuth token-validatie), groups (admin-only CRUD + lidmaatschapsbeheer), posts (CRUD, gefilterd op groepslidmaatschap van de ingelogde user), comments, likes, notificaties (push-token registratie + notificatie-historiek), en een Immich-proxy-endpoint dat albums/foto's ophaalt via de Immich API met een server-side API-key (niet client-side, om de Immich-credentials niet bloot te stellen aan de mobiele app).
>
> Belangrijk: zorg dat elke posts-query filtert op groepen waar de ingelogde user lid van is — een user mag nooit posts zien uit een groep waar die geen lid van is. Groepen aanmaken/bewerken/leden toevoegen of verwijderen mag alleen door een user met `isAdmin = true`.

Geef daarbij dit Prisma-datamodel als startpunt mee:

```prisma
model User {
  id              String   @id @default(cuid())
  email           String   @unique
  name            String
  avatarUrl       String?
  createdAt       DateTime @default(now())
  isAdmin         Boolean  @default(false)
  pushTokens      PushToken[]
  groupMemberships GroupMember[]
  posts           Post[]
  comments        Comment[]
  likes           Like[]
  notifications   Notification[]
}

model Group {
  id          String   @id @default(cuid())
  name        String
  description String?
  createdAt   DateTime @default(now())
  members     GroupMember[]
  posts       Post[]
}

model GroupMember {
  id       String  @id @default(cuid())
  groupId  String
  group    Group   @relation(fields: [groupId], references: [id])
  userId   String
  user     User    @relation(fields: [userId], references: [id])
  joinedAt DateTime @default(now())

  @@unique([groupId, userId])
}

model Post {
  id              String   @id @default(cuid())
  authorId        String
  author          User     @relation(fields: [authorId], references: [id])
  groupId         String
  group           Group    @relation(fields: [groupId], references: [id])
  content         String?
  type            PostType @default(UPDATE)
  immichAlbumId   String?
  immichAssetIds  String[]
  createdAt       DateTime @default(now())
  comments        Comment[]
  likes           Like[]
}

enum PostType {
  UPDATE
  MILESTONE
}

model Comment {
  id        String   @id @default(cuid())
  postId    String
  post      Post     @relation(fields: [postId], references: [id])
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
  content   String
  createdAt DateTime @default(now())
}

model Like {
  id       String @id @default(cuid())
  postId   String
  post     Post   @relation(fields: [postId], references: [id])
  userId   String
  user     User   @relation(fields: [userId], references: [id])

  @@unique([postId, userId])
}

model PushToken {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  token     String   @unique
  createdAt DateTime @default(now())
}

model Notification {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  type      String   // bv. "new_post", "new_comment", "new_like"
  relatedPostId String?
  message   String
  readAt    DateTime?
  createdAt DateTime @default(now())
}
```

**Belangrijke datamodel-keuzes:**

- `GroupMember` is een many-to-many koppeltabel: een user kan in meerdere groepen zitten, een groep heeft meerdere leden.
- `Post.groupId` is verplicht — elke post hoort bij precies 1 groep. Alleen leden van die groep zien de post.
- `User.isAdmin` bepaalt wie groepen mag aanmaken/beheren (alleen jij, voor MVP).
- `PushToken` slaat Expo push tokens op, gekoppeld aan user (een user kan meerdere devices/tokens hebben).
- `Notification` is een interne tabel voor in-app notificatie-geschiedenis (los van de daadwerkelijke push-verzending).

## Stap 3 — Google OAuth configureren

1. Ga naar dezelfde Google Cloud Console waar je Immich's OAuth-client al staat.
2. Maak een **nieuwe** OAuth 2.0 Client ID aan, type "iOS" en "Android" (Expo genereert hiervoor specifieke bundle/package IDs — gebruik `expo-auth-session` documentatie voor de exacte redirect URI's).
3. Whitelist alleen de familie-e-mailadressen server-side (zelfde patroon als je Immich-config).

Prompt voor Claude Code:

> Implementeer Google OAuth login in de Expo-app met `expo-auth-session`, en een backend-endpoint die het Google ID-token verifieert en een eigen sessie-JWT teruggeeft.
>
> Implementeer ook een e-mail-whitelist (zelfde patroon als bij Immich): een environment variable `ALLOWED_EMAILS` (comma-separated lijst) die de backend checkt bij elke Google-login-poging. Iemand die niet op de lijst staat krijgt een duidelijke foutmelding, geen automatische account-aanmaak.

## Stap 4 — Admin: groepen en leden beheren

Voor MVP hoeft dit geen volledig UI-paneel te zijn, maar moet wel praktisch werkbaar zijn vanaf dag 1:

Prompt voor Claude Code:

> Bouw een minimale admin-flow voor groepenbeheer: ofwel een paar simpele admin-only API-routes (`POST /api/admin/groups`, `POST /api/admin/groups/:id/members`) die ik via Postman/Insomnia kan aanroepen, ofwel — als dat sneller is — een Prisma seed-script (`backend/prisma/seed.ts`) waarin ik groepen en hun leden als data kan invullen en met `npx prisma db seed` kan toepassen. Kies de optie die het snelst werkt voor een MVP met een handvol vaste groepen.

**Te beslissen voor je begint**: wat er gebeurt met een groep waar iemand uit verwijderd wordt — blijven hun bestaande posts/comments zichtbaar voor de overige leden (aanrader voor MVP, simpelst om te implementeren) of worden ze verborgen/verwijderd? Leg deze keuze vooraf vast, anders wordt het impliciet bepaald door wat Claude Code toevallig bouwt.

## Stap 5 — Immich-integratie

Prompt voor Claude Code:

> Bouw een backend-endpoint `/api/immich/albums/:albumId` dat foto's uit een Immich-gedeeld-album ophaalt via de Immich API (gebruik de Immich API-docs op api.immich.app), met server-side caching (bijv. 5 minuten) om de Immich-server niet te overbelasten bij elke feed-refresh.

Let op: bewaar de Immich API-key als environment variable in de backend, nooit in de mobile app.

## Stap 6 — Notificaties (in-app push + e-mail)

In-app push via Expo vereist een development of production build — werkt niet in Expo Go op Android sinds SDK 53. Dit valt toch al onder je EAS Build-plan, dus geen extra complicatie.

Prompt voor Claude Code:

> Implementeer notificaties in twee delen:
>
> 1. **In-app push (Expo)**: in de mobile app, registreer het Expo push token bij het inloggen (via `expo-notifications` en `expo-device`) en stuur dit naar een backend-endpoint `/api/push-tokens` om op te slaan. Bouw in de backend een notificatieservice met de `expo-server-sdk-node` package die, bij een nieuwe post/comment/like binnen een groep, een push-bericht stuurt naar alle groepsleden (behalve de auteur zelf) via hun opgeslagen Expo push tokens.
> 2. **E-mail notificaties**: bouw een eenvoudige e-mailservice (bijvoorbeeld via Nodemailer met een SMTP-provider) die bij dezelfde events (nieuwe post, comment) een e-mail stuurt naar groepsleden. Maak dit instelbaar per gebruiker (een `emailNotificationsEnabled`-veld op `User`), zodat niet iedereen per se e-mails wil.
>
> Beide notificatietypes moeten rekening houden met groepslidmaatschap: alleen leden van de groep waarin de post/comment is geplaatst krijgen een notificatie.

## Stap 7 — Expo app

Prompt voor Claude Code:

> Zet een Expo-app op in `mobile/` met als app-naam "Famlin": een feed-scherm (FlatList met posts, gefilterd op de groep die de user momenteel bekijkt, met een groepswisselaar bovenaan als de user in meerdere groepen zit), een post-detail-scherm met comments, een "nieuwe post"-scherm (tekst + optioneel Immich-album-picker + verplichte groepskeuze als de user in meerdere groepen zit), een notificaties-scherm (lijst van recente meldingen), en een instellingen-scherm (incl. toggle voor e-mail-notificaties). Gebruik Zustand voor state, React Query voor data-fetching/caching tegen de backend-API. Implementeer Expo push-token-registratie bij het inloggen.

## Stap 7 — Docker Compose voor Synology

Vraag Claude Code om een `docker-compose.yml` met:

- `famlin-db` service (officiële Postgres image, volume voor persistente data)
- `famlin-backend` service (gebouwd vanuit `backend/Dockerfile`)
- Reverse proxy via je bestaande Synology setup (Traefik/Nginx — vraag na wat je al draait voor Immich en hergebruik dat patroon)

**Backup**: zorg dat het Postgres-datavolume in dezelfde shared folder staat als je andere Docker-data, zodat het automatisch wordt meegenomen in je bestaande offsite-backup-routine naar de DS223j bij je ouders. Voeg dit niet toe als losse, makkelijk te vergeten taak — het hoort vanaf het begin in dezelfde backup-scope als de rest van je NAS-stack.

## Stap 8 — EAS builds voor App Store / Play Store

Prompt voor Claude Code:

> Configureer EAS Build (`eas.json`) voor zowel iOS als Android productie-builds, en leg uit welke Apple Developer / Google Play Console stappen ik zelf moet zetten (deze kan Claude Code niet voor je doen — account, certificates, store listings zijn handmatige stappen).

## Volgorde-advies

Werk in deze volgorde om snel iets werkends te hebben: (1) backend met auth + groepen + basic CRUD, (2) Expo-app met login + groepswisselaar + feed (nog zonder Immich/notificaties), (3) Immich-integratie erbij, (4) notificaties (push + e-mail), (5) polish (milestones, EAS build). Test elke stap lokaal voor je naar Synology deployt.
