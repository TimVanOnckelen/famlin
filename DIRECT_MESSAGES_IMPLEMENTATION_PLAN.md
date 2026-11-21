# Direct messages: full implementation plan

## Status and delivery target

This document is the implementation handoff for a **single, end-to-end release**. The feature is not to be split into backend-only, schema-only, or client-only work. Development can proceed in dependency order, but the resulting PR/release must contain:

- backend schema, services, authorization, routes, notifications, exports, and restore support;
- shared API client contracts;
- web and mobile member-facing UI;
- i18n for all supported locales;
- OpenAPI and user/developer documentation;
- generated API-client and API-reference artifacts where the repository requires them;
- focused unit/integration/UI coverage.

No unrelated refactor should be included.

## Product specification

### Included

- Private, one-to-one direct-message conversations.
- Exactly one stable conversation per unordered pair of users.
- Direct messages are reached from the existing Chat area, alongside family chats; no new top-level tab.
- Web and mobile ship together.
- A user can start a conversation only with someone with whom they currently share at least one family.
- The recipient picker is searchable, deduplicates members shared through multiple families, and excludes the current user.
- Opening an existing recipient reuses the existing conversation.
- Messages contain:
  - text only;
  - one or more media attachments; or
  - text plus one or more media attachments.
- Up to 10 image/video attachments per message.
- Existing upload formats, compression, mobile 120-second video policy, server limits, thumbnail/poster generation, authenticated media serving, and upload authorization are reused.
- Cursor-paginated message history, newest page first, loaded upward in chronological display order.
- Per-conversation unread counts plus an unread indicator on the Chat tab.
- A per-user, per-conversation last-read timestamp.
- Visibility-aware polling while a conversation is open (approximately every 6 seconds, matching existing chat); push notifications handle background delivery.
- A DM inbox sorted by most recent message.
- Inbox preview: participant name/avatar, timestamp, text or media summary, and unread count.
- Sender can hard-delete only their own message. The deletion is visible to both participants and cleans up unreferenced DM media.
- Message editing is not included.
- Conversation-wide deletion is not included.
- Reactions, replies/threading, forwarded messages, and typing indicators are not included.
- Per-user blocking is not included.
- Push-only DM notifications with a dedicated user preference, enabled by default.
- Push content is privacy-safe: sender name plus a generic “new direct message”; no body text or attachment summary.
- DMs are not exposed in normal admin moderation/content screens.
- Participant-visible DMs are included in self-service member export.
- DMs and their data participate in full admin backup and restore.

### Critical visibility rule

The authorization boundary is evaluated live:

> Both users must currently share at least one family.

This applies to conversation discovery, opening history, sending, marking read, message deletion, inbox previews, unread counts, notification routing/deep-link access, member export, and `/uploads/` media access.

If no shared family remains:

- the conversation is immediately hidden from both users;
- new messages are rejected;
- attachments become unreadable;
- stale inbox/push data must resolve safely as “not available”;
- the rows and history remain stored;
- if the users later share a family again, the prior conversation and history become visible again.

No stale conversation-level “allowed at creation” flag is sufficient. Shared membership must be rechecked from current `GroupMember` state.

### Non-goals

- Multi-person private conversations.
- Group circles as a special DM audience.
- Direct messages to arbitrary users on the same server.
- Email notifications.
- End-to-end encryption.
- Real-time WebSocket/SSE delivery.
- Admin DM moderation.
- Message-level read receipts, “delivered” status, or online presence.
- A separate DM navigation tab.
- One-sided “delete for me.”

## Current-codebase knowledge

### Existing group chat

Existing group chat is implemented across:

- `backend/src/routes/chat.ts`
- `backend/src/services/chat.ts`
- `backend/src/__tests__/chat.test.ts`
- `packages/api-client/src/chat.ts`
- `web/src/pages/ChatPage.tsx`
- `web/src/pages/ChatPage.css`
- `mobile/src/screens/ChatScreen.tsx`
- `mobile/src/screens/ChatGroupPickerScreen.tsx`

Important current behavior:

- Group chat is selected by `groupId`, not by participant.
- Group listing/sending requires current `GroupMember` membership and `Group.chitchatEnabled`.
- Group chat supports text, one `attachmentUrl`, and replies.
- Messages are cursor-paginated by ID, default 30, maximum 100.
- `ChatRead` stores one `lastReadAt` per `(groupId, userId)`.
- Group unread counts are computed for memberships and polled by shell/navigation.
- Group chat is push-only and uses `User.pushOnChitchat`.
- Existing group-chat semantics must remain intact. DMs should be adjacent behavior, not a reinterpretation of the `groupId` model.

### Web patterns

- `web/src/pages/ChatPage.tsx` is the current two-pane, group-scoped chat surface.
- Web’s message query is `['chatMessages', activeGroupId]`.
- Web shell unread queries use `['chat-unread']`.
- The conversation polls every 6 seconds while the document is visible.
- Sending currently uploads first and patches the newest infinite-query page.
- Existing code preserves near-bottom scrolling and older-page viewport position.
- Reusable UI includes:
  - `Avatar`, `AvatarStack`, `Icon`
  - `ShimmerImage`
  - `UploadMedia`
  - `Lightbox`
  - `useModalFocus`
