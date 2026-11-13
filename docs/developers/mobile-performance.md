---
sidebar_position: 7
title: Mobile scroll diagnostics
---

# Mobile scroll diagnostics

The mobile app can measure how smoothly its own feed scrolls and send the result to the server's admin or share it as text. It exists so a change to the feed can be judged with numbers from real phones, without Xcode, Instruments or a collection of test devices ([issue #357](https://github.com/TimVanOnckelen/famlin/issues/357)).

## Where it lives

It is in every build, store releases included, as a visible setting: **Profile → Advanced → Report scrolling performance**. It's an explained, opt-in option rather than a hidden tester gesture, because stutter depends on the phone and the feed, so the reports that matter come from members' own phones — and because App Store guideline 2.3.1 forbids hidden features. The switch is held in memory only (`stores/scrollDiagnosticsStore.ts`), so restarting the app turns it off.

For App Review notes: *"Profile → Advanced → Report scrolling performance shows a bar above the feed that measures scroll smoothness. The member can send the result to their own Famlin server's administrator or share it via the share sheet; nothing is sent automatically, and nothing is sent to the developer."*

## Recording a scroll

1. Open **Profile**, scroll to **Advanced** and switch on **Report scrolling performance**.
2. Go to the feed. A bar under the header offers **Start**.
3. Press **Start**, scroll the feed the way you normally would for about 20 seconds (a slow scroll and a few fast flings), then press **Stop**.
4. The bar shows the result for the screen (UI thread) and the app (JS thread), with two buttons:
   - **Send to admin** posts the report to `POST /api/diagnostics/reports`. It shows up on the admin UI's **Diagnostics** page, where the admin can copy it into a GitHub issue. The button only appears when the server lists the `diagnosticReports` feature.
   - **Share** opens the share sheet with the report text.

The **✕** on the bar switches the diagnostics off (as does turning the setting off or restarting the app).

Measure in a Release build: a debug build runs JavaScript in development mode and stutters for reasons users never see. Locally, build in Release configuration: `npx expo run:android --variant release` or `npx expo run:ios --configuration Release --device`.

## Reading the report

```
Famlin scroll diagnostics
Device: iPhone 13 · iOS 26.1
App: 1.2.3 (45) · Server: 0.9.0
Scrolled: 21.4 s at 60 Hz
UI thread: 12.3 ms/s hitches (critical), 31 dropped of 1284 frames, worst 84 ms, p95 17.1 ms
JS thread: 3.1 ms/s hitches (good), 9 dropped of 1284 frames, worst 51 ms, p95 16.9 ms
Posts seen: 34 (MILESTONE 3, UPDATE 31)
Media: 71 items in 26 posts, 12 multi-photo posts, 4 videos
Images loaded while recording: 48 network, 20 disk, 3 memory
```

- **Hitches (ms/s)** is the time frames ran late per second of scrolling, the same measure as Apple's hitch time ratio: below 5 is unnoticeable, 5 to 10 is noticeable, above 10 is a visible problem.
- **UI thread high, JS thread low** points at native rendering: image decoding, layout or drawing.
- **JS thread high** points at React work: re-renders, hooks mounting as cells scroll in.
- **Posts, media and image loads** describe what was scrolled, so two reports can be compared fairly and a bad result can be tied to photo-heavy stretches or to images still arriving from the network.

Only frames produced while the list is moving are counted. The report contains no server address, account or post content.

## On the server

A sent report is a `DiagnosticReport` row (`kind: 'feed_scroll'`, the text above plus the same numbers structured in `data`, validated and bounded by `diagnosticReportBodySchema` in `backend/src/types.ts`). Members can send 10 per hour. Admins list and delete them via `GET`/`DELETE /api/admin/diagnostics`; the daily `pruneDiagnosticReports` job deletes reports older than 30 days. They are excluded from the admin export/restore, included in the sender's member export, and cascade with the user. The server never forwards a report anywhere.

A new kind of report adds a member to the discriminated union in `diagnosticReportBodySchema` (and to `DiagnosticReportPayload` in `packages/api-client/src/diagnostics.ts`); the admin page shows any kind's text, and its UI/JS badges only when `data.ui`/`data.js` exist.

## Limits

- It measures the app's own two threads. Stutter caused purely by GPU compositing in the system's render server does not show up, so a clean report next to a visibly stuttering feed is itself a finding: it points at compositing.
- The frame counter runs only during a recording, and feed images report where they loaded from only while the diagnostics are on, so the normal feed is not affected by it.
- Recording itself adds a little work on both threads (a frame callback on the UI thread, a `requestAnimationFrame` loop on the JS thread); on old phones that slightly inflates the numbers.
- Compare reports from the same device and a similar feed. A before/after pair on one phone says more than two reports from different phones.
