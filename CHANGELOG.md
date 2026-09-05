# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Embedded the real Estradeck presentation studio for `.slides.html` decks,
  including slide operations, assets, history, themes, colors, animations,
  agents, and Reveal export with revision-safe workspace synchronization and a
  built-in-editor fallback
  ([#2](https://github.com/Pldesch/sshelf/pull/2)).
- Added an opt-in, development-only local filesystem transport for running
  Sshelf on the server it browses, with production guards, an explicit bounded
  root, and symlink-traversal protection.
- Added visible directory and per-entry action controls, arbitrary file
  creation, folder renaming, and consistent operation notifications.
- Added reversible remote trash with Undo and Markdown revision-conflict
  resolution, preventing accidental data loss during deletes and concurrent
  edits.

### Changed

- Database search, filters, sorting, and row counts now run against the complete
  SQLite table before bounded pagination.

## [0.7.2] - 2026-09-03

### Fixed

- Prevented application shortcuts from firing while users type in editors and
  inputs.
- Kept Reveal slide previews and PDF exports on the same validated, per-deck
  canvas size so print mode no longer stretches or clips full-height slides,
  and made decks full bleed by default.

## [0.7.1] - 2026-09-01

### Added

- Added Reveal.js previews for `.slides.html` files, with presentation controls
  and a clean white workspace canvas.
- Added inline rich-text editing with autosave and an in-memory revert history,
  while keeping editing metadata out of the source HTML.
- Added Reveal's native PDF export flow with authored slide spacing and flex or
  grid layouts preserved in print mode.

## [0.7.0] - 2026-08-25

### Changed

- Reworked the application shell and filesystem data flow so navigation keeps
  the sidebar mounted, folders load lazily, and mutations refresh only affected
  directories instead of invalidating the entire interface.
- Added bounded database pagination and optimistic cache updates, serialized
  Markdown autosaves, and streaming file responses with HTTP byte ranges.
- Made prerelease tags publish as GitHub prereleases so beta builds can be
  tested independently before merging into `main`.

## [0.6.1] - 2026-08-24

### Added

- A restricted `postMessage` file bridge for sandboxed HTML previews. Static
  HTML tools can now read and write existing text companion files in their own
  directory tree, enabling shared persistent state without browser storage.

## [0.6.0] - 2026-08-23

### Added

- A **Cyrus page** for hosts running the [Cyrus](https://github.com/cyrusagents/cyrus)
  AI agent: service status (`cyrus` + `ngrok` systemd units, edge worker
  health), active sessions, and every git worktree with its GitHub PR and
  Linear issue status. A worktree can be archived (removed locally) once its
  work has landed, with safety checks against active sessions and uncommitted
  changes.
- Open-source MIT license and contributor documentation (`README`,
  `CONTRIBUTING`, this changelog).
- Continuous integration workflow running typecheck, lint, prettier, tests, and
  build on pull requests and pushes to `main`.
- Configurable browsed remote root via the `SSHELF_REMOTE_ROOT` environment
  variable (defaults to `/home/ubuntu`).
- Unit tests.

### Changed

- **Renamed the project to Sshelf** (`ssh` + _shelf_). The app, package, app id
  (`com.sshelf.app`), window title, and config file (`~/.sshelf.json`) all use
  the new name; the environment variables are now `SSHELF_SSH_HOST` and
  `SSHELF_REMOTE_ROOT`. The remembered host resets once on upgrade.
- Migrated all data fetching to TanStack Query (React Query) via the router's
  SSR integration: reads are prefetched by loaders and read with
  `useSuspenseQuery`; the tree, search, and all mutations use React Query with
  cache invalidation. SSR, hover-preload, and offline-stale behavior preserved.
- Neutralized branding for the open-source alpha release (removed internal
  server and design-system references; the SSH host is now chosen in-app or via
  `SSHELF_SSH_HOST`).
- Security hardening across the SSH transport and file handling.

## [0.5.6] - 2026-06-23

### Changed

- HTML previews and database tables now fill the visible pane without outer
  margins.
- HTML files now render directly without the preview/source switcher.

## [0.5.5] - 2026

### Added

- Notion-style Kanban board view for databases.

### Changed

- Database views use the full content width.
- Each database's view is persisted in the file (`_codex_views` sidecar).

## [0.5.4]

### Added

- Local image uploads in the markdown editor.
- "New markdown file" action in the folder context menu.

### Fixed

- Release flakiness: the GitHub release is now created before parallel publish.

## [0.5.3]

### Added

- SQLite databases: Notion-style tables, row pages, and a CLI.
- Collapsible database search with ⌘F / Ctrl+F.

### Fixed

- macOS release publish.

## [0.4.0]

### Added

- ⌘P / Ctrl+P quick-open file search palette.
- GitHub Releases auto-update and CI release workflow.

### Fixed

- Markdown editor image paths.
- macOS "app is damaged" launch error (ad-hoc signing of the build).

## [0.3.0]

### Added

- Live preview rendering for HTML files.

## [0.2.0]

### Added

- Inline markdown editing with autosave.
- Improved explorer file navigation.

## [0.1.1]

### Added

- Electron desktop builds.

## [0.1.0]

### Added

- Initial file explorer app over SSH, with offline fail-safe behavior
  (stale-cache serving, offline indicator, and circuit breaker).