- `web/src/hooks/useComposerUploads.ts` already supports multi-file selection, progress, removal, preview, and errors.
- The established maximum is `MAX_COMMENT_ATTACHMENTS = 10`.
- `Lightbox` accepts an array of asset URLs.
- `GiftListParticipantPicker.tsx` and `MembersPage.tsx` provide member-query/search patterns.
- `ProfilePage.tsx` is where notification preferences are rendered.
- There is currently no ChatPage test.
- English chat strings are in `web/src/i18n/locales/en.json`; equivalent files exist for all five locales.

### Mobile patterns

- `mobile/src/screens/ChatScreen.tsx` is group-scoped and polls every 6 seconds.
- `mobile/src/navigation/MainTabs.tsx` polls unread counts every 30 seconds and displays the Chat badge.
- `mobile/src/screens/ChatGroupPickerScreen.tsx` selects an enabled family chat.
- `mobile/src/hooks/usePickAndUploadMedia.ts` already handles multi-upload, per-file progress, compression, partial failure, and the 120-second video restriction.
- `MediaThumbnail` and `ImageViewerScreen` provide existing media rendering/navigation.
- `ProfileScreen.tsx` renders notification preferences.
- `usePushNotifications.ts` currently deep-links only post/story notifications; DM navigation must be added for warm and cold starts.
- Authenticated screens must remain lazily loaded through `mobile/src/navigation/AuthenticatedScreens.tsx` to preserve the branding initialization boundary.
- Current English mobile chat strings live in `mobile/src/i18n/locales/en.json`.

### Backend upload/privacy pattern

`/uploads/*` is authorized per request, not by URL secrecy.

- `backend/src/services/uploads.ts` owns upload binding and `canReadUpload`.
- `bindAssetsToScope` only binds unbound uploads owned by the uploader, or extends eligible group scope by the uploader.
- `Upload` currently supports circle, group-list, and server-wide scopes.
- Existing group chat binds attachments to the whole group.
- A DM attachment must not be bound to every member of a shared family.
- A DM-specific upload scope/reference is required, and `canReadUpload` must live-check the DM conversation’s current shared-family eligibility.
- All attachment paths must continue to pass `uploadPathSchema`.
- Message creation and upload binding must happen in one transaction so an accepted message never contains silently unbound media.

### Notification pattern

- Domain events are emitted after committed writes.
- `backend/src/subscribers/notifications.ts` owns recipient/notification policy.
- Push delivery is centralized in `services/notificationChannels/push.ts`.
- Existing notification types live in `services/notificationChannels/types.ts`.
- `Notification` currently relates to posts/stories, not DM conversations.
- DMs should emit a DM-specific event and notify exactly the other participant.
- The subscriber, not the route, should own notification policy.
- If a DM is created while participants no longer share a family, the subscriber must not notify.
- DM pushes are push-only. They must not use group-chat content text or email.
- New push navigation requires a stable conversation identifier in notification payload/API data.

### Export/restore/delete patterns

- Posts, comments, users, and messages are hard-deleted; there is no soft-delete model.
- Removing a family member deletes relevant circle membership, but preserved group posts/comments remain.
- User deletion cascades database relations and requires application-level cleanup for media that is stored on disk.
- Admin export is implemented in `backend/src/services/export.ts`.
- Member export is implemented separately and fail-closed in `backend/src/services/memberExport.ts`.
- Restore is implemented in `backend/src/services/import.ts`.
- Existing export/restore coverage lives under `backend/tests/`.
- A new family-content table must be represented in export, import, and round-trip restore tests.
- Full backup must carry DM conversations, messages, read state, notification-deep-link references if retained, and associated uploads.
- Member export must include only currently visible DMs and upload files those exported rows reference.
- Notifications are normally excluded from backup; follow that policy unless a schema relation itself requires cleanup.

### Shared API client and compatibility

- Add a dedicated `packages/api-client/src/dms.ts`; do not overload group-chat types if their identity and read/participant semantics differ.
- The barrel in `packages/api-client/src/index.ts` uses named exports, never `export *`.
- The committed `dist/` package is consumed by mobile and production builds; run `npm run build:api-client` and include required generated output.
- Add a server feature ID in:
  - `backend/src/serverFeatures.ts`
  - `packages/api-client/src/features.ts`
- Mark API-client calls that are unavailable to the oldest supported server with `// requires-feature: <id>` where required by `scripts/check-client-vs-old-spec.mjs`.
- Older mobile/web builds are not expected to know about DMs; new clients must degrade cleanly against servers that do not advertise the feature.
- OpenAPI is hand-maintained in `docs/openapi/famlin.yaml`; generated API-reference output is not hand-edited.
- `feat` work requires a docs change unless an exceptional `Docs-not-needed` justification is supplied.

