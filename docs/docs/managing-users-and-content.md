---
sidebar_position: 5
---

# Managing users, groups, and content

Day-to-day admin tasks all live under `/admin`, alongside the initial setup covered in [Admin configuration](./admin-configuration) and [Inviting family members](./inviting-family).

## Users

The **Users** page lists every account, their group memberships, and whether they're an admin.

- **Create a user directly** — click **New user** and fill in name, email, and a password (8+ characters). Useful for an account that won't sign up itself via OIDC or an invite link.
- **Toggle admin access** — click the shield icon on a user's row. Admins can reach every page under `/admin`, so keep this limited to people you trust. You can't remove admin access from the last remaining admin — Famlin blocks that so you can't accidentally lock everyone out.
- **Reset a password** — click the key icon, enter a new password (8+ characters), and share it with the user directly. There's no self-service/email-based reset flow yet. Resetting a password immediately signs that account out everywhere else it was logged in.
- **Manage group membership** — click the people icon to open a modal listing every group with add/remove buttons. This is the same membership data as the Groups page, just scoped to one user.
- **Toggle notifications** — the bell and mail icons flip all push/email notification types for that user on or off in one click; per-event-type settings (new post vs. comment vs. like) are only editable by the user themselves, in the app.
- **Delete a user** — deactivates the account rather than erasing it: they're immediately signed out everywhere and can no longer log in, but their existing posts/comments stay visible (same as removing them from a group, below). You can't delete your own account this way, and you can't delete the last remaining admin. A deactivated user shows greyed out in the list with a **Deactivated** label; click the restore icon on their row to reactivate them.

## Groups

The **Groups** page is a two-pane view: pick a group on the left, manage it on the right.

- **Create / edit / delete a group** — **New group** at the top, or **Edit**/**Delete** on the selected group. A group just has a name and description; deleting one removes its posts and comments along with it (unlike posts/comments, a deleted group can't be restored).
- **Add an existing user to the group** — pick them from the dropdown next to **Add member** in the detail pane (the same action as "manage group membership" on the Users page).
- **Remove a member** — the ✕ icon on their row. Removing someone from a group does **not** delete their existing posts/comments in that group — those stay visible to the remaining members (a deliberate choice, not a bug).
- **Invites** — further down the same page; see [Inviting family members](./inviting-family) for that flow.

## Content moderation

The **Content** page gives admins cross-group visibility into posts and comments, without needing to be a member of every group.

- Switch between the **Posts** and **Comments** tabs, and optionally filter by group.
- Check **Show deleted** to include posts/comments that have already been soft-deleted (by their author, a group member, or an admin) — deleted items show who removed them and when.
- **Delete** (trash icon) removes a post or comment the same way a member's own delete would: it's soft-deleted, not erased.
- **Restore** (the icon on an already-deleted item) undoes that — the post/comment becomes visible to group members again immediately.

There's no bulk action or audit log beyond the "deleted by / on" label shown per item.
