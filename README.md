# parse-org-set

Turns the sounds inside [ORG 24](https://sofeh.com) `.Set` and `.Instrument` files into WAV files
you can load into any sampler or DAW. Reads files saved by versions 1.10 and 1.2.x to 1.4.x of
the app.

## Install

Requires [Bun](https://bun.sh).

    bun add -g @parse-org-set/cli

If your shell can't find `parse-org-set` afterwards, add `~/.bun/bin` to your `PATH`. To try it
once without installing:

    bunx -p @parse-org-set/cli parse-org-set inspect "my set.Set"

Would you rather not install Bun? If a ready-made binary (through Homebrew or similar) would help,
[open an issue](https://github.com/ohsabry/parse-org-set/issues) and I'm happy to make one.

## Usage

    parse-org-set inspect "my set.Set"
    parse-org-set extract "my set.Set" [folder] [--simple] [--ascii]

Both work the same on an `.Instrument` file.

**`inspect`** prints the version and one row per instrument: its number of samples, note range,
how its notes are spaced, total length and name.

**`extract`** writes every sample as a WAV file, one folder per instrument, plus `index.json`
with every original name, root note, sample rate, length and loop point. For example,
`parse-org-set extract "السيت المجاني كل الاصوات .Set"` writes:

    السيت_المجاني_كل_الاصوات_samples/
      index.json
      001_Shots/
        001_C-1_Metronome_Long.wav
        002_C#-1_Metronome_Short.wav
      007_General/
        001_A#1_36_Bass_Drum_1.wav
        002_B1_35_Acoustic_Bass_Drum.wav
      014_إسترينج_ياماها_🎼/
        001_G#2_MS000001.KSF_2.wav
      …

File names start with the sample's root note; middle C (MIDI note 60) is `C4`. The first group
in a set is the app's **Shots**, usually a metronome, a crash and the designer's shouts and
effects.

| Option     | What it does                                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `folder`   | Where to write. Defaults to `<set name>_samples` (or `_simple`). Must be new or empty, so nothing is overwritten.                                                                               |
| `--simple` | Fewer files: one sample per melodic instrument in `melodic/` (a C near middle C where there is one) and every distinct drum sound in `drums/<kit>/`. Audio phrases are left out.                |
| `--ascii`  | Only ASCII in folder and file names; Arabic is written in the Arabic chat alphabet (ع → 3, ح → 7): `014_إسترينج_ياماها_🎼` becomes `014_estring_iamaha`. `index.json` keeps the original names. |

## More

- [The file formats](https://github.com/ohsabry/parse-org-set/blob/main/docs/format.md): what's
  known about `.Set` and `.Instrument` files, byte by byte.
- [Contributing](https://github.com/ohsabry/parse-org-set/blob/main/CONTRIBUTING.md): running it
  from source, and the checks.

## How this is built

The code is written by AI coding agents (Claude Code), working from my requirements, and I review
it before each commit. The `.Set` format was worked out from a handful of files, so other sets may
not come out right: check the sounds you get before relying on them.

## License

MIT. Not affiliated with Sofeh Sunrise or ORG 24.