## Proposed backend data model

### `DirectConversation`

Canonical two-participant model:

```text
DirectConversation
- id
- participantAId
- participantBId
- createdAt
- updatedAt

relations
- participantA -> User
- participantB -> User
- messages -> DirectMessage[]
- reads -> DirectRead[]
```

Constraints:

- `participantAId < participantBId` according to one deterministic server-side canonicalization rule.
- unique index on `[participantAId, participantBId]`.
- `participantAId != participantBId` is validated in application service code.
- indexes for each participant to support inbox lookup.
- `participantA` and `participantB` use Prisma relation aliases.
- participant foreign keys cascade conversation deletion when an account is hard-deleted.

Why canonical columns rather than a join table:

- the feature is strictly 1:1;
- a unique unordered pair can be enforced at the database level;
- participant lookup is simple and bounded;
- the schema does not imply support for future group-DM semantics that are intentionally out of scope.

If the canonical ordering cannot be expressed safely for every persisted user ID type, use a separate composite `participantPairKey` with the same canonicalization and unique constraint, but the pair still must be explicit in relational columns for authorization/querying.

### `DirectMessage`

```text
DirectMessage
- id
- conversationId
- authorId
- content          nullable string, trimmed, max 2000
- attachmentUrls   String[] default []
- createdAt

relations
- conversation -> DirectConversation, cascade on conversation delete
- author -> User

indexes
- [conversationId, id] for cursor paging
- [authorId]
```

Validation:

- `attachmentUrls.length <= 10`.
- At least one of `content` or attachments must be present.
- Remove duplicate attachment URLs while preserving order.
- Every path passes `uploadPathSchema`.
- Every attachment is owned by the sender and currently unbound before binding.
- No client-provided metadata or arbitrary URLs are accepted.

No legacy singular `attachmentUrl` is needed because DMs are new and no installed client depends on the shape.

### `DirectRead`

```text
DirectRead
- conversationId
- userId
- lastReadAt

relations
- conversation -> DirectConversation, cascade
- user -> User, cascade

unique
- [conversationId, userId]
```

Mark-read must verify:

- caller is a participant;
- caller currently shares a family with the other participant.

### `Upload` DM scope

Extend `Upload` with a DM-specific scope:

```text
directConversationId?: String
```

Rules:

- nullable, indexed;
- not a general “any participant” array;
- `canReadUpload` resolves the conversation and verifies that the requesting user is one of the two participants and that the pair currently shares a family;
- an inaccessible conversation yields 404 for the upload;
- DM attachments are never scoped to `groupIds` or `circleId`;
- DM scope remains separate from group chat and post scopes.

Keeping the scalar scope on `Upload` matches the existing reverse-index upload model. A relational FK is optional, but do not accidentally make conversation deletion silently grant wider access. If the conversation is deleted, the upload rows/files must be explicitly cleaned up.

### User preference

Add:

```text
User.pushOnDirectMessage = true
```

Expose it through:

- backend profile shape;
- `PATCH /api/auth/me`;
- shared user/API types;
- web profile toggle;
- mobile profile toggle;
- OpenAPI.

### Notification relation

Add a nullable `relatedDirectConversationId` to `Notification`, with `SetNull` if conversation rows can be removed.

Either participant’s DM notification:

- has type `new_direct_message`;
- targets only the other participant;
- contains no message body or attachment text;
- carries a conversation identifier sufficient for warm/cold-start navigation;
- is hidden or handled as unavailable if the current shared-family condition no longer holds.

### Migration

The migration must:

1. create the three DM tables/indexes/constraints;
2. add the upload DM scope;
3. add `User.pushOnDirectMessage`;
4. add notification relation/foreign key if nullable conversation deep-link storage is selected;
5. avoid renaming or deleting shipped migrations.

Generate Prisma Client after the schema change.

## Backend authorization and services

### Shared-family service

Add a small service used everywhere, conceptually:

```ts
shareAnyGroup(userAId, userBId): Promise<boolean>
findEligibleConversationForUser(conversationId, userId): Promise<... | null>
canonicalParticipantPair(userAId, userBId)
```

Use a single query to find overlapping `GroupMember` rows. Do not cache eligibility; revocation after member removal must be immediate.

Every DM operation must compose both conditions:

1. caller is one of the conversation participants;
2. pair currently shares a group.

This service must be reused by:

- routes/services;
- inbox and unread calculation;
- upload authorization;
- notification subscriber filtering;
- member export.

### Visibility response policy

Use 404 for a conversation that does not exist, does not involve the caller, or is currently ineligible. This avoids disclosing another pair’s conversation existence and matches privacy-sensitive single-item behavior.

For create-by-recipient:

- self-recipient: 400 validation error;
- recipient does not exist: 404;
- no shared group: 403 or 404 according to a single, tested policy; prefer 404 if account enumeration is a concern;
- existing pair: return the existing conversation instead of 409;
- two simultaneous creates: database unique constraint/upsert resolves to one canonical row.

