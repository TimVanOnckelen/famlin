---
sidebar_position: 4
---

# Family events in your calendar

Famlin can put your family's [events](./sharing-updates.mdx) in the calendar app you already use — Google Calendar, Apple Calendar, Outlook, Thunderbird or a family organizer. You create a personal **calendar subscription** link once, add it to your calendar app, and new and changed events show up there by themselves.

The link is personal: it shows the events **you** can see, across every family you belong to, and your own replies.

## Create your link

### On the web

1. Click your avatar and open **Profile**.
2. In the **Calendar subscription** section, click **Create subscription link**.
3. Click **Copy**, or **Open in calendar app** to subscribe in your computer's default calendar app.

<img src={require('./img/calendar-subscription-web.png').default} alt="The Calendar subscription section on the web Profile page, right after creating a link: the link with a Copy button, a warning that it is only shown once, an Open in calendar app button, and Regenerate link and Turn off buttons" width="560" />

### On your phone

1. Open the **Profile** tab.
2. In the **Calendar subscription** section, tap **Create subscription link**.
3. Tap **Add to calendar** to subscribe in your phone's calendar app, or **Copy or share link** to add it somewhere else.

<img src={require('./img/calendar-subscription-mobile.png').default} alt="The Calendar subscription section on the mobile Profile screen, right after creating a link: the link, Add to calendar and Copy or share link buttons, setup tips, and Regenerate link and Turn off" width="320" />

:::caution Copy the link now
Famlin shows the link **only once**. The server keeps just a scrambled fingerprint of it, so nobody — not even an admin — can look it up later. If you lose it, regenerate it (see [Make a new link or turn it off](#make-a-new-link-or-turn-it-off)).
:::

## Add it to your calendar app

Use the link Famlin gave you (it ends in `famlin.ics`). Always choose **subscribe** (or "from URL"), not **import**: an imported file is a one-off copy that never updates.

### Google Calendar

Google Calendar can only subscribe from its website, not from the phone app. Once added, the calendar also appears on your phone.

1. Open [calendar.google.com](https://calendar.google.com) on a computer.
2. Next to **Other calendars** on the left, click **+** and choose **From URL**.
3. Paste the link and click **Add calendar**.

### Apple Calendar

**iPhone or iPad:** tapping **Add to calendar** in the Famlin app does this for you. To do it by hand:

1. Open **Settings → Calendar → Accounts → Add Account → Other**.
2. Tap **Add Subscribed Calendar**, paste the link, then tap **Next** and **Save**.

**Mac:**

1. In Calendar, choose **File → New Calendar Subscription**.
2. Paste the link and click **Subscribe**.
3. Choose how often to refresh under **Auto-refresh**, then click **OK**.

To see the calendar on all your Apple devices, choose **iCloud** as its location on the Mac.

### Outlook

1. In Outlook on the web (or the new Outlook app), open the calendar and choose **Add calendar**.
2. Choose **Subscribe from web**, paste the link, give the calendar a name and click **Import**.

### Thunderbird

1. In the Calendar view, choose **New Calendar…**.
2. Choose **On the Network**, paste the link as the location and click **Find Calendars**.
3. Select the calendar and click **Subscribe**.

### Family organizers and other apps

Most apps that can "subscribe to" or "sync" an iCal / ICS calendar by URL accept the Famlin link — family organizers, shared wall displays and smart displays included. Look for an option like **Add calendar from URL** or **Sync external calendar**.

## What's in the calendar

- **Events from every family you're in**, including events shared only with a [circle](./security.md#families-and-circles) you belong to. Events from the past 3 months and every upcoming event are included; older ones drop off.
- **The event's title, time and place**, and in the description the family it was shared in, who created it, and your reply. If your server admin has set it up, the description also has a link back to the event in Famlin.
- **Your reply** shows up in your calendar:

  | Your reply in Famlin | In your calendar |
  | --- | --- |
  | Going | Confirmed |
  | Maybe | Tentative |
  | Can't go | Still listed, with "You declined" in the description |
  | No reply yet | A normal entry |

- **One entry per event.** An event shared with several families appears once. When someone changes an event, the existing entry in your calendar is updated rather than duplicated.

Comments and photos are **never** in the calendar.

The calendar always matches what you can see in Famlin right now. If you leave a family or a circle, its events disappear from your calendar at its next refresh. The calendar is read-only: reply to an event in Famlin, not in your calendar app.

## When changes show up

Your calendar app decides when to check for changes, not Famlin, so new events and new replies can take a while to appear:

- **Google Calendar** can take up to 12–24 hours, and you can't make it refresh sooner.
- **Apple Calendar** on a Mac uses the **Auto-refresh** setting you chose (as often as every 5 minutes); on an iPhone it refreshes by itself periodically.
- **Outlook** usually takes a few hours.

To see an event right away, open it in Famlin.

## Make a new link or turn it off

Both options are in the same **Calendar subscription** section of your profile:

- **Regenerate link** replaces your link. The old one stops working immediately, so calendars subscribed to it stop updating (some apps then show an error or empty the calendar). Add the new link to your calendar apps again.
- **Turn off** removes your link without making a new one.

The profile shows when your link was created and when a calendar app last fetched it — handy to check whether a subscription still works, or whether a link you thought you'd removed is still being used.

Your link keeps working when you change your password. It's deleted together with your account.

## Keep your link private

:::warning Treat the link like a password
Anyone who has your link can see the titles, times and places of the events in your families, plus your replies — no sign-in needed. When you subscribe, your calendar provider (Google, Apple, Microsoft, …) stores the link on its servers and fetches your events from there.
:::

- Only add the link to calendar apps you trust, and don't share it in a chat or post. To share family events with someone, invite them to the family instead.
- If you think someone else has your link, [regenerate it](#make-a-new-link-or-turn-it-off) — the old link stops working at once.
- If you stop using a calendar subscription, turn the link off.

## For admins

- To put a **link to the event** in each calendar entry, set the **Public address** under [Server settings → General](./admin-configuration.md). Without it, entries have no link. New subscription links use this address too; without it, a link uses the address the member had open when creating it — so set it if that could be an internal address.
- Members' calendar links aren't in [backups or exports](./maintenance.md); after a restore, members create a new link.
- See [Security](./security.md#calendar-subscription-links) for how calendar links are protected.
