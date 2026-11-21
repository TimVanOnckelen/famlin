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
- Existing group-chat semantics and installed-client API behavior must remain intact.
- This feature should generalize the chat storage/runtime model around conversations while preserving `/api/chat/groups/:groupId/*` as compatibility adapters.

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
- A private-chat attachment must not be bound to every member of a shared family.
- A conversation upload scope/reference is required. For family conversations it continues to resolve to group membership; for private conversations it resolves against the participant rows and live shared-family eligibility.
- All attachment paths must continue to pass `uploadPathSchema`.
- Message creation and upload binding must happen in one transaction so an accepted message never contains silently unbound media.

### Notification pattern

- Domain events are emitted after committed writes.
- `backend/src/subscribers/notifications.ts` owns recipient/notification policy.
- Push delivery is centralized in `services/notificationChannels/push.ts`.
- Existing notification types live in `services/notificationChannels/types.ts`.
- `Notification` currently relates to posts/stories, not chat conversations.
- Private conversations should emit a chat conversation event and notify the other participants. The first release has exactly two private participants; the model can later support more without a schema redesign.
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

- Evolve `packages/api-client/src/chat.ts` into a conversation-oriented client module while retaining legacy group wrappers and response compatibility.
- Keep DM-specific helpers/types in that module or an explicit adjacent `conversations.ts`; do not create a detached API/client model that cannot later represent multi-person private chat.
- The barrel in `packages/api-client/src/index.ts` uses named exports, never `export *`.
- The committed `dist/` package is consumed by mobile and production builds; run `npm run build:api-client` and include required generated output.
- Add a server feature ID in:
  - `backend/src/serverFeatures.ts`
  - `packages/api-client/src/features.ts`
- Mark API-client calls that are unavailable to the oldest supported server with `// requires-feature: <id>` where required by `scripts/check-client-vs-old-spec.mjs`.
- Older mobile/web builds are not expected to know about DMs; new clients must degrade cleanly against servers that do not advertise the feature.
- OpenAPI is hand-maintained in `docs/openapi/famlin.yaml`; generated API-reference output is not hand-edited.
- `feat` work requires a docs change unless an exceptional `Docs-not-needed` justification is supplied.

## Architecture decision: one generalized chat model

Do not create `DirectConversation`, `DirectMessage`, or `DirectRead` tables
alongside existing chat. Extend chat around a generalized
`ChatConversation` entity instead.

The rationale is extensibility without premature scope:

- family chat and private chat share the same message, pagination, read, upload,
  delete, and inbox mechanics;
- private conversations explicitly model participants, so the initial 1:1
  policy can later expand to 3+ without replacing storage;
- family chat keeps live `GroupMember`-derived membership instead of duplicating
  member rows;
- installed group-chat clients can retain their existing routes and response
  shape through compatibility adapters;
- a private chat is not represented as a synthetic `Group`, which would
  incorrectly inherit posts, stories, media albums, circles, wiki, and admin
  semantics.

The initial user-facing restriction remains one-to-one. The generalized schema
is a preparedness decision, not permission to ship ad-hoc groups in this release.

## Proposed backend data model

The existing `ChatMessage`/`ChatRead` tables should be evolved into a reusable
conversation model rather than adding a parallel direct-message subsystem.

### `ChatConversation`

```text
ChatConversation
- id
- kind             String: FAMILY or PRIVATE
- groupId?         nullable, FAMILY only
- participantKey? canonical key, PRIVATE 1:1 only
- title?
- createdById?
- createdAt
- updatedAt

relations
- group -> Group?
- participants -> ChatConversationParticipant[]
- messages -> ChatMessage[]
```

Constraints:

- every existing family gets one backfilled `FAMILY` conversation;
- unique `groupId` for family conversations;
- private conversation creation currently requires exactly two participants;
- `participantKey` contains the sorted pair and is unique only as a 1:1 idempotency key;
- the application or database check must prevent both `kind=FAMILY` without `groupId` and `kind=PRIVATE` with a `groupId`;
- future ad-hoc 3+ participant conversations do not set `participantKey`;
- no private conversation is represented by a synthetic `Group`.
- creating a `Group` creates its `FAMILY` conversation; deleting a `Group`
  cascades that conversation and its messages/read rows.

