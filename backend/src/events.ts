// Typed in-process domain events. Routes emit facts about what happened
// (post created, reaction added, ...) and subscribers (src/subscribers/)
// decide what those facts mean — notifications today, other integrations
// later — so a route never depends on any consumer of its events.
//
// Emission is deliberately fire-and-forget: every handler runs detached from
// the request that emitted the event, and a throwing handler is logged and
// swallowed. A broken subscriber must never fail (or slow down) the user
// action that triggered it — emit only after the triggering write has
// committed.

export interface DomainEvents {
  'post.created': {
    // One entry per Post row the write created — a single-group post emits
    // one, a cross-post (see routes/posts.ts's POST / fan-out) emits one per
    // target group, all sharing the rest of this payload. Lets the
    // notifications subscriber notify a recipient who's in several target
    // groups exactly once instead of once per group.
    posts: Array<{ postId: string; groupId: string; groupName: string }>;
    authorId: string;
    authorName: string;
    content: string | null;
    // Shared by every sibling post a single create call produces (same
    // convention as `content` above) — lets the notifications subscriber
    // auto-post a SYSTEM_MILESTONE chitchat message per target group without
    // re-fetching the post.
    type: string;
    milestoneTag: string | null;
  };
  'comment.created': {
    commentId: string;
    postId: string;
    postAuthorId: string;
    groupId: string;
    groupName: string;
    authorId: string;
    authorName: string;
    content: string;
    hasAttachment: boolean;
    parentId: string | null;
    // As sent by the client (resolved from "@name" typing) — NOT yet
    // validated. Subscribers must re-check each id is a current member of
    // the post's group before acting on it.
    mentionedUserIds: string[];
  };
  'reaction.added': {
    // Set (not removed) reactions only — covers both adding and switching.
    targetKind: 'post' | 'comment';
    postId: string;
    commentId: string | null;
    groupId: string;
    groupName: string;
    targetAuthorId: string;
    targetContent: string | null;
    reactorId: string;
    reactorName: string;
    reactionType: string;
  };
  'chat.created': {
    messageId: string;
    groupId: string;
    groupName: string;
    authorId: string;
    authorName: string;
    content: string | null;
    hasAttachment: boolean;
    kind: string;
    refPostId: string | null;
  };
}

type Handler<K extends keyof DomainEvents> = (payload: DomainEvents[K]) => void | Promise<void>;

const handlers = new Map<keyof DomainEvents, Handler<any>[]>();

export function onDomainEvent<K extends keyof DomainEvents>(event: K, handler: Handler<K>): void {
  const list = handlers.get(event) ?? [];
  list.push(handler);
  handlers.set(event, list);
}

export function emitDomainEvent<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): void {
  for (const handler of handlers.get(event) ?? []) {
    Promise.resolve()
      .then(() => handler(payload))
      .catch((err) => console.error(`Domain event handler failed for ${event}`, err));
  }
}

// Test-only escape hatch: buildApp() registers subscribers idempotently, so a
// test that wants to assert against a clean listener set can reset here.
export function __clearDomainEventHandlersForTests(): void {
  handlers.clear();
}
