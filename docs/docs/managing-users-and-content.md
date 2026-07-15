---
sidebar_position: 5
---

# Managing users, groups, and content

Day-to-day admin tasks all live under `/admin`, alongside the initial setup covered in [Admin configuration](./admin-configuration) and [Inviting family members](./inviting-family).

## Users

The **Users** page lists every account, their group memberships, and whether they're an admin.

- **Add a member** — click **Add member** to open the same modal used from the Groups page (see below). It defaults to **Invite** mode (pick a group, optional email, expiry); switch to **Create with password** to set up an account directly — name, email, password (8+ characters), an admin checkbox, and which groups to add them to — for family members without email/OIDC. Useful for an account that won't sign up itself via OIDC or an invite link.
- **Toggle admin access** — click the shield icon on a user's row. Admins can reach every page under `/admin`, so keep this limited to people you trust. You can't remove admin access from the last remaining admin — Famlin blocks that so you can't accidentally lock everyone out.
- **Reset a password** — click the key icon, enter a new password (8+ characters), and share it with the user directly. There's no self-service/email-based reset flow yet. Resetting a password immediately signs that account out everywhere else it was logged in.
- **Manage group membership** — click the people icon to open a modal listing every group with add/remove buttons. This is the same membership data as the Groups page, just scoped to one user.
- **Toggle notifications** — the bell and mail icons flip all push/email notification types for that user on or off in one click; per-event-type settings (new post vs. comment vs. like) are only editable by the user themselves, in the app.
- **Delete a user** — permanently removes the account, and everything they created with it: their posts, comments, likes, and favorites are deleted along with them (unlike removing someone from a group, below, which keeps their existing posts/comments visible). This can't be undone. You can't delete your own account this way, and you can't delete the last remaining admin.

## Groups

The **Groups** page is a two-pane view: pick a group on the left, manage it on the right.

- **Create / edit / delete a group** — **New group** at the top, or **Edit**/**Delete** on the selected group. A group just has a name and description; deleting one removes its posts and comments along with it (unlike posts/comments, a deleted group can't be restored).
- **Choose which post types the group allows** — the group form's **Allowed post types** section has one checkbox per post type the server supports (plain updates, milestones, polls, and any added later). Leave every box checked (the default) to allow all of them, including types added in a future update — you don't need to come back and re-check anything after an upgrade. Uncheck a type to hide it from that group's post composer; at least one type must stay checked. Existing posts of a type you later uncheck aren't affected — they stay visible, only creating new ones of that type is blocked.
- **Add an existing user to the group** — pick them from the dropdown next to **Add member** in the detail pane (the same action as "manage group membership" on the Users page).
- **Add a new member to the group** — click **Add member** in the detail pane to open the same modal as on the Users page, preselected to this group; see [Inviting family members](./inviting-family) for the invite flow it defaults to.
- **Remove a member** — the ✕ icon on their row. Removing someone from a group does **not** delete their existing posts/comments in that group — those stay visible to the remaining members (a deliberate choice, not a bug).
- **Invites** — further down the same page (status, copy link, revoke); see [Inviting family members](./inviting-family) for that flow.

## Content moderation

The **Content** page gives admins cross-group visibility into posts and comments, without needing to be a member of every group.

- Switch between the **Posts** and **Comments** tabs, and narrow the list with the filter bar: a text search over the content, a group filter, and an author filter (combine them freely; **Clear filters** resets everything).
- The posts tab also shows each post's comment/like counts and marks milestone posts; the comments tab shows a snippet of the post each comment was left on.
- **Delete** (trash icon) removes a post or comment permanently — the same as a member's own delete. This can't be undone.
- **Resend push notification** (bell icon, posts only) re-delivers a post's push notification to the group — useful if a member's device was offline or missed it the first time. It only resends the push itself; it doesn't send another email or add a duplicate entry to anyone's in-app notification history.
- **Cross-posted content is moderated per group.** When a member shares a post with several of their groups at once, each group gets its own independent copy. Deleting one group's copy from the Content page only removes that copy — it doesn't touch the copies in the post's other groups.

There's no bulk delete action.

## Push notification log

The **Push notification log** page lists every push-notification send attempt — both automatic (a new post, comment, reaction, ...) and manually resent from the Content page — newest first. Each row shows when it was sent, the notification type, which post it was for (if any), how many people were eligible, how many devices were actually reached, how many failed, and who triggered it ("System" for automatic sends, otherwise the admin who clicked resend).
