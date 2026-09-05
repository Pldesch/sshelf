# Contributing to Sshelf

Thanks for your interest in contributing! This is an alpha open-source project,
so issues, ideas, and pull requests are all welcome.

## Prerequisites

- [Bun](https://bun.sh) (the package manager and runtime used by this project)
- A working `ssh` client on your PATH, plus at least one host in your
  `~/.ssh/config` to connect to; or a POSIX development host for guarded local
  transport

## Getting started

```sh
bun install
bun run dev
```

Then open <http://localhost:3010>. On first run you pick the SSH host to connect
to (or set `SSHELF_SSH_HOST`). The browsed remote root defaults to
`/home/ubuntu` and can be overridden with `SSHELF_REMOTE_ROOT`.

When Sshelf and the browsed files live on the same development server, bypass
SSH explicitly:

```sh
NODE_ENV=development \
SSHELF_TRANSPORT=local \
SSHELF_LOCAL_ROOT=/absolute/path/to/workspace \
bun run dev
```

This mode is server-side only and fails closed outside development. The local
root must exist, cannot be `/`, and is kept separate from
`SSHELF_REMOTE_ROOT` so an existing remote configuration cannot silently widen
local filesystem access.

## Quality gates

Every change must pass the same checks CI runs. Run them locally before opening
a PR:

```sh
bun run typecheck   # tsc --noEmit
bun run typecheck:estradeck
bun run lint        # eslint
bun run check       # prettier --check
bun run test        # vitest run
bun run build       # vite build
bun run build:estradeck
```

## Code style

Formatting is enforced by Prettier. The config (`.prettierrc`) uses:

- no semicolons
- double quotes
- 2-space indentation
- 80-column print width

Just run the formatter before committing and you don't have to think about it:

```sh
bun run format
```

The Estradeck source under `vendor/estradeck` retains its upstream formatting
and is excluded from Sshelf's formatter and linter. Functional changes to the
embed are still covered by Estradeck's own typecheck and build commands.

## Branches and pull requests

- Branch off `main` for your work.
- Keep PRs small and focused — one logical change per PR is easiest to review.
- Make sure all quality gates above are green before requesting review.
- Write a clear description of what changed and why.

## Reporting issues

Open a GitHub issue. A good report includes:

- what you expected to happen and what actually happened
- steps to reproduce
- your OS and the relevant versions (Bun, Node, Electron if applicable)
- any error output from the terminal or the in-app offline indicator

For security-sensitive reports, please avoid filing a public issue with
exploit details — describe the impact and contact the maintainer privately.
