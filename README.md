# Codex Explorer

A Notion-style file explorer, markdown editor, and SQLite "database" viewer
that works over SSH. It connects to any host in your `~/.ssh/config`, then lets
you browse, read, edit, and search remote files (markdown, PDFs, images, text)
as if they were local — with a navy / paper / orange palette.

Everything runs on your machine. Nothing is deployed to the cloud; the app only
ever talks to the SSH host you point it at.

> **Status: alpha.** Interfaces and behavior may still change.

## What it does

- **File explorer** — browse a remote tree, open files, full-text search, and
  delete files or folders via right-click (with confirmation).
- **Markdown editor** — inline editing with autosave and local image uploads.
- **Database views** — open a SQLite file as Notion-style tables and Kanban
  boards, with row pages and a quick-open command palette.

## Run it

```sh
bun install
bun run dev
```

Then open <http://localhost:3010>.

On first run you pick which host to connect to from your `~/.ssh/config`. You
can skip the picker by setting the `EXPLORER_SSH_HOST` environment variable.

## Configuration

The app is configured through environment variables:

| Variable               | Default        | Description                                                       |
| ---------------------- | -------------- | ----------------------------------------------------------------- |
| `EXPLORER_SSH_HOST`    | _(chosen in-app)_ | SSH host to connect to. Must match an entry in `~/.ssh/config`. |
| `EXPLORER_REMOTE_ROOT` | `/home/ubuntu` | Remote directory that is browsed as the explorer root.            |

## Desktop app

The Electron shell runs the same TanStack Start app. In development it loads
the Vite dev server; packaged builds start the compiled server locally inside
the desktop app and serve the compiled client assets from `dist/client`.

```sh
bun run electron:dev
bun run electron:pack:mac
bun run electron:pack:win
```

Full distributable builds are available with:

```sh
bun run electron:dist:mac
bun run electron:dist:win
```

macOS builds target Apple Silicon and Intel. Windows builds target x64 by
default.

## How it connects

It shells out to your system `ssh` using the host you selected (or the one in
`EXPLORER_SSH_HOST`) from `~/.ssh/config`, so it reuses your existing key/agent
setup. On macOS and Linux, one multiplexed connection (`ControlMaster`) is kept
alive for an hour, so commands take ~100ms instead of a full handshake. Windows
skips those Unix socket options and uses regular OpenSSH calls.

## Why it's fast

- The entire visible tree is fetched in **one** `find` call and cached for 30s —
  folder navigation never touches the network.
- File contents are cached for 60s; the router caches visited pages and
  preloads links on hover.
- Markdown + syntax-highlighting code (react-markdown, highlight.js) lives in a
  lazy chunk — folder browsing never loads it.
- Fonts are self-hosted (no Google Fonts request, works offline).
- `/api/raw` sends ETags; unchanged PDFs/images revalidate as tiny 304s, and
  warm reads come from the server cache in ~10ms.

Measured on one setup (production build): folder navigation ~1ms, cached file
reopen ~4ms, 304 revalidation ~11ms, warm PDF ~11ms, cold PDF ~260ms.

## Fail-safe behavior

- If the connection drops, the app keeps serving the last saved copy and shows
  an **offline** indicator in the sidebar (with a retry button) and a banner
  above stale content.
- A circuit breaker makes requests fail fast (instead of hanging) for 10s after
  a connection failure; commands also time out after 15s.
- `bun run scripts/test-failsafe.ts` verifies this behavior.

## Project layout

- `src/server/ssh.ts` — SSH transport, caching, circuit breaker, search
- `src/server/files.ts` — server functions used by the UI
- `src/routes/index.tsx` — the explorer page (browse / view / search)
- `src/routes/api/raw.ts` — streams raw files (PDF viewer, images, downloads)
- `src/components/` — sidebar, file tree, viewers, database views
- `src/styles.css` — design tokens (navy / paper / orange)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, quality gates, and PR
conventions.

## License

MIT — see [LICENSE](LICENSE).
