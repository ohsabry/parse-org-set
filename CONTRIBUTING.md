# Contributing

Issues and pull requests are welcome. Please never attach or commit `.Set` or `.Instrument` files,
or audio extracted from them: they're often paid packs from sound designers.

## Setup

Requires [Bun](https://bun.sh).

    git clone https://github.com/ohsabry/parse-org-set.git
    cd parse-org-set
    bun install

Run the CLI from the source, with paths relative to the repo folder:

    bun run inspect "my set.Set"
    bun run extract "my set.Set" [folder] [--simple] [--ascii]

## Checks

    bun run verify   # type check, lint, format check and tests
    bun run fmt      # format everything (Prettier)
    bun run lint:fix # fix what ESLint can

The web page also has browser tests, which build it and run it in Chromium, Firefox and WebKit
(Safari's engine) through Playwright. Install the browsers once, then run them:

    cd packages/web && bunx playwright install chromium firefox webkit && cd ../..
    bun run test:e2e

The unit tests use small fake files built in code. To also check the parser against a real file
you have locally:

    PARSE_ORG_SET_FILE="path/to/some.Set" bun test

## Layout

- `packages/core`: parsing and conversion, with no dependencies. Runs in Bun and browsers.
- `packages/cli`: the `parse-org-set` command, published to npm as `@parse-org-set/cli`.
- [`docs/format.md`](docs/format.md): what's known about the file formats.
