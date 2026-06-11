# codex-explorer

A local file explorer for the **ovh-codex** SSH server, styled with the
in-house design system (navy / paper / orange). Browse, read, and search the files in
`/home/ubuntu` (markdown, PDFs, images, text), and delete files or folders
via right-click (with confirmation).

Runs only on this machine; nothing is deployed to the cloud.

## Run it

```sh
bun install
bun run dev
```

Then open <http://localhost:3010>.

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

It shells out to your system `ssh` using the `ovh-codex` entry from
`~/.ssh/config`, so it reuses your existing key/agent setup. On macOS and
Linux, one multiplexed connection (`ControlMaster`) is kept alive for an
hour, so commands take ~100ms instead of a full handshake. Windows skips
those Unix socket options and uses regular OpenSSH calls.

Set `EXPLORER_SSH_HOST` to point at a different SSH host.

## Why it's fast

- The entire visible tree (~250 entries) is fetched in **one** `find`
  call and cached for 30s — folder navigation never touches the network.
- File contents are cached for 60s; the router caches visited pages and
  preloads links on hover.
- Markdown + syntax-highlighting code (react-markdown, highlight.js)
  lives in a lazy chunk — folder browsing never loads it.
- Fonts are self-hosted (no Google Fonts request, works offline).
- `/api/raw` sends ETags; unchanged PDFs/images revalidate as tiny 304s,
  and warm reads come from the server cache in ~10ms.

Measured (production build): folder navigation ~1ms, cached file reopen
~4ms, 304 revalidation ~11ms, warm PDF ~11ms, cold PDF ~260ms.

## Fail-safe behavior

- If the connection drops, the app keeps serving the last saved copy and
  shows an **offline** indicator in the sidebar (with a retry button) and
  a banner above stale content.
- A circuit breaker makes requests fail fast (instead of hanging) for
  10s after a connection failure; commands also time out after 15s.
- `bun run scripts/test-failsafe.ts` verifies this behavior.

## Layout

- `src/server/ssh.ts` — SSH transport, caching, circuit breaker, search
- `src/server/files.ts` — server functions used by the UI
- `src/routes/index.tsx` — the explorer page (browse / view / search)
- `src/routes/api/raw.ts` — streams raw files (PDF viewer, images, downloads)
- `src/components/` — sidebar, file tree, viewers
- `src/styles.css` — design tokens (navy / paper / orange)