### `ChatConversationParticipant`

```text
ChatConversationParticipant
- id
- conversationId
- userId
- joinedAt

relations
- conversation -> ChatConversation, cascade
- user -> User, cascade

unique
- [conversationId, userId]
indexes
- [userId]
```

Private conversations use explicit participant rows. Family conversations do not
duplicate family members: their audience remains the live `GroupMember` relation.
This preserves immediate membership-based access changes for family chat.

The current product policy is still exactly two private participants. Future
creation of larger ad-hoc conversations is a later product/API capability, not
implied by this migration. At that point, participant admission/removal and the
required family trust boundary must be specified separately; the storage layer
will not require replacement.

### Evolved `ChatRead`

Migrate the existing table to:

```text
ChatRead
- id
- conversationId
- userId
- lastReadAt

unique
- [conversationId, userId]
```

This is one read model for both family and private conversations. Family
membership remains live-derived; private readers must be conversation
participants. Do not duplicate private read state in the participant table and
do not keep a group-specific read table beside it.

### Evolved `ChatMessage`

Migrate the existing table rather than creating `DirectMessage`:

```text
ChatMessage
- id
- conversationId  replaces groupId
- authorId
- kind
- content         nullable, trimmed, max 2000
- attachmentUrls  String[] default []
- legacy attachmentUrl? retained during compatibility/migration
- encryption      String @default("none")
- encryptedPayload Json? containing a versioned structured envelope
- refPostId?
- replyToMessageId?
- createdAt
- editedAt?

indexes
- [conversationId, createdAt, id]
- [replyToMessageId]
- [authorId]
```

Validation:

- `attachmentUrls.length <= 10` for all conversation kinds, not just DMs;
- at least one of `content` or attachments;
- deduplicate attachment paths while preserving order;
- every path passes `uploadPathSchema`;
- every new attachment is owned by the sender and bindable;
- no arbitrary external URL.
- `encryption = "none"` uses the normal plaintext/attachment fields;
- future encrypted generations may use `encryptedPayload` while plaintext
  fields remain null;
- clients treat every unrecognized encryption marker as unsupported, not empty.

Existing family chats should gain multi-attachment support through the evolved
schema. Preserve a response-level singular `attachmentUrl` mirroring the first
entry for installed clients that expect it.

### Encryption forward compatibility

Every message response includes:

```text
encryption: string
encryptedPayload: object | null
```

The server serializes unknown markers unchanged. Current clients support only
`"none"`:

```text
if encryption === "none":
  render content/attachments normally
else:
  render "This message can't be shown in this version of Famlin"
```

Apply that branch to inbox previews, notifications, member exports, and every
message renderer. Unknown encrypted messages must never become an empty bubble
or a misleading attachment indicator. Push notifications remain generic and do
not contain plaintext or encrypted payload.

No client writes `encryptedPayload` or a non-`none` marker in this release. The
payload is stored as JSON because the encryption format will have an explicitly
structured envelope. The `encryption` marker remains authoritative for deciding
which envelope schema a client supports.

Ship this defensive rendering in the first conversation-capable web/mobile
release, before any server/client can create encrypted messages. The first
encryption implementation must therefore arrive after those clients are the
minimum supported app behavior; pre-DM installed clients never enter the private
conversation flow, while every DM-capable client already knows how to render the
unsupported-version placeholder.

### Family conversation migration

The migration must:

1. create `ChatConversation`;
2. insert one `FAMILY` row for each `Group`;
3. add `conversationId` to `ChatMessage`;
4. backfill every existing message to the corresponding family conversation;
5. move or backfill `ChatRead` by that conversation;
6. make `conversationId` required and remove the now-redundant `groupId` column;
7. add `ChatConversationParticipant`;
8. preserve existing IDs/timestamps/references for export compatibility.

This is a data migration, but not an API break: old family endpoints resolve
`groupId` to the corresponding conversation.

### `Upload` conversation scope

Extend `Upload` with:

```text
chatConversationId?: String
participantUserIds?: String[]
```

Rules:

- nullable and indexed;
- add a new `UploadScope` variant for conversations; never call
  `bindAssetsToScope` with the participants' family `groupIds`;
- `canReadUpload` resolves conversation kind and audience:
  - `FAMILY`: current `GroupMember`, plus `chitchatEnabled` policy;
  - `PRIVATE`: an explicit participant-only scope plus live conversation/shared
    family eligibility;
- `chatConversationId` is the authoritative live scope and
  `participantUserIds` is an optional explicit fail-closed participant snapshot;
  neither may fall back to group membership;
- private attachments are never scoped to every member of a shared family;
- a fellow family member who guesses a `/uploads/` path receives 404;
- `isUploadRowReadable` receives a conversation visibility callback just like
  its existing circle/group callbacks; member export uses the same central rule
  rather than reimplementing participant checks;
- inaccessible conversations yield 404 for conversation media;
- the same conversation scope can support future 3+ private participants;
- conversation deletion must explicitly clean up upload rows/files rather than broadening scope.

Existing family-chat uploads may remain group-scoped: the current audience is
identical and an on-disk backfill is not necessary. New family/private chat
messages bind through conversation scope. If a migration script can safely
convert an existing upload that is referenced only by family chat, it may do so,
but the scope must never be removed from other content references.

`bindAssetsToScope` and the upload readability helper must persist conversation
scope unambiguously and refuse widening a private attachment through later group
rebinding. New private attachments are claimed/bound exclusively for their
conversation rather than silently reused by another scope.

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

Add a nullable `relatedChatConversationId` to `Notification`, with `SetNull` if conversation rows can be removed.

Either participant’s DM notification:

- has type `new_direct_message`;
- targets only the other participant;
- contains no message body or attachment text;
- carries a conversation identifier sufficient for warm/cold-start navigation;
- is hidden or handled as unavailable if the current shared-family condition no longer holds.

### Migration

The migration must:

1. create generalized chat conversation/participant storage and migrate existing family chat rows;
2. add the upload conversation scope;
3. add `User.pushOnDirectMessage`;
4. add notification relation/foreign key if nullable conversation deep-link storage is selected;
5. avoid renaming or deleting shipped migrations.

Generate Prisma Client after the schema change.

## Backend authorization and services

### Shared-family service and conversation authorization

Add shared conversation helpers, conceptually:

```ts
shareAnyGroup(userAId, userBId): Promise<boolean>
findVisibleChatConversationForUser(conversationId, userId): Promise<... | null>
canonicalPrivateParticipantKey(userIds: string[]): string
canParticipateInPrivateConversation(conversation, userId): Promise<boolean>
```

Family conversations authorize against current `GroupMember` rows and
`chitchatEnabled`. Private conversations authorize against explicit participant
rows plus live `shareAnyGroup` checks. Do not cache eligibility; revocation after
member removal must be immediate.

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
- existing pair: return the existing private conversation instead of 409;
- two simultaneous creates: canonical `participantKey` plus a unique constraint/upsert resolves to one row.

### Route contract

Generalize `/api/chat` around conversations:

```text
GET    /api/chat/conversations
POST   /api/chat/conversations
GET    /api/chat/conversations/:conversationId/messages
POST   /api/chat/conversations/:conversationId/messages
POST   /api/chat/conversations/:conversationId/read
GET    /api/chat/conversations/unread
DELETE /api/chat/messages/:messageId
GET    /api/chat/people
```

Keep the installed family routes:

```text
GET/POST /api/chat/groups/:groupId/messages
POST     /api/chat/groups/:groupId/read
GET      /api/chat/unread-counts
```

They are compatibility adapters that resolve `groupId` to the one `FAMILY`
conversation, apply exactly the same service logic, and preserve the current
response shape. This release may add `/api/chat/conversations` to clients while
retaining group-scoped helpers until a later compatibility cleanup.

#### `GET /api/chat/people`

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

#### `POST /api/chat/conversations`

Body:

```ts
{ kind: 'PRIVATE', participantIds: [string] }
```

The public creation API accepts a participant collection even though this
release validates exactly one other participant. The shared schema leaves the
transport ready for future n-person private conversations. It is idempotent for
an existing 1:1 pair. A family conversation is never created by a member API;
it is created by group lifecycle logic.

