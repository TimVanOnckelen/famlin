---
sidebar_position: 3
---

# Family Wiki

The **Family Wiki** is where your family writes down the things it keeps explaining: Grandma's lasagna recipe, the holiday house's Wi-Fi password and how the boiler works, the family's traditions, who to call when. The feed is for moments that scroll away; the wiki is for knowledge that should stay findable.

:::note Web only for now
The wiki is available in the **web app**. The mobile app doesn't have it yet; it is planned as a follow-up. Pages you write on the web are stored on your server like everything else and will show up in the mobile app once it supports them.
:::

## How it is organized

Every family (group) has its own wiki. Switch between your families with the family chips at the top of the **Wiki** page. A page has:

- a **title**,
- an optional **icon** (one emoji),
- an optional **category**, such as "Recipes" or "Holiday house",
- the **content**, written in simple Markdown (see the cheat sheet below).

Open the wiki from **Wiki** in the sidebar, or press <kbd>g</kbd> then <kbd>w</kbd>.

## Creating, editing and searching

- **Create a page** with **New page** (or open `/wiki/new`). Pick the family, write a title and content, and use the **Preview** tab to check how it will look.
- **Edit a page** with **Edit** on the page. Any family member who can see a page can edit it, so it stays up to date without waiting for whoever wrote it first. The page shows who updated it last and when.
- **Search** with the search box on the overview. It looks through titles, categories and the full text of the pages you can see, and the newest edits come first.
- **Recently updated** on the overview lists the pages edited most recently.

## Categories

A category is a free-text label, one level deep. Type a new one when you create or edit a page, or reuse an existing one. The overview shows a chip for each category in use, with an **Uncategorized** chip for the rest; choose one to narrow the list. There is no separate category screen to manage: a category exists as long as a page uses it.

## Writing with Markdown

Pages support a small, safe subset of Markdown. The editor has toolbar buttons for the common ones.

| You type | You get |
| --- | --- |
| `# Title`, `## Section`, `### Sub-section` | Headings |
| `**bold**` | **bold** |
| `*italic*` or `_italic_` | *italic* |
| `- item` or `* item` | Bulleted list |
| `1. item` | Numbered list |
| `- [ ] task` / `- [x] done` | Checklist |
| `> quote` | Quote |
| `` `code` `` and fenced blocks with three backticks | Code |
| `---` | Horizontal rule |
| `[text](https://example.com)` | Link. `http(s)`, `mailto:` and `tel:` links work, as do bare web addresses |

Anything else (raw HTML, scripts, other link types) is shown as plain text, never executed.

### Linking to posts and other pages

Use **Link a post** in the editor's toolbar to link to something your family already shared: it lists the family's recent posts, with a search box, and inserts a link at the cursor. If you select some text first, that text becomes the link; otherwise the link is labelled with the post's title or its first words. Trips, albums and gift lists link to their own pages.

You can also type a link yourself, using an in-app path as the target: a post's permalink is `/posts/<id>`, for example `[our Italy trip](/posts/abc123)`; a wiki page's is `/wiki/<id>`. Clicking an in-app link opens it inside the app. The page you link to keeps its own audience: someone who can't see that post still can't open it.

### Photos

Use **Add photo** in the editor to upload a photo and insert it into the page. Only photos uploaded to your Famlin server can be shown; images from other websites are not displayed, so a page never makes your family's browsers fetch something from a third party. Uploaded photos are visible to exactly the people who can see the page.

## Private pages for a circle

When you create a page you can choose **Visible to**: the whole family, or one of your [circles](./managing-users-and-content.md#groups). A circle page is invisible to everyone outside the circle: they can't find it in search or the category list, and opening its address shows "this page isn't available". The audience is chosen when the page is created and can't be changed later.

If an admin deletes a circle, **the circle's wiki pages are permanently deleted with it**, just like its posts. The admin confirmation counts them.

## Locking a page

Some pages shouldn't change casually, for example the emergency contacts. The creator (or an admin) can **lock** a page: a locked page shows a lock badge, and only its creator or an admin can edit it. Everyone can still read it. Only the creator or an admin can lock or unlock a page.

## When two people edit at once

If someone else saves a page while you are editing it, Famlin doesn't overwrite their changes. When you save you'll see "*Someone* saved this page while you were editing" and two choices: **Discard mine, load theirs**, or **Save mine anyway**. Copy anything you want to keep before discarding.

## Deleting pages

Only the page's **creator** or an **admin** can delete a page. Deleting asks for confirmation and applies to the whole family. There is no revision history yet, so a deleted page can't be restored; restore from a [backup](./maintenance.md) if you must.

If a page's creator leaves the family or deletes their account, **the page stays**; it simply no longer shows who wrote it. Pages belong to the family, not to their author.

## Backups and exports

Wiki pages are family content, so:

- they are part of the admin **Data export** and of the scheduled database backups, and a restore brings them back with their circle audience intact;
- they are part of a member's own **data export** from their profile, limited to the pages that member can see.
