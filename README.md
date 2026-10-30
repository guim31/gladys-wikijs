# Wiki.js for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for
[Wiki.js](https://js.wiki) 2.x, the self-hosted wiki: follow its counters, react
when a page is created or updated, write pages from scenes and keep a journal
page that Gladys fills in line by line. Local only.

Tested against a real Wiki.js 2.5.317 (official Docker image
`ghcr.io/requarks/wiki:2`).

## Features

- **A Wiki.js device**: pages, pages changed today, and the title of the latest
  changed page.
- **Dashboard widget** "Wiki.js": two tiles and the eight pages changed last (of
  the whole wiki, of a folder or of a tag), each opening in Wiki.js over https.
- **Scene triggers** "Wiki.js page created or updated" (filters: folder, page
  path, created or updated) and "Tagged Wiki.js page changed" (filter: a tag),
  silent at installation, remembered across restarts.
- **Scene actions**: "Create a Wiki.js page" (Markdown content, tags) and "Add a
  line to a Wiki.js page" (a journal, dated, created at its first line).
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1 or later.
- Wiki.js 2.x reachable from Gladys, the API enabled and an API key
  (Administration → API Access). Wiki.js 3 is not supported.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-wikijs` (or find **Wiki.js** in the
   catalog).
2. In **Configuration**, enter the address of Wiki.js (`192.168.1.50:3000`) and
   the API key. Save.
3. Add the **Wiki.js** device from the **Discover** tab.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

Wiki.js pushes nothing: the container reads it every 15 minutes by default (5
to 60), and just after midnight, through its GraphQL API (`POST /graphql`,
`Authorization: Bearer <key>`). A read is one request, `pages.list` ordered by
update with `users.profile` (a key Wiki.js does not know is served as the
guest: the profile tells the two apart), plus `system.info` once (the version,
best effort) and `pages.single` for each change announced (its author). The
triggers keep the time of the newest change seen in `/data`. The device is
published with `should_poll: false`; only changed states are sent to Gladys.
Lines are added with `pages.update`, which is sent the whole page back (title,
description, publication, tags, scripts): Wiki.js resets the fields it is not
given.

## Limitations

- One Wiki.js, seen with the permissions of its API key.
- The triggers fire at the next read, not instantly; at most ten pages per read
  (the next ones at the next read; past 50 changes at once, the rest is
  skipped). Deleted and moved pages are not announced.
- Nothing is ever deleted or moved in Wiki.js.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the SDK's fake Gladys and a fake Wiki.js answering with
bodies recorded on a real Wiki.js 2.5.317 (`test/fixtures/wikijs/`).

## Credits

- [Wiki.js](https://github.com/requarks/wiki), by Nicolas Giard (Requarks) and
  contributors (AGPL-3.0): this integration only talks to its GraphQL API and
  contains none of its code.
- The cover shows the Wiki.js logo, from the official repository
  ([`client/static/svg/logo-wikijs.svg`](https://github.com/requarks/wiki/tree/main/client/static/svg)).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Wiki.js or
Requarks.

## License

Apache-2.0, see [`LICENSE`](LICENSE).
