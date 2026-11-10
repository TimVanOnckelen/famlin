---
sidebar_position: 7
title: Mobile scroll diagnostics
---

# Mobile scroll diagnostics

The mobile app can measure how smoothly its own feed scrolls and hand the result back as text. It exists so a change to the feed can be judged with numbers from real phones, without Xcode, Instruments or a collection of test devices ([issue #357](https://github.com/TimVanOnckelen/famlin/issues/357)).

## Which builds have it

The diagnostics are compiled in only when the build is a development build or was made with `EXPO_PUBLIC_SCROLL_DIAGNOSTICS=1`. `mobile/eas.json` sets that variable per profile:

| EAS profile | Diagnostics | Used for |
| --- | --- | --- |
| `development` | yes | Dev client |
| `preview` | yes | Internal distribution (registered devices) |
| `diagnostics` | yes | A store-signed build for TestFlight or a Play internal testing track |
| `production` | **no** | The App Store and Google Play release |
| `apk` | **no** | The APK attached to each GitHub Release |

In a build without the flag the long press below does nothing and the bar can never appear.

The `diagnostics` profile is `production` plus the flag, so it can be uploaded to TestFlight for testers who are not registered devices. Build it from the **Mobile build** workflow (profile `diagnostics`) or with `eas build --profile diagnostics`, and submit it with `eas submit`. Never promote that build to the App Store or to a Play production track: release builds come from the `production` profile only.

## Recording a scroll

1. Open **Profile** and long-press the app version row for a second. "Scroll diagnostics on" appears under the version.
2. Go to the feed. A bar under the header offers **Start**.
3. Press **Start**, scroll the feed the way you normally would for about 20 seconds (a slow scroll and a few fast flings), then press **Stop**.
4. The bar shows the result for the screen (UI thread) and the app (JS thread). Press **Share** and paste the text into the issue.

Long-press the version row again, or restart the app, to switch the diagnostics off.

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

## Limits

- It measures the app's own two threads. Stutter caused purely by GPU compositing in the system's render server does not show up, so a clean report next to a visibly stuttering feed is itself a finding: it points at compositing.
- The frame counter runs only during a recording, and feed images report where they loaded from only while the diagnostics are on, so the normal feed is not affected by it.
- Compare reports from the same device and a similar feed. A before/after pair on one phone says more than two reports from different phones.