#### `GET /api/chat/conversations`

Returns inbox items for currently eligible conversations:

```ts
{
  items: Array<{
    id: string
    kind: 'FAMILY' | 'PRIVATE'
    group?: { id: string; name: string }
    participants: Array<{ id: string; name: string; avatarUrl: string | null }>
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

- includes eligible private conversations and enabled current family chats;
- newest activity first;
- never return hidden conversations;
- for private conversations, expose the participants needed by the current UI
  without leaking any non-participant conversation;
- no participant data beyond the existing member-safe fields.

#### `GET /api/chat/conversations/unread`

Returns:

```ts
{
  total: number
  byConversation: Record<string, number>
}
```

Only visible conversations contribute. The legacy
`GET /api/chat/unread-counts` continues returning its existing
group-ID-to-count object for installed clients.

#### `GET /api/chat/conversations/:conversationId/messages?cursor=&take=`

Returns:

```ts
{
  items: ChatMessage[]
  nextCursor: string | null
}
```

- cursor pagination newest-first at the transport layer;
- fetch one extra row per shared pagination helper;
- family replies remain supported; private conversations do not expose replies
  in the first release even though the shared message model retains the field for
  later capability work;
- 404 if hidden/ineligible.

#### `POST /api/chat/conversations/:conversationId/messages`

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
2. resolve a visible conversation in one kind-aware authorization step;
3. validate attachments belong to uploader and remain bindable;
4. create the message and bind all attachment upload rows to the chat conversation in one database transaction;
5. update `conversation.updatedAt`;
6. commit;
7. emit the generalized `chat.created` event with `conversationId`, `kind`, and audience data;
8. return shaped message.

No broad catches. Expected eligibility/validation errors use translated, non-sensitive responses. Unexpected errors propagate to the global handler.

#### `POST /api/chat/conversations/:conversationId/read`

Upsert caller read state to the server time (or an accepted latest-message timestamp if the API design requires it).

Invalidate client DM unread caches. Do not create per-message receipt history.

#### `DELETE /api/chat/messages/:messageId`

- resolve message/conversation;
- for private conversations require a currently eligible participant and `authorId === caller.id`, with no admin bypass;
- family chat retains the established author-or-admin policy unless deliberately changed as a separate compatibility decision;
- transactionally delete the message;
- determine media no longer referenced by any content source;
- delete orphaned conversation upload rows/files after commit;
- invalidate conversation/inbox caches.

Hard delete means the other participant sees the message disappear on the next query/poll. Do not add deletion tombstones.

### Inbox/read/unread query efficiency

Implement batching, not N+1 per conversation:

- query eligible conversation IDs via participants and shared-group condition;
- fetch latest messages in a grouped/latest-per-conversation query;
- count unread messages after each participant/conversation read marker;
- sort in SQL by latest activity where practical.

For a first implementation, a bounded list of conversations is acceptable only if the existing user count is small and the endpoint uses an explicit cap. Prefer cursor pagination from the start if query complexity is similar.

### Notification event

Evolve the typed `chat.created` event:

```text
chat.created
{
  conversationId
  conversationKind
  message
  groupId?
  recipientIds?
}
```

Subscriber responsibilities:

1. for `FAMILY`, preserve whole-group notification behavior;
2. for `PRIVATE`, derive current eligible participants and notify every other participant (two in this release);
3. skip the sender;
4. recheck current shared-family eligibility for private recipients;
5. create `Notification` rows and send push through the existing channel;
6. honor `pushOnDirectMessage` for private conversations and `pushOnChitchat` for family conversations;
7. use localized generic copy with sender name only for private conversations;
8. never include private `content` or attachment metadata in push/email text.

No DM email channel implementation is included.

Push payload/deep-link data should carry:

```text
relatedChatConversationId
```

The clients open `/chat?...` or the corresponding mobile route only after validating/handling current eligibility.

### Account and membership deletion

#### Group member removal

No new database mutation is required to hide DMs because shared-family membership is rechecked live. The member-removal flow is still a critical test trigger:

- removing one shared family must hide only if it was the last shared family;
- removing one of several shared families must not hide;
- re-adding a family restores visibility.

#### Account deletion

Deleting either private participant permanently deletes the entire 1:1 private
conversation for both people. This includes all messages, read state, and
conversation-scoped uploads. It matches Famlin’s existing hard-delete posture
and avoids a synthetic/deleted-user identity.

The delete flow must:

- identify private conversations where they participate;
- collect conversation-scoped upload files;
- remove those private conversations;
- cascade their messages and read state;
- remove no-longer-referenced physical files;
- preserve family chat according to the existing user-delete/cascade policy.

Do not let a generic reference scan treat a private conversation upload path as
group/server-visible media if it is still used elsewhere. Private attachment
binding is exclusive to that conversation and the cleanup rule must be tested.

For a future 3+ conversation, account deletion semantics must be revisited:
removing one participant may be preferable to deleting the whole conversation.
That later behavior is outside the initial 1:1 policy.

### Immich upload mirror privacy

Add every private conversation attachment to `privateUploadKeys()` in
`backend/src/services/mediaMirror.ts`.

- query plaintext `ChatMessage.attachmentUrl`/`attachmentUrls`;
- reserve a way to extract attachment references from encrypted payload
  envelopes once an encryption format exists;
- one private reference keeps an upload excluded from every family mirror even
  if another row also references it;
- if a mirror run previously copied an upload that later becomes private, the
  next sync must remove it from Immich albums managed by Famlin;
- test that a fellow family member’s shared Immich album can never receive a
  private conversation upload.

This is part of the initial feature, not later hardening.

### Read-only and rate limits

- existing `readOnly` middleware must reject conversation create, send, delete, and mark-read mutations as it rejects other writes;
- use the global rate limit unless abuse testing proves a DM-specific send limit is necessary;
- do not introduce an untested per-recipient throttling policy in this feature.

## Backend export, backup, member export, and restore

### Full admin export

Add data entries for:

- chat conversations, including migrated family conversations;
- private conversation participants and read state;
- evolved chat messages, including encryption marker and payload;
- conversation-scoped fields in upload/notification representations where relevant.

Include the referenced upload originals/display copies/thumbnails/posters. Keep media collection aligned with the existing admin export behavior.

Update archive manifest counts and formats. Increment archive format only if
backward compatibility requires it. Older archives must restore without
conversation fields. The importer must backfill family conversation rows from
legacy groups, then insert legacy chat messages and read rows against them.

### Restore

Update:

- `backend/src/services/import.ts` Zod shapes;
- transaction insert ordering;
- ID preservation;
- user/foreign-key relations;
- new optional data file handling;
- upload-scope restore.

Restore into an empty instance must preserve family conversation identity,
canonical 1:1 pair uniqueness, participant relationships, and migrated IDs.
Read state and message timestamps must be retained exactly.
The round-trip restore test must cover private conversations, read state,
encryption fields, conversation upload scope, and associated media.

### Member export

`buildMemberExportArchive(userId)` must:

- include conversations involving the caller;
- include them only while currently visible under shared-family membership;
- include all visible messages in those conversations, not only caller-authored messages;
- include only files referenced by eligible private-chat messages;
- re-check `canReadUpload` semantics before including each file;
- never include a conversation or media from a pair that no longer shares a family;
- omit private-chat data for other users;
- carry conversation participant information needed to interpret the export.
- preserve `encryption`/`encryptedPayload` faithfully; encrypted records must
  not be flattened into plaintext or represented as empty.

Add explicit exclusions in tests rather than relying only on positive cases.

## Shared API client

Generalize `packages/api-client/src/chat.ts` with:

- `ChatConversation`
- `ChatConversationParticipant`
- `ChatMessage` (conversation-aware while retaining group compatibility fields during migration)
- `ChatMessagesPage`
- `ChatInboxItem`
- `ChatConversationList`
- `ChatUnreadCounts`
- `CreateChatConversationBody`
- API functions for all conversation-oriented `/api/chat` routes.

The shared `ChatMessage` type includes `encryption` and
`encryptedPayload`. Add a central client predicate/helper so web and mobile
apply the same supported-marker decision instead of duplicating string checks.

Retain the existing group-scoped API-client wrappers and `groupId` response
fields while old clients remain supported. New responses can add
`conversationId`, `kind`, `participants`, and `attachmentUrls`; legacy fields
must continue to derive consistently from the generalized records.

Recommended query keys, kept consistent between web/mobile:

```text
['chat-conversations']
['chat-people']
['chat-messages', conversationId]
['chat-unread-conversations']
```

Mutation behaviors:

- create/reuse conversation: upsert inbox conversation and select it;
- send: patch newest page plus inbox preview/order;
- delete: remove from cached pages and update preview (or invalidate if latest changed);
- mark read: update `byConversation` and `total`, then invalidate if needed;
- shell push/unread polling can use the generalized query once the feature is available, while the legacy family unread query remains for old clients/servers.

Export functions explicitly through `packages/api-client/src/index.ts`.

Add API-client tests for:

- request paths/methods;
- optional content/multi-attachment body;
- pagination query parameters;
- response typing/normalization where relevant.
- legacy group wrappers and the generalized conversation helpers resolve to compatible payloads.

Run `npm run build:api-client` and commit generated `dist/` files if that matches the repository’s tracked output policy.

## Web implementation

### Route and shell

Keep `/chat`.

Prefer URL state for deep links and reload stability:

```text
/chat?conversation=<conversationId>
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
- keep existing `['chat-unread']` for compatibility and add `['chat-unread-conversations']`;
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
- fetch authoritative `/api/chat/people`;
- list deduplicated members;
- exclude current user;
- show loading/empty/error states;
- selection calls `POST /api/chat/conversations`;
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
- unsupported encryption marker renders the localized unavailable placeholder instead of an empty bubble;
- encrypted inbox preview does not expose or invent plaintext/attachment text;
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

