# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-30

### Added

- A Wiki.js device: pages, pages changed today, and the title of the latest
  changed page.
- The "Wiki.js" dashboard widget: two tiles and the eight pages changed last,
  of the whole wiki, of a folder or of a tag.
- Scene triggers "Wiki.js page created or updated" (filtered by folder, page
  path and kind of change) and "Tagged Wiki.js page changed" (filtered by tag),
  silent at installation, remembered across restarts.
- Scene actions "Create a Wiki.js page" (Markdown content, tags) and "Add a line
  to a Wiki.js page" (a dated journal, created at its first line).
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-wikijs/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-wikijs/releases/tag/v1.0.0
