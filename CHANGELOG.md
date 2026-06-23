# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