- `['chat-conversations']`: inbox list;
- `['chat-people']`: recipient picker;
- `['chat-messages', conversationId]`: infinite query;
- `['chat-unread-conversations']`: badge counts.

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

- cold and warm start parse `relatedChatConversationId`;
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
- unsupported encryption marker renders the localized unavailable placeholder instead of an empty bubble;
- encrypted inbox preview stays privacy-safe;
- profile preference update;
- feature-gated behavior against an older server.

## Unified unread and notification behavior

Family and private conversation unread are audience-specific calculations over
the same generalized conversation model, but there is one visible Chat badge:

```text
total Chat badge = sum of unread counts across visible chat conversations
```

Opening any conversation marks only that conversation read. It must not clear
other family or private conversations.

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
- existing family chat and legacy group routes remain usable on old servers and on upgraded servers with old clients;
- API-client DM methods include compatibility annotations needed by the old-server check;
- mobile `MIN_SERVER_VERSION` does not need to change unless the baseline server requirement is intentionally raised. Prefer capability gating instead of a breaking baseline bump.
- no existing installed-client behavior should fail because the new model exists.

## OpenAPI

Document:

- generalized `/api/chat/conversations` list/create;
- generalized conversation unread endpoint;
- legacy `/api/chat/groups/:groupId/*` and `/api/chat/unread-counts` compatibility contract;
- `/api/chat/people`;
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
- `relatedChatConversationId`;
- upload scope/authorization implications.
- `ChatMessage.encryption` (`"none"` today, open-string discriminator) and
  nullable structured `encryptedPayload`;