### Route contract

Register a dedicated DM route module under `/api/dms`. Do not overload `/api/chat` with ambiguous group/participant semantics.

#### `GET /api/dms/people`

Returns eligible recipients for the new-message picker:

```ts
{
  items: Array<{
    id: string
    name: string
    avatarUrl: string | null
  }>
}
```

Rules:

- all users sharing at least one current group with the caller;
- deduplicated by user ID;
- current user excluded;
- deterministic name order;
- pagination only if member count can become unbounded; use the repository’s pagination convention rather than returning an unbounded list once the data shape warrants it.

An alternative is returning family member IDs from existing group-member queries and deduplicating client-side. A backend endpoint is preferable because it is the authoritative eligibility set, supports mobile/web parity, and prevents each client from implementing slightly different privacy rules.

#### `POST /api/dms`

Body:

```ts
{ participantId: string }
```

Returns the conversation summary. Idempotent for an existing pair.

#### `GET /api/dms`

Returns inbox items for currently eligible conversations:

```ts
{
  items: Array<{
    id: string
    participant: { id: string; name: string; avatarUrl: string | null }
    lastMessage: {
      id: string
      authorId: string
      content: string | null
      attachmentCount: number
      createdAt: string
    } | null
    unreadCount: number
    updatedAt: string
  }>
}
```

Requirements:

- only eligible conversations;
- newest activity first;
- never return hidden conversations;
- inbox message content is okay internally in an authenticated participant response;
- no participant data beyond the existing member-safe fields.

#### `GET /api/dms/unread`

Returns:

```ts
{
  total: number
  byConversation: Record<string, number>
}
```

Only currently eligible conversations contribute.

#### `GET /api/dms/:conversationId/messages?cursor=&take=`

Returns:

```ts
{
  items: DirectMessage[]
  nextCursor: string | null
}
```

- cursor pagination newest-first at the transport layer;
- fetch one extra row per shared pagination helper;
- whole reply threading is not relevant because replies are out of scope;
- 404 if hidden/ineligible.

#### `POST /api/dms/:conversationId/messages`

Body:

```ts
{
  content?: string
  attachmentUrls?: string[]
}
```

Response is the created message.

Flow:

1. validate Zod body;
2. resolve an eligible conversation in one authorization step;
3. validate attachments belong to uploader and remain bindable;
4. create the message and bind all attachment upload rows to the DM conversation in one database transaction;
5. update `conversation.updatedAt`;
6. commit;
7. emit `direct_message.created`;
8. return shaped message.

No broad catches. Expected eligibility/validation errors use translated, non-sensitive responses. Unexpected errors propagate to the global handler.

#### `POST /api/dms/:conversationId/read`

Upsert caller read state to the server time (or an accepted latest-message timestamp if the API design requires it).

Invalidate client DM unread caches. Do not create per-message receipt history.

#### `DELETE /api/dms/messages/:messageId`

- route shape may instead be `/api/dms/:conversationId/messages/:messageId`; use one consistent convention in OpenAPI/client.
- resolve message/conversation;
- require currently eligible participant and `authorId === caller.id`;
- no admin bypass;
- transactionally delete the message;
- determine media no longer referenced by any content source;
- delete orphaned DM upload rows/files after commit;
- invalidate conversation/inbox caches.

Hard delete means the other participant sees the message disappear on the next query/poll. Do not add deletion tombstones.

### Inbox/read/unread query efficiency

Implement batching, not N+1 per conversation:

- query eligible conversation IDs via participants and shared-group condition;
- fetch latest messages in a grouped/latest-per-conversation query;
- count unread messages after `DirectRead.lastReadAt`;
- sort in SQL by latest activity where practical.

For a first implementation, a bounded list of conversations is acceptable only if the existing user count is small and the endpoint uses an explicit cap. Prefer cursor pagination from the start if query complexity is similar.

### Notification event

Add a typed event, for example:

```text
direct_message.created
{
  message
  conversation
  recipientId
}
```

Subscriber responsibilities:

1. recheck the recipient is the other participant;
2. recheck current shared-family eligibility;
3. skip if sender == recipient;
4. honor `pushOnDirectMessage`;
5. create `Notification` row and send push through the existing channel;
6. use localized generic copy with sender name only;
7. never include `content` or attachment metadata in push/email text.

No DM email channel implementation is included.

Push payload/deep-link data should carry:

```text
relatedDirectConversationId
```

The clients open `/chat?...` or the corresponding mobile route only after validating/handling current eligibility.

### Account and membership deletion

#### Group member removal

No new database mutation is required to hide DMs because shared-family membership is rechecked live. The member-removal flow is still a critical test trigger:

- removing one shared family must hide only if it was the last shared family;
- removing one of several shared families must not hide;
- re-adding a family restores visibility.

#### Account deletion

Deleting either participant cascades:

- their conversations;
- DM messages via conversation cascade;
- DM read rows.

Before user deletion, collect DM-upload UUIDs/files that are exclusively associated with the deleting user’s conversations and clean them after the database deletion. Reuse/extend the existing upload deletion helper so no physical files remain orphaned.

Do not let a generic reference scan treat a DM upload path as group/server-visible media if it is still used elsewhere. DM attachment binding should be exclusive and the cleanup rule should be tested.

### Read-only and rate limits

- existing `readOnly` middleware must reject conversation create, send, delete, and mark-read mutations as it rejects other writes;
- use the global rate limit unless abuse testing proves a DM-specific send limit is necessary;
- do not introduce an untested per-recipient throttling policy in this feature.

## Backend export, backup, member export, and restore

### Full admin export

Add data entries for:

- direct conversations;
- direct messages;
- direct-read rows;
- any DM fields in user/upload/notification representations when relevant.

Include the referenced upload originals/display copies/thumbnails/posters. Keep media collection aligned with the existing admin export behavior.

Update archive manifest counts and formats. Increment archive format only if backward compatibility requires it. Older archives must restore with DM fields absent because the feature did not exist.

### Restore

Update:

- `backend/src/services/import.ts` Zod shapes;
- transaction insert ordering;
- ID preservation;
- user/foreign-key relations;
- new optional data file handling;
- upload-scope restore.

Restore into an empty instance should preserve canonical pair uniqueness and relationships. Restored read state and message timestamps must be retained exactly.

### Member export

`buildMemberExportArchive(userId)` must:

- include conversations involving the caller;
- include them only while currently visible under shared-family membership;
- include all visible messages in those conversations, not only caller-authored messages;
- include only files referenced by eligible DM rows;
- re-check `canReadUpload` semantics before including each file;
- never include a conversation or media from a pair that no longer shares a family;
- omit private DM data for other users;
- carry conversation participant information needed to interpret the export.

Add explicit exclusions in tests rather than relying only on positive cases.

## Shared API client

Create `packages/api-client/src/dms.ts` with:

- `DirectConversation`
- `DirectConversationParticipant`
- `DirectMessage`
- `DirectMessagesPage`
- `DirectInboxItem`
- `DirectInbox`
- `DirectUnreadCounts`
- `CreateDirectConversationBody`
- `CreateDirectMessageBody`
- API functions for all `/api/dms` routes.

Do not reuse `ChatMessage` if that shape implies group-only fields such as replies, `readBy`, milestone references, or a one-file attachment.

Recommended query keys, kept consistent between web/mobile:

```text
['dm-conversations']
['dm-people']
['dm-messages', conversationId]
['dm-unread']
```

Mutation behaviors:

- create/reuse conversation: upsert inbox conversation and select it;
- send: patch newest page plus inbox preview/order;
- delete: remove from cached pages and update preview (or invalidate if latest changed);
- mark read: update `byConversation` and `total`, then invalidate if needed;
- shell push/unread polling uses the DM unread query in addition to family-chat unread.

Export functions explicitly through `packages/api-client/src/index.ts`.

Add API-client tests for:

- request paths/methods;
- optional content/multi-attachment body;
- pagination query parameters;
- response typing/normalization where relevant.

Run `npm run build:api-client` and commit generated `dist/` files if that matches the repository’s tracked output policy.

## Web implementation

### Route and shell

Keep `/chat`.

Prefer URL state for deep links and reload stability:

```text
/chat?dm=<conversationId>
/chat?group=<groupId>
```

Rules:

- no selection query shows a unified inbox;
- direct notification URLs open the DM;
- group-chat links continue to open family chat;
- browser back returns to inbox or the prior selection using router history;
- a missing/ineligible conversation shows an inline localized “not available” state, not a 403 detail.

AppShell and BottomNav:

- continue to share the existing query cache;
- combine family-chat and DM unread totals into one Chat badge;
- keep existing `['chat-unread']` for compatibility and add `['dm-unread']`;
- invalidate both after opening/sending/reading as relevant.

### Unified Chat page

Refactor `ChatPage.tsx` into a conversation shell, not a family-only screen:

1. sidebar/inbox panel:
   - “Direct messages” section;
   - “Family chats” section;
   - New message action;
   - avatar/name, latest preview, time, unread badge;
2. selected-conversation panel:
   - DM participant header or existing family-chat header;
   - date/message list;
   - composer;
   - deletion affordance for own DM messages only.

On widths where the two-pane view does not fit:

- show inbox first;
- selecting a conversation shows the full conversation;
- header back action returns to inbox.

### Extract reusable pieces

Avoid duplicating group and DM message mechanics. Extract from `ChatPage.tsx` only what is genuinely common:

- message list/date dividers;
- scroll-to-bottom and older-page viewport restoration;
- message bubble shell/avatar/time;
- common media grid/lightbox behavior;
- composer container and upload error states.

Keep identity-specific policy separate:

- family membership/reply/milestone UI remains group-chat-specific;
- DM picker, unread recipient, own-message delete, and no-reply behavior remain DM-specific.

### New-message picker

Create a focus-managed modal:

- search by member name;
- fetch authoritative `/api/dms/people`;
- list deduplicated members;
- exclude current user;
- show loading/empty/error states;
- selection calls `POST /api/dms`;
- closes and navigates/selects the returned conversation;
- if a conversation already exists, backend returns that conversation.

### DM composer

Use `useComposerUploads(10)`:

- supports text optional when attachments exist;
- accepts image/video formats supported by the common upload endpoint;
- displays local preview and per-file progress/error;
- allows removing an attachment before send;
- sends all attachment paths in `attachmentUrls`;
- disables send while required uploads are incomplete;
- clears draft only after success;
- leaves retryable upload state/error after failure.

The upload lifecycle remains:

1. upload immediately after selection to an uploader-only state;
2. message create binds uploads to the DM conversation;
3. failed/cancelled draft uploads are uploader-only; use existing cleanup if available.

### DM media rendering

Use:

- `UploadMedia` / `ShimmerImage` for thumbnails and media behavior;
- `Lightbox` for the attachments array;
- authenticated media URL/token behavior;
- poster/thumbnail variants for video;
- mixed image/video grids;
- responsive maximum grid area inside a message;
- accessible alt labels and keyboard lightbox controls.

### Own-message deletion

- show a delete action only for messages authored by the current user;
- use a confirmation dialog or a clear destructive menu action;
- after success update all cached pages/inbox preview;
- if the deleted row was the latest message, refetch/derive the new preview.

### Web tests

Add focused Testing Library/Vitest coverage:

- inbox renders DM and family chat sections;
- DM selection and pagination;
- searchable recipient deduplication;
- current user excluded;
- text-only send;
- media-only send;
- mixed text + 10 attachments;
- 11th attachment blocked;
- attachment removal/progress/error;
- polling updates;
- mark-read/unread invalidation;
- own-message delete shown, other participant’s hidden;
- inaccessible DM displays unavailable state;
- push/inbox URL selection;
- shell Chat badge combines unread totals;
- modal focus/keyboard behavior;
- locale strings are keys rather than hardcoded copy.

Use existing `renderWithQueryClient` and fixtures.

## Mobile implementation

### Navigation

Introduce an authenticated DM-capable Chat inbox flow:

- Chat tab opens a unified `ChatInboxScreen`;
- direct-message section plus enabled family-chat section;
- a “New message” action opens `DmMemberPickerScreen`;
- select a DM opens `DirectMessageScreen`;
- select a family opens existing `ChatScreen`;
- tapping a DM push deep-links to `DirectMessageScreen` for the returned conversation ID.

Register new screens only through `AuthenticatedScreens.tsx`; do not statically import them from login/root modules.

`ChatScreen.tsx` may remain group-only and continue to use the existing route contract. Avoid forcing DM fields into its `route.params.groupId` model.

### Mobile query and polling behavior

- `['dm-conversations']`: inbox list;
- `['dm-people']`: recipient picker;
- `['dm-messages', conversationId]`: infinite query;
- `['dm-unread']`: badge counts.

Conversation screen:

- use focus-aware 6-second polling;
- mark read on focus and after receiving the current latest state;
- load older messages with `loadMore`;
- preserve scroll position when older pages are prepended;
- invalidate inbox/DM unread after send/read/delete.

MainTabs:

- poll DM unread every 30 seconds along with family unread;
- combine totals;
- do not show a DM badge while the feature is unavailable on an older server.

### Composer and attachments

Reuse `usePickAndUploadMedia` rather than duplicating picker/compression:

- configure up to 10;
- allow text and/or attachments;
- preserve current 120-second mobile video restriction;
- use common image compression behavior;
- show upload failures and partial success;
- allow removing picked/uploaded attachments;
- send all `attachmentUrls`.

### Rendering

Reuse:

- `MediaThumbnail`;
- `ImageViewerScreen` for images;
- existing video poster/play behavior;
- authenticated URI construction.

Add a DM message grid that:

- handles 1–10 mixed attachments;
- opens the requested attachment/media collection;
- displays a caption and timestamp;
- does not leak inaccessible files if 401/403/404 occurs.

### Deletion

- only show delete on own messages;
- native confirmation/action sheet;
- delete locally from React Query after server success;
- refresh inbox preview/unread.

### Notifications

Extend `usePushNotifications.ts`:

- cold and warm start parse `relatedDirectConversationId`;
- navigate only after session/authenticated navigation is ready;
- open DM conversation route;
- if no longer eligible, let server 404 lead to an inline unavailable state;
- generic notification copy must not need to parse message content.

### Profile preference

Add a localized Direct messages toggle in `ProfileScreen.tsx`, defaulted from `pushOnDirectMessage` and saved through the existing `PATCH /api/auth/me` flow.

Keep existing family-chat preference separate.

### Mobile tests

Add Jest tests for:

- inbox rendering and ordering;
- recipient picker and deduplication;
- one existing conversation reuse is delegated to API behavior;
- direct-message send with multiple uploads;
- 10/11 attachment boundary;
- partial upload failure and retry;
- mark read and unread badge;
- own-message delete behavior;
- warm/cold-start DM notification navigation;
- hidden conversation/unavailable state;
- profile preference update;
- feature-gated behavior against an older server.

## Unified unread and notification behavior

Family chat and DM unread are separate data domains but one visible Chat badge:

```text
total Chat badge = familyChatUnread.total + directMessageUnread.total
```

Opening any family chat or DM marks only that conversation read. It must not clear the other domain.

Global notification dropdown/history:

- DM notification rows are shown;
- notification click routes to the conversation if accessible;
- a stale notification uses a generic unavailable state;
- deleting a DM message does not require deleting a notification;
- if the conversation is hidden by membership, normal DM notification content should not reveal the message.

## Server feature and compatibility

Add a stable feature ID, for example `directMessages`.

Rules:

- backend `/api/auth/server-info` includes it only when implemented;
- clients hide New message/DM UI if unsupported;
- existing family chat remains usable on old servers;
- API-client DM methods include compatibility annotations needed by the old-server check;
- mobile `MIN_SERVER_VERSION` does not need to change unless the baseline server requirement is intentionally raised. Prefer capability gating instead of a breaking baseline bump.
- no existing installed-client behavior should fail because the new model exists.

## OpenAPI

Document:

- `/api/dms` list/create;
- eligible people endpoint;
- conversation messages list/send;
- message delete;
- read marker;
- unread counts;
- request/response schemas;
- 10-attachment limit;
- shared-family authorization;
- 404 privacy semantics;
- cursor/page limits;
- push-only behavior and generic content;
- `pushOnDirectMessage`;
- `relatedDirectConversationId`;
- upload scope/authorization implications.

Treat API additions as non-breaking. If an existing response is changed, run the breaking-change gate and mark the PR/commit appropriately.

Regenerate docs by cleaning and generating the API reference, not by editing generated files:

```bash
cd docs
npm run clean-api-docs
npm run gen-api-docs
```

## i18n

Add all new UI/backend strings to all supported locales:

- backend: `en`, `nl`, `zh`, `pt-PT`, `fr`;
- web: `en`, `nl`, `zh`, `pt-PT`, `fr`;
- mobile: `en`, `nl`, `zh`, `pt-PT`, `fr`.

Expected categories:

- Direct messages section/title;
- New message;
- recipient search/empty/error;
- text/media preview (`Photo`, `Video`, attachment count);
- unread;
- delete confirmation and failure;
- unavailable conversation;
- attachment limits/errors;
- profile preference label and description;
- generic push title/body.

Run:

```bash
npm run check:locales
```

No hardcoded UI strings.

## Documentation

### User documentation

Update `docs/docs/chat.mdx` (and index/features docs where chat is summarized) to explain:

- how to start a DM;
- Chat-area placement;
- shared-family restriction;
- loss/restoration of access when membership changes;
- text/image/video support and 10-file limit;
- unread and polling behavior;
- own-message deletion;
- push preference and privacy-safe notifications;
- exclusions: no editing, blocking, conversation delete, read receipts, or realtime guarantees.

### Developer documentation

Update:

- `docs/developers/backend-reference.md` route/data-model/import-export description;
- `docs/developers/api.md` endpoint/auth/privacy guidance;
- `docs/openapi/famlin.yaml`;
- `AGENTS.md` as-built architecture after the feature ships, if it remains the single architecture source of truth.

Document the upload scope addition and the live shared-family rule explicitly because omissions create privacy leaks.

## Implementation sequence for the single release

This sequence is the internal dependency order, not separate PR boundaries.

1. Add Prisma models, upload scope, preference, notification relation, and migration.
2. Implement canonical-pair/shared-family service with focused authorization tests.
3. Implement DM services and routes for people, create/reuse, inbox, history, send, mark-read, unread, and own-message delete.
4. Implement DM upload binding/serving authorization and media cleanup.
5. Implement direct-message event and push-only notifications plus preference selection.
6. Extend full export, member export, import, and restore.
7. Add OpenAPI/schema and shared API-client implementation.
8. Build web unified Chat UI, member picker, composer, media display, deletion, unread, profile preference, and push handling as applicable.
9. Build mobile inbox/DM routes, picker, screen, media composer/rendering, unread, deletion, profile preference, and push navigation while preserving lazy screen loading.
10. Add locales, docs, generated API-client/API-reference artifacts, and i18n parity.
11. Run targeted tests, then affected-package typechecks/builds and full validation.

Do not merge an intermediate commit from this sequence unless the final PR remains internally complete; each required layer must land together.

## Test matrix

### Backend authorization/privacy

