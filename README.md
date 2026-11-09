# parse-org-set

Extract the sounds inside [ORG 24](https://sofeh.com) `.Set` and `.Instrument` files as WAV files. Works with files saved by versions 1.10 and 1.2.x to 1.4.x of the app.

## Usage

Requires [Bun](https://bun.sh). Run it straight from npm:

    bunx parse-org-set inspect "my set.Set"
    bunx parse-org-set extract "my set.Set" [folder] [--simple] [--ascii]

Or clone the repo and run it from there, with paths relative to the repo folder:

    git clone https://github.com/ohsabry/parse-org-set.git
    cd parse-org-set
    bun install
    bun run inspect "my set.Set"
    bun run extract "my set.Set" [folder] [--simple] [--ascii]

Both commands also take a single-instrument `.Instrument` file in place of a `.Set`.

Would you rather not install Bun? If a precompiled binary (through Homebrew or similar) would
help, [open an issue](https://github.com/ohsabry/parse-org-set/issues) and I'm happy to make one.

**`inspect`** prints a summary: the version, the number of instruments and samples, and one row
per instrument with its sample count, note range, how its notes are spaced, its total length and
its name.

**`extract`** writes every sample as a WAV file, one folder per instrument (the first is
`Shots`), with each instrument's extra layers in subfolders. `index.json` lists every file with
its original name, root note, sample rate, length and loop points.

- `folder` defaults to `<set name>_samples` (or `<set name>_simple` with `--simple`). It must be
  new or empty, so nothing is ever overwritten.
- `--simple` writes fewer files: one sample per melodic instrument in `melodic/` (a C close to
  middle C where there is one), and every distinct drum sound in `drums/<kit>/`. Audio phrase
  instruments are left out.
- `--ascii` uses only ASCII in folder and file names; Arabic is written in the Arabic chat
  alphabet (ع → 3, ح → 7). `index.json` always keeps the original names.

File names include each sample's root note, with middle C (MIDI note 60) written `C4`.

## Development

    bun run verify   # type check, lint, format check and tests
    bun run fmt      # format everything (Prettier)
    bun run lint:fix # fix what ESLint can

To also check the parser against a real set (which can't be committed):

    PARSE_ORG_SET_FILE="path/to/some.Set" bun test

## Layouts

What's confirmed about the `.Set` format, from real files saved by versions 1.2.8, 1.3.0, 1.3.1
and 1.4.9. All numbers are little-endian. Bytes not listed here aren't decoded yet.

### File structure

    [file header, including the sample pool][instrument][instrument] … [trailer]

    instrument = [instrument header][samples…] then any [layer header][samples…]

Every instrument starts with an instrument header, followed by its samples. An instrument can
have extra **layers** (for example soft playing, growl, or a breath noise), each with a short
header and its own samples. We call the first instrument **Shots**. The trailer after the last
sample isn't decoded.

### .Instrument files

An `.Instrument` file holds a single instrument, laid out exactly as inside a `.Set`:

    [title][instrument header][samples…]

| Part       | Type   | Meaning                                                                  |
| ---------- | ------ | ------------------------------------------------------------------------ |
| Title      | 28 B   | Null-padded `Music Studio Instrument`                                    |
| (unknown)  | 4 B    | `40 5c 4f 06` in 1.10 files, zeros in 1.2.8 ones                         |
| Instrument | varies | An instrument header (below) then its samples, up to the end of the file |

There's no file header, sample pool or trailer: the version is the one in the instrument
header's text (`Oud\r1.10\r`), and the last sample's audio ends the file.

### File header

| Part             | Type   | Meaning                                                                       |
| ---------------- | ------ | ----------------------------------------------------------------------------- |
| Title            | 32 B   | Null-padded `Music Studio music` (some files write `Music`)                   |
| Version length   | uint32 | Length of the version text                                                    |
| Version          | text   | `\r1.3.1\r` in 1.10 to 1.3.x; `\r1.4.9` (no trailing `\r`) in 1.4.x           |
| (unknown)        | 16 B   | Starts with `ff ff`                                                           |
| Text field       | uint32 | Number of characters that follow: 1 byte each before 1.4, 2 bytes each in 1.4 |
| (unknown)        | 134 B  |                                                                               |
| Sample pool      | varies | See below. Most files without one have a count of 0 here                      |
| (unknown)        | varies | Starts with the uint32 100                                                    |
| Version again    | text   | The version length and text again, then `ff ff 00 00`                         |
| Instrument count | uint32 | Number of instruments (layers aren't counted)                                 |

The first instrument header starts right after the instrument count.

### Sample pool

Some files keep audio in a shared pool, so several samples can use one recording.

| Part        | Type   | Meaning                         |
| ----------- | ------ | ------------------------------- |
| Entry count | uint32 | Number of entries               |
| Each entry: |        |                                 |
| ID          | uint32 | Increasing from entry to entry  |
| Size        | uint32 | In bytes                        |
| Audio       | bytes  | 16-bit signed PCM, `size` bytes |

A sample whose R+41 (below) is N uses the entry with ID N − 1.

### Instrument header (variable length)

| Part           | Type   | Meaning                                                                         |
| -------------- | ------ | ------------------------------------------------------------------------------- |
| Text length    | uint32 | Length of the text that follows                                                 |
| Text           | UTF-8  | Name, then the version that saved it, as in the file header (`-` = no name)     |
| (unknown)      | 5 B    | An int32 that is 0 or −1, then one byte                                         |
| Root-note list | bytes  | 1.3.x: root notes of the samples that follow, one byte each, at most 51 entries |
| (unknown)      | varies | Not decoded, except the instrument type (below)                                 |
| Envelope       | 6 B    | See below                                                                       |
| Sample count   | uint8  | Number of samples that follow (the header's last byte); can be 0                |

The byte 124 bytes after the end of the text is the **instrument type**: 0 = melodic,
1 = drum kit, 2 = audio phrase. The first instrument (Shots) is a drum kit.

The envelope's six bytes, with attack, decay and release in 100 ms steps (0–100, up to 10 s):

| Version      | Bytes                                                                      |
| ------------ | -------------------------------------------------------------------------- |
| 1.2.x, 1.3.x | attack, decay, release, (unknown), auto release (0 off, 1 on), (unknown)   |
| 1.4.x        | attack, decay, sustain (%), release, (unknown), auto release (0 off, 1 on) |

In 1.3.x, instruments with more than 51 samples list only the first 51 root notes.

### Layer header

| Part         | Type   | Meaning                                                |
| ------------ | ------ | ------------------------------------------------------ |
| Text length  | uint32 | Length of the name                                     |
| Name         | UTF-8  | Only a name, with no `\r` and version                  |
| (unknown)    | varies | A few bytes                                            |
| Sample count | uint8  | Number of samples that follow (the header's last byte) |

A layer belongs to the instrument before it.

### Sample (97 bytes, then the audio unless it's in the pool)

| Offset | Type   | Meaning                                                                                       |
| ------ | ------ | --------------------------------------------------------------------------------------------- |
| R+0    | uint8  | Root note, as a MIDI note number (60 = middle C)                                              |
| R+1    | uint8  | `0x20`. In 1.10: the name's length in bytes, or `0x20` for a null-padded name                 |
| R+2    | 31 B   | Name, UTF-8, null-padded (can fill all 31 bytes); in 1.10 bytes past the length are leftovers |
| R+33   | uint16 | Sample rate, low 16 bits only                                                                 |
| R+35   | uint8  | Bits per sample (always 16)                                                                   |
| R+36   | uint8  | Channels (1 or 2)                                                                             |
| R+37   | uint32 | Sample rate, full value (can exceed 65,535). Always 0 in 1.10, which uses R+33                |
| R+41   | uint32 | Pool reference: 0 = the audio follows at R+97; N = the audio is pool entry N − 1              |
| R+45   | uint32 | Frame count                                                                                   |
| R+69   | uint32 | Loop mode (values 0–3 seen)                                                                   |
| R+73   | uint32 | Loop start frame                                                                              |
| R+77   | uint32 | Loop end frame (always at most frames − 1)                                                    |
| R+97   | bytes  | Audio: 16-bit signed PCM, interleaved if stereo, `frames × channels × 2` bytes                |

The next sample (or header) starts right after the audio, or right after the 97-byte header if
the audio is in the pool.

## How this is built

The code is written by AI coding agents (Claude Code), working from my
requirements and reviewed by me before each commit. The `.Set` format is
reverse-engineered from only a few files, so expect wrong results on other
sets and check the output. Audit it and exercise independent human
judgment before trusting it with important data or decisions.

## License

MIT. Not affiliated with Sofeh Sunrise or ORG 24.