- unsupported-version placeholder behavior in member clients.

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
- unsupported encrypted-message placeholder.

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

1. Add the generalized chat conversation/participant model, conversation upload scope, preference, notification relation, and lossless family-chat migration.
2. Implement conversation resolution, canonical private-pair creation, and shared-family authorization with focused tests.
3. Implement generalized conversation services/routes for people, create/reuse, inbox, history, send, mark-read, unread, and deletion, plus compatibility adapters for legacy family endpoints.
4. Implement kind-aware conversation upload binding/serving authorization and media cleanup.
5. Evolve the existing `chat.created` event and notifications while preserving family-chat delivery and adding privacy-safe private-chat delivery.
6. Extend full export, member export, import, and restore.
7. Add OpenAPI/schema and shared API-client implementation.
8. Build web unified Chat UI, member picker, composer, media display, deletion, unread, profile preference, and push handling as applicable.
9. Build mobile inbox/DM routes, picker, screen, media composer/rendering, unread, deletion, profile preference, and push navigation while preserving lazy screen loading.
10. Add locales, docs, generated API-client/API-reference artifacts, and i18n parity.
11. Run targeted tests, then affected-package typechecks/builds and full validation.

Do not merge an intermediate commit from this sequence unless the final PR remains internally complete; each required layer must land together.