- recipient with shared group is eligible;
- no shared group cannot start;
- one of several shared families can be removed without hiding;
- last shared family removal hides conversation and messages;
- re-adding a shared family restores access;
- self-recipient rejected;
- duplicate create by either participant returns one conversation;
- concurrent create does not create duplicate rows;
- one participant cannot access another pair’s conversation;
- admin without participant membership gets 404 and no DM media access;
- deleted message cannot be accessed;
- member removal revokes conversation and upload access immediately;
- account deletion cascades conversation/read state and cleans up files.

### Backend message behavior

- text-only accepted;
- media-only accepted;
- text + multiple attachments accepted;
- ten accepted;
- eleven rejected;
- empty rejected;
- duplicate attachment paths removed;
- external/unowned/unbound paths rejected;
- attachments bound in the same transaction as the message;
- pagination/cursor correct;
- read marker and unread count correct;
- own delete succeeds;
- delete of other participant’s message fails;
- admin cannot delete a participant’s DM;
- latest inbox preview updates after delete.

### Upload privacy

- DM attachment accessible to both participants while eligible;
- inaccessible to all other family members;
- inaccessible to admins outside conversation;
- inaccessible after last shared-family removal;
- accessible again after a shared-family relationship is restored;
- deleted message/upload no longer served.

### Notifications

- notify only the other participant;
- preference off suppresses push;
- generic push contains no message or attachment text;
- no email sent;
- ineligible pair receives no notification;
- warm/cold push identifiers route to the conversation;
- stale identifier renders unavailable.

### Export/import/restore

- full export contains DM rows and media;
- full import restores DMs/read state IDs and upload scope;
- older archive without DM files restores;
- member export includes participant-visible full conversation;
- member export excludes hidden/ineligible DM;
- member export excludes other users’ DMs;
- account deletion does not leave archived/orphaned physical media in normal storage;
- restore round trip preserves canonical pair and latest-read state.

### Web/mobile

- unified Chat navigation;
- direct and family sections;
- sorted inbox and preview;
- picker search/dedupe;
- 1/10 attachment media;
- mixed image/video rendering;
- failed attachment upload;
- pagination and scroll preservation;
- unread and shell badge;
- profile preference;
- own deletion;
- inaccessible conversation;
- push navigation;
- feature unavailable on older server.

## Validation commands

Run the smallest commands first, then full affected-package checks.

```bash
# Root/generated/client
npm run build:api-client
npm test --workspace=@famlin/api-client
npm run check:locales
npm run format
npm run format:check

# Backend
cd backend
npx tsc --noEmit
npm run test:docker

# Web
cd web
npx tsc --noEmit
npm test
npm run build

# Mobile
cd mobile
npx tsc --noEmit
npm test
npx expo install --check

# Docs
cd docs
npm run clean-api-docs
npm run gen-api-docs
npm run build
```

Also run the root client-compatibility check used in CI and any targeted backend test selector covering:

- chat/DM authorization;
- upload privacy;
- notifications;
- export;
- member export;
- restore;
- user deletion.

Use `backend/npm run test:docker` rather than a host-only test run when Postgres is only available through Compose.

## Acceptance criteria

The feature is complete when all are true:

1. A web/mobile user can open Chat and see family chats plus private DM conversations.
2. A searchable new-message picker contains exactly the currently eligible shared-family members, deduplicated.
3. A pair always resolves to one canonical conversation.
4. Text-only, media-only, and mixed messages support up to 10 files.
5. Only the two participants can read conversation data and media while they share a current family.
6. Losing the last shared family immediately hides messages and media; restoring membership makes history visible again.
7. Messages are cursor-paginated, unread state is per conversation, and the shell Chat badge is correct.
8. Only the sender can delete a message; deletion is hard, affects both views, and cleans orphaned files.
9. Push is opt-out via a dedicated preference, not email, and reveals no message/attachment preview.
10. Admin moderation screens do not expose DMs; normal admin privileges do not bypass participant authorization.
11. Participant export and full backup/restore include the correct DM data and files.
12. Older servers hide the feature cleanly; existing group chat remains unchanged.
13. All locales are complete and no new hardcoded UI text exists.
14. OpenAPI/generated docs, user docs, and developer architecture docs are updated.
15. Backend, shared client, web, mobile, upload/privacy, notifications, export, restore, and compatibility validations pass.

## Key implementation guardrails

- Do not infer DM authorization from a stored “group at creation.”
- Do not bind DM uploads to a shared family’s `groupIds`.
- Do not allow admin status to bypass DM participant privacy.
- Do not put DM notification body text on lock screens.
- Do not overload group `ChatMessage` fields if DM semantics differ.
- Do not use `export *` in the shared API-client barrel.
- Do not hard-delete physical media without checking for remaining references.
- Do not bypass domain events by putting recipient policy directly in the DM route.
- Do not import mobile authenticated screens eagerly.
- Do not hand-edit generated OpenAPI reference files.
- Do not change `MIN_SERVER_VERSION` unless this release intentionally requires a breaking compatibility baseline.
- Do not omit DM data from either full restore or member export.

