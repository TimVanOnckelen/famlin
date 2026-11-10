# famlin.app landing page

The marketing site at [famlin.app](https://famlin.app): the home page, `/privacy/` and `/support/`, in every language in `languages.json`. The docs under `/docs/` are a separate Docusaurus site (`docs/`).

## How it is built

```
website/
  src/              one HTML template per page
  locales/en.json   the English text, one object per page (home, privacy, support)
  locales/nl.json   the same keys in Dutch
  languages.json    which languages to build, in switcher order; the first is the default
  assets/ favicon.ico CNAME   copied as-is
  build.mjs         renders everything, no dependencies
```

```sh
node website/build.mjs            # writes website/dist/
npx serve website/dist            # or any static file server
```

The default language (English) is built at the site root, every other language under `/<code>/` (`/nl/`, `/nl/support/`, …). The Pages workflow runs the same script into `_site`, and CI's *Docs site* job builds it on every PR.

Templates use these placeholders:

| Placeholder | Becomes |
| --- | --- |
| `{{t:home.some_key}}` | the string `home.some_key` in the page's language, or English if it is missing |
| `{{lang}}` | the language code, for `<html lang>` |
| `{{root}}` | `/` or `/nl/`, for links to other pages of this site (`href="{{root}}support/"`) |
| `{{alternates}}` | the `<link rel="alternate" hreflang>` tags |
| `{{langswitch:compact}}` / `{{langswitch:inline}}` | the language switcher (home nav / privacy and support nav) |

Strings may contain inline HTML (`<strong>`, `<a>`, `<code>`) and `{{root}}`. Links to `/docs/` stay as they are: the docs are English only.

## Changing text

Edit the template for structure and `locales/en.json` for the English text, then update the same key in every other locale file in the same PR. A key missing from a translation falls back to English and the build prints a warning; a key missing from `en.json` fails the build. Never edit generated HTML.

New keys can have any name; existing ones were generated from the first words of the English text.

## Adding a language

1. Copy `locales/en.json` to `locales/<code>.json` and translate the values (keep the keys, the HTML tags and `{{root}}`).
2. Add `{ "code": "<code>", "label": "<SWITCHER LABEL>" }` to `languages.json`.
3. Run `node website/build.mjs` and check the pages under `dist/<code>/`.

Use the same codes as the apps (`fr`, `pt-PT`, `zh`), so the site and the apps stay in step.
