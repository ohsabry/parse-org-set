# parse-org-set

Extract the sounds inside [ORG 24](https://sofeh.com) `.Set` files as WAV files.

## Development

Requires [Bun](https://bun.sh).

    bun install
    bun run fmt   # format everything (Prettier)
    bun run lint  # check the code (ESLint)

## How this is built

The code is written by AI coding agents (Claude Code), working from my
requirements and reviewed by me before each commit. The `.Set` format is
reverse-engineered from a single file, so expect wrong results on other
sets and check the output. Audit it and exercise independent human
judgment before trusting it with important data or decisions.

## License

MIT. Not affiliated with Sofeh Sunrise or ORG 24.
