# Estradeck

> ### An open-source presentation studio — from **[Syndicats](https://www.syndicats.de)**

**Estradeck** is a Slides-like web editor with [reveal.js](https://revealjs.com/) as foundation.
A deck is a single HTML file; Estradeck reads and writes that file **surgically** (byte-stable
per-slide edits) and previews it live. On top of the `revealjs` skill in `.claude/skills/revealjs/`
it adds reusable **themes**, an inline **AI assistant** and a parallel **agent fleet** — drive either
by drawing a **Magic Frame** on the slide — a **⌘K command palette**, and one-click **PDF / MP4
export**.

> *Estradeck* = **estrade** (the stage a speaker stands on) + **deck** — where your deck takes the stage.
> Built by [Syndicats](https://www.syndicats.de). Not affiliated with or endorsed by reveal.js or Slides;
> "reveal.js" is used only to describe compatibility.

**Core idea — the file is the source of truth.** The server parses each deck with `parse5`
(`sourceCodeLocationInfo`) to get exact byte offsets, then applies edits by **string-splicing the
original bytes** and writing atomically (temp file + rename). Everything outside the edited slide
stays byte-identical. A `sha256` content hash guards against clobbering concurrent edits (returns
`409`, the editor shows a "reload" banner). A `chokidar` watcher broadcasts file changes over a
WebSocket so the preview and navigator stay in sync no matter who wrote the file — you, the inline
AI, or a fleet of headless agents.

---

## What it does

### Editing
- **Slide navigator** — every top-level `<section>` (and vertical child) listed; click to jump the
  live preview. Reorder by drag-and-drop, add / duplicate / delete slides. The navigator has three
  tabs: **Slides**, **Assets**, and **History**.
- **Live preview** — the real reveal.js deck in an iframe, auto-reloading on any change (your edits
  *and* the AI's), preserving your position. **Present** opens the deck full-screen in a new tab.
- **Per-slide code editor** — CodeMirror showing exactly the selected slide's source HTML; autosaves
  back to the file, with a conflict guard if the file changed underneath you. Format-on-demand
  (prettier).
- **⌥-click preview → source** — hold **⌥** over the live preview to highlight the element under the
  cursor, then ⌥-click to jump straight to that element in the Code editor (or a theme template),
  cursor placed just inside its opening tag.
- **Inline image swaps** — every image reference in the code (`<img src>`, `poster`,
  `data-background-image`, CSS `url(...)`) shows a small live thumbnail; click it to swap to any image
  in the deck's — or theme's — assets.
- **Styles tab** — edit the deck's full `styles.css` directly, with the same hash-guarded atomic
  write.
- **Colors panel** — the deck's palette CSS variables from `styles.css` (`--primary-color`, …) as
  live swatches; edits are written back with comments/formatting preserved.
- **Theme tab** — see and switch the deck's applied theme and review the palette + fonts it inherits
  (see **[Themes](#themes)** below).
- **Animation panel** — per-slide transition / speed / auto-animate, background-color presets and a
  section-divider toggle, per-element **fragment** controls (`fade-up`, `rise`, `pop`, …), and
  deck-wide transition defaults.

### Themes
A **theme** is a reusable brand blueprint — a palette + fonts (and a set of standard slides) that any
deck can adopt. Themes are edited in their own **workspace** (the same three-pane layout as a deck);
you switch between decks and themes from the one dropdown in the top bar.

- **Apply a theme to a deck** — the theme's palette/fonts are *materialized* into the deck's
  `styles.css` (a managed `:root` block), so the deck stays a **self-contained**, publishable HTML
  file even if the theme later changes or is deleted. Deck-level overrides always win by cascade.
- **Theme slides** — reusable slide templates with `{{placeholder}}` tokens; each placeholder is
  **text**, **multiline**, or an **image** (a default from the theme's assets, overridable on insert).
  Theme slides get the full code editor too (highlighting, completion, Slides Intelligence, format),
  and you can step their fragment animations with the arrow keys in the preview.
- **Copy a deck slide → theme** — promote any polished slide into a theme, then add placeholders.
- **Insert a theme slide → deck** — pick a template, fill the placeholders in a dialog with a **live
  preview**, and it's spliced into the deck (referenced theme assets are copied across automatically).
  Or do it keyboard-only with **⌘I**.
- **Bundled `default` theme** — a clean, brand-neutral palette (blue/teal/slate, IBM Plex) matching
  the scaffold's out-of-the-box look. Make your own with **New theme** (optionally seeded from the
  current deck).

### AI assistance
- **Slides Intelligence (⌘K in the Code editor)** — an inline assistant in the Code tab. Select text
  (or none), press ⌘K, and describe a change in natural language; it rewrites the selection or recomposes the whole
  slide body. Runs on a **direct OpenAI call** for low latency, style-aware (it's fed the deck's CSS
  tokens, image list, and video list). Includes ghost-text autocomplete of your prompt as you type.
- **Agent fleet (⌘A)** — queue multiple headless **`claude` CLI** agents that work **asynchronously
  and in parallel**. Open the tab straight into a mode — **create a new slide**, **edit this slide**,
  or **generate multiple slides** — from the keyboard or the ⌘K palette. Up to
  `AGENT_CONCURRENCY` (3) run at once; the rest wait in the queue. Each agent runs in an isolated
  workspace and only writes one `slide.html`, which the server merges back into the deck — so
  concurrent agents on different slides never corrupt the file. Live transcript, status, and a
  cancel button per job; the navigator shows a pulsing dot on whichever slide an agent is editing.
- **Generate multiple slides** — give a topic and a count; a planner (OpenAI) decomposes it into an
  ordered, coherent outline, reserves the placeholder slides in order, then fans out one agent per
  slide so they fill in parallel without clashing.
- **Magic Frame (⇧⌘-drag on the preview)** — draw a rectangle over any part of the live slide to
  brief the AI on *exactly* that region. The selection is turned into context and inlined into your
  prompt: the elements it covers (their markup **with inline styles**), the region's position (in the
  slide's 1280×720 space), and the background colour under it (resolved from the CSS). A popover —
  with the same **@-mention** support for images/videos/slides as the other prompt fields — lets you
  pick the engine:
  - **Slide Intelligence** — a one-shot completion applied in place that jumps you to the Code editor;
    a **whole-section** toggle (on by default) lets it rewrite the `<section>` itself so it can change
    the slide's background / inline styles, not just the content. The marked rectangle **pulses** as a
    live progress indicator until the edit lands.
  - **Agent** — queues a full edit job for the slide and opens the Agents tab to watch the transcript.

### Assets
- **Images** — drag-and-drop / pick files, or pull from a URL, into the deck's `images/` folder;
  reference them as `images/NAME.png`.
- **Videos** — paste a YouTube (or other) URL and the server downloads it via **`yt-dlp`** (capped
  at 720p / 300 MB), generates a poster frame with **`ffmpeg`**, and adds a `.video-embed` style.
- **Import images from a website** — point the picker at any URL (from the ⌘K palette) and it lists
  every image on the page with a thumbnail + pixel size; multi-select and import them into the deck
  **or** a theme's assets. URLs without a scheme default to `https://`.

### Output
- **History** — every change snapshots the deck's previous bytes (last 60); restore any snapshot
  (the restore is itself undoable).
- **Export PDF** — render every slide to a pixel-perfect PDF via **decktape** + headless Chrome.
- **Export slide → MP4** — render a single slide *with its fragment animations* to a 1080p MP4
  (headless Chrome screencast + **ffmpeg**), with a per-step timeline editor.
- **Duplicate / delete deck.**
- **"Built with Estradeck" badge** — every generated deck carries a small bottom-right credit linking
  to the project (defined once in `base-styles.css`, so it ships inside the deck).

---

## Keyboard & command palette

Press **⌘K** (Ctrl+K) anywhere — including the Agents prompt — to open a fuzzy, GitHub-style
**command palette**. It searches every action and destination: switch deck/theme, jump to any slide
or inspector tab, present, export, **New deck** / **New theme**, **add slide from theme**, fetch an
image/video from a URL, or import images from a website. (Inside the Code editor, ⌘K stays bound to
Slides Intelligence.)

Direct shortcuts in deck mode:

| Shortcut | Action |
|---|---|
| **⌘K** | Open / close the command palette |
| **⌘I** | Add a slide from a theme (after the selected slide) |
| **⌘P** | Present — open the deck full-screen |
| **⌘E** | Export / download the deck as PDF |
| **⌘A** | Open the Agents tab |
| **↑ / ↓** | Previous / next slide in the navigator |

**Preview gestures:** **⌥-click** an element to jump to its source in the Code editor · **⇧⌘-drag**
a rectangle to open **Magic Frame** on that region.

---

## Folder structure

```
estradeck/
├── client/                      React + Vite + TypeScript SPA (dev :5173)
│   ├── index.html
│   ├── vite.config.ts           proxies /api /decks /ws → server :5174
│   └── src/
│       ├── App.tsx              layout shell (resizable panes, keyboard nav)
│       ├── components/          DeckBar, SlideNavigator, SlideMenu, Preview, Inspector,
│       │                        CodeEditor, StyleEditor, ColorPanel, AnimationPanel,
│       │                        FleetPanel, AssetsPanel, HistoryPanel, SiDock,
│       │                        CommandPalette, ImagePicker, NewDeckModal,
│       │                        Theme{Navigator,Inspector,Preview,Panel,AssetsPanel},
│       │                        InsertThemeSlideModal, CopyTo{Theme,Deck}Modal,
│       │                        VideoExportModal, MentionTextarea, RegionPromptPopover (Magic Frame)
│       ├── api/                 REST client + WebSocket client
│       ├── lib/                 CodeMirror extensions (color + image swatches, Slides Intelligence),
│       │                        previewHighlight + regionPick (⌥-click jump, Magic Frame),
│       │                        fragment/locate helpers
│       └── state/deckStore.ts   zustand store
│
├── server/                      Node + Express + ws (dev :5174)
│   └── src/
│       ├── index.ts             app wiring + static deck serving
│       ├── config.ts            paths, env, ports
│       ├── ws.ts / watcher.ts   WebSocket hub + chokidar file watcher
│       ├── deck/                io, parse (parse5), splice, sections, css  — byte-stable engine
│       ├── decks/               create, duplicate, export (PDF), videoExport (MP4),
│       │                        images, videos, history, intelligence (OpenAI), format, paths
│       ├── themes/              registry, css (managed :root block), apply, slides,
│       │                        preview, assets, intelligence  — the theme engine
│       ├── scrape.ts / url.ts   website image scraper + URL normaliser
│       ├── agent/               jobs (queue/concurrency), runner (spawns claude), summarize
│       └── routes/              decks, slides, styles, images, videos, history, intelligence,
│                                format, agent, themes, themeAssets, deckTheme
│
├── shared/                      TypeScript types shared by client + server
│   └── src/types.ts
│
├── presentations/<deck-id>/     ONE folder per deck (user data; gitignorable):
│   ├── presentation.html        the deck — the single source of truth
│   ├── styles.css               palette variables + components (theme block + deck overrides)
│   ├── images/                  uploaded images
│   ├── videos/                  downloaded videos + poster frames
│   └── screenshots/             (export scratch)
│
├── themes/<theme-id>/           reusable theme: theme.json, theme.css (palette + fonts),
│   ├── slides/                  standard slide templates ({{placeholder}} HTML + JSON)
│   └── assets/                  theme images
│
├── .claude/skills/revealjs/     the skill the studio wraps (SKILL.md, scripts, references)
├── .studio-work/                per-job agent workspaces (runtime, gitignored)
├── .studio-history/             deck snapshots for the History panel (gitignored)
├── docs/                        design notes
├── .env / .env.example          server secrets & config (see Configuration)
├── package.json                 npm workspaces root + dev/build/typecheck scripts
└── tsconfig.base.json
```

---

## Prerequisites

| Requirement | Needed for | Notes |
|---|---|---|
| **Node 20+** (developed on 22) + npm | everything | uses `process.loadEnvFile`, native `fetch` |
| Network access | the live preview | reveal.js / Font Awesome / Chart.js / ECharts load from CDN |
| **`claude` CLI**, installed and logged in | the **Agents** tab | the server inherits your shell's auth via `~/.claude` and stores no credentials. Override the binary with `CLAUDE_BIN=/path/to/claude` |
| **`OPENAI_API_KEY`** | **Slides Intelligence (⌘K)** + multi-slide planner | put it in `.env` (see below). The Agents tab does **not** need it |
| **Chrome / Chromium** | **Export PDF** and **Export slide → MP4** | auto-detected in the usual macOS/Linux locations; override with `CHROME_BIN` |
| **`ffmpeg`** | MP4 export + video poster frames | override with `FFMPEG_BIN` |
| **`yt-dlp`** | downloading videos from a URL | e.g. `brew install yt-dlp` |

Everything except the AI features and the export tools works with just Node + a browser.
The studio degrades gracefully — if a tool is missing you get a clear error only when you use the
feature that needs it.

---

## Getting started

```bash
npm install          # installs the root + client/server/shared workspaces
npm run dev          # starts the server (:5174) and client (:5173) together
```

Open **http://localhost:5173**, click **New deck**, and start editing.

> The agent fleet needs the `claude` CLI; the ⌘K assistant needs an OpenAI key in `.env`. Copy the
> template first if you want either: `cp .env.example .env` and fill in `OPENAI_API_KEY`.

Other scripts (from the repo root):

```bash
npm run typecheck    # tsc --noEmit across server + client
npm run build        # production build of the client (Vite → client/dist)
```

Run a workspace on its own if you prefer:

```bash
npm run dev:server   # tsx watch server/src/index.ts
npm run dev:client   # vite
```

---

## Configuration (`.env`)

Copy `.env.example` to `.env` (gitignored) at the repo root; it's loaded at server startup, and
keys added later are picked up without a restart for the OpenAI features.

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | Slides Intelligence (⌘K) + the multi-slide planner |
| `SI_MODEL` | `gpt-5.4-mini` | model for SI generation / planning |
| `SI_COMPLETE_MODEL` | `gpt-5.4-nano` | model for inline prompt autocomplete |
| `CLAUDE_BIN` | `claude` | path to the Claude CLI for the agent fleet |
| `PORT` | `5174` | server port |
| `CHROME_BIN` / `CHROME_PATH` | auto-detected | Chrome for PDF/MP4 export |
| `FFMPEG_BIN` | `ffmpeg` | ffmpeg for MP4 export & posters |

---

## How "New deck" works

`POST /api/decks` shells out to `.claude/skills/revealjs/scripts/create-presentation.js` to write a
`presentation.html` — **a single title slide** — plus a copy of the default `styles.css` into
`presentations/<slug>/`. **New deck** lets you set a title and pick a **theme** (materialized into the
new deck's `styles.css`); you build out the rest from inside the studio — the navigator's **＋**, the
agents, or **add slide from theme**.

## How the agent fleet stays safe under concurrency

Each job runs in `.studio-work/<jobId>/` with a copy of the deck's `styles.css` and a read-only
`DECK_CONTEXT.html` for context. The agent is told to edit **only** `slide.html` (one `<section>`).
When it finishes, the server validates the result is a single section and merges it back via the
same byte-stable splice used everywhere else (`putSlide` for edits, `addSlide` for creates). Those
merges are synchronous read-modify-write operations, so even when several agents finish at once they
apply one at a time without interleaving — different slides never conflict, and the file is never
left half-written. Cancelling a job SIGTERMs its process and discards its workspace.

---

## Architecture at a glance

```
client/   React + Vite + TypeScript  (dev :5173, proxies /api /decks /ws → server)
server/   Node + Express + ws        (dev :5174)
shared/   shared TypeScript types
```

- **Client** — a zustand-backed SPA with two modes, **deck** and **theme**. The left
  **SlideNavigator** (slides / assets / history) and the right/bottom **Inspector**
  (Code · Styles · Colors · Theme · Animation · Agents) flank a live **Preview** iframe; theme mode
  swaps in the matching Theme\* panels. CodeMirror powers the editor, with the **SiDock** (⌘K in the
  Code tab) and the **CommandPalette** (⌘K elsewhere) layered on top.
- **Server** — the `deck/` module is the byte-stable engine (parse5 offsets + atomic splice).
  `decks/` holds the deck feature services (create, exports, images/videos, history,
  OpenAI intelligence); `themes/` is the parallel theme engine (palette materialization + slide
  templates). `agent/` runs the Claude fleet. `routes/` exposes them over REST; `ws.ts` pushes live
  updates.

### API surface (server)

REST under `/api`:
- Decks: `GET/POST /decks`, `GET/DELETE /decks/:id`, `POST /decks/:id/duplicate`,
  `GET/PATCH /decks/:id/config`, `GET /decks/:id/export.pdf`
- Slides: `GET/PUT/POST/DELETE /decks/:id/slides[/:key]`, `POST …/reorder`,
  `POST …/:key/duplicate`, `PATCH …/:key/section`, `GET …/:key/fragments`,
  `PATCH …/:key/fragment`, `POST …/:key/video`
- Styles: `GET/PUT /decks/:id/styles`, `GET/PUT /decks/:id/styles/raw`
- Images: `GET/POST /decks/:id/images`, `POST …/from-url`, `DELETE …/:name`
- Videos: `GET /decks/:id/videos`, `POST …/from-url`, `DELETE …/:name`
- History: `GET /decks/:id/history`, `POST …/:snapId/restore`
- Slides Intelligence: `POST /decks/:id/si`, `POST …/si/complete`
- Format: `POST /decks/:id/format`
- Agents: `GET/POST /decks/:id/agent`, `POST …/batch`, `POST …/:jobId/cancel`
- Themes: `GET/POST /themes`, `GET/PATCH/DELETE /themes/:id`, `POST …/:id/sync-decks`;
  slides `GET/PUT/DELETE …/:id/slides/:slug`, `GET …/:id/slides/:slug/preview`,
  `POST …/:id/slides/from-deck`, `POST …/:id/si[/complete]`; assets `GET/POST/DELETE …/:id/assets`
- Deck ↔ theme: `GET/PUT /decks/:id/theme`, `POST …/theme/sync`, `POST …/theme/insert`
- Website images: `POST /scrape-images` · base component styles: `GET /brand/base.css`
- Static deck files for the iframe: `GET /decks/:id/*` (served `no-store`)

WebSocket (`/ws`, room-per-deck via `{type:'subscribe',deckId}`): `deck-changed`,
`jobs-snapshot`, `job-update`, `job-log`.

---

## Notes & limits

- Edit jobs target one slide each; two edit jobs on the *same* slide are last-writer-wins.
- Deleting/adding slides operates on top-level slides; vertical children are edited in place.
- New decks start as a single title slide; build out the rest from the navigator, the agents, or
  theme slides.
- **Magic Frame** and the ⌥-click jump are deck-preview features (the theme preview supports ⌥-click
  jump too; the region prompt targets the deck's agents / Slides Intelligence).
- The preview, the PDF/MP4 export, and a deck opened standalone all need network for the CDN assets.
- `presentations/` is treated as user data; uncomment the rule in `.gitignore` to keep decks local.

---

## License & credits

Estradeck is released under the **MIT License** (see [`LICENSE`](LICENSE)) — © Syndicats eG.

Built on **[reveal.js](https://revealjs.com/)** by Hakim El Hattab and contributors (MIT) — loaded from
CDN at runtime, not bundled. Estradeck is an independent project and is **not affiliated with or
endorsed by reveal.js or Slides**; the name "reveal.js" is used only to describe compatibility.
Other notable dependencies (all permissive): React, Express, Zustand, CodeMirror, parse5, Prettier,
Chart.js (MIT), ECharts (Apache-2.0), IBM Plex (SIL OFL), Font Awesome Free. `ffmpeg` and `yt-dlp`
are optional external tools you install separately.