## Test matrix

### Backend authorization/privacy

- migration backfills one family conversation per group without losing messages,
  reads, replies, milestone references, or attachment fields;
- old and new family-chat routes return the same existing conversation;
- family chat remains group-member/chitchat-enabled protected;
- private participants are explicit and never synthetic group members;
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
- deleting either private participant removes the conversation for the other participant as well;

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
- `encryption = "none"` requires the normal payload rules;
- an unrecognized encryption marker is serialized unchanged, with its JSON envelope intact;
- clients never derive an empty bubble from a null plaintext field when encryption is unknown.

### Upload privacy

- DM attachment accessible to both participants while eligible;
- inaccessible to all other family members;
- inaccessible to admins outside conversation;
- inaccessible after last shared-family removal;
- accessible again after a shared-family relationship is restored;
- deleted message/upload no longer served;
- attempting to widen conversation-bound media through `groupIds` does not change its conversation-only scope;
- live participant authorization is used even when a `participantUserIds` snapshot is stale or incomplete;
- private conversation uploads are always returned by `privateUploadKeys()`;
- a mirror sync never copies a private conversation upload and removes an already-mirrored one if it becomes private.

### Notifications

- notify only the other participant;
- preference off suppresses push;
- generic push contains no message or attachment text;
- no email sent;
- ineligible pair receives no notification;
- warm/cold push identifiers route to the conversation;
- stale identifier renders unavailable.

### Export/import/restore

- full export contains generalized chat conversations, messages, participants, read state, and media;
- full import restores DMs/read state IDs and upload scope;
- older archive without DM files restores;
- member export includes participant-visible full conversation;
- member export excludes hidden/ineligible DM;
- member export excludes other users’ DMs;
- account deletion does not leave archived/orphaned physical media in normal storage;
- restore round trip preserves canonical pair and latest-read state.
- restore round trip preserves encryption marker/payload, conversation participant scope, and upload files;
- importing an archive created before conversation encryption defaults missing marker values to `none`.

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
11. Participant export and full backup/restore include the correct family/private chat data and files without exposing hidden conversations.
12. Older servers hide the feature cleanly; existing group chat remains unchanged.
13. All locales are complete and no new hardcoded UI text exists.
14. OpenAPI/generated docs, user docs, and developer architecture docs are updated.
15. Backend, shared client, web, mobile, upload/privacy, notifications, export, restore, and compatibility validations pass.
16. The private conversation creation restriction is 1:1, but storage already supports an explicit participant collection so 3+ conversations do not require a second data model later.
17. Existing family-chat messages, reads, replies, routes, and response fields survive the conversation migration unchanged.

## Key implementation guardrails

- Do not infer DM authorization from a stored “group at creation.”
- Do not bind DM uploads to a shared family’s `groupIds`.
- Do not allow admin status to bypass DM participant privacy.
- Do not put DM notification body text on lock screens.
- Do not create parallel `DirectConversation`/`DirectMessage` storage for this feature.
- Do not use synthetic `Group` rows for private conversations.
- Do not let installed group-chat clients lose reply, read-receipt, milestone-link, or singular attachment fields during migration.
- Do not duplicate family membership into private participant rows for `FAMILY` conversations.
- Do not use `export *` in the shared API-client barrel.
- Do not hard-delete physical media without checking for remaining references.
- Do not bypass domain events by putting recipient policy directly in the DM route.
- Do not import mobile authenticated screens eagerly.
- Do not hand-edit generated OpenAPI reference files.
- Do not change `MIN_SERVER_VERSION` unless this release intentionally requires a breaking compatibility baseline.
- Do not omit generalized chat data from either full restore or member export.

