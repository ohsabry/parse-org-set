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

Run the web page locally at http://127.0.0.1:3000 (it reloads when you save), or build the finished
site into `packages/web/dist`:

    bun run web
    bun run web:build

[`docs/web-architecture.md`](docs/web-architecture.md) explains how the page works.

## Checks

    bun run verify   # type check, lint, format check and tests
    bun run fmt      # format everything (Prettier)
    bun run lint:fix # fix what ESLint can

The web page also has browser tests, which build it and run it in Chromium, Firefox and WebKit
(Safari's engine) through Playwright. Install the browsers once, then run them:

    bun run e2e:install
    bun run test:e2e

The tests use fake files built in code (`packages/test-fixtures/src/fake-sets.ts`): one per
version and case the parser supports. The smoke checks and the browser tests run on all of them.
To try them by hand, write them to a folder outside the repo:

    bun run fixtures ~/Desktop/fake-sets

The fakes are built from our reading of the format, so they can't tell us that reading is wrong;
only real files can. To run the smoke checks on a real file you have locally:

    PARSE_ORG_SET_FILE="path/to/some.Set" bun test

## Layout

- `packages/core`: parsing and conversion, with no dependencies. Runs in Bun and browsers.
- `packages/cli`: the `parse-org-set` command, published to npm as `@parse-org-set/cli`.
- `packages/web`: the web page; [`docs/web-architecture.md`](docs/web-architecture.md) explains how it works.
- `packages/test-fixtures`: the fake files every package's tests use (never published).
- [`docs/format.md`](docs/format.md): what's known about the file formats.
