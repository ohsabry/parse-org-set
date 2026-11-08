# parse-org-set

Extract the sounds inside [ORG 24](https://sofeh.com) `.Set` files as WAV files.

## Development

Requires [Bun](https://bun.sh).

    bun install
    bun run fmt   # format everything (Prettier)
    bun run lint  # check the code (ESLint)

## Layouts

What's confirmed about the `.Set` format, for version 1.3.x. All numbers are little-endian. Bytes
not listed here aren't decoded yet.

### File structure

    [file header][instrument header][records…][instrument header][records…] … [trailer]

Every instrument starts with an instrument header, followed by its sample records. We call the
first instrument **Shots**. The trailer after the last record isn't decoded.

### File header (bytes 0–484)

| Offset | Type   | Meaning                                        |
| ------ | ------ | ---------------------------------------------- |
| 0      | 32 B   | Title, null-padded: `Music Studio music`       |
| 32     | uint32 | Length of the version text                     |
| 36     | text   | Version, for example `\r1.3.1\r`, then `ff ff` |

The first instrument header starts at byte 485.

### Instrument header (variable length)

| Part           | Type   | Meaning                                                                  |
| -------------- | ------ | ------------------------------------------------------------------------ |
| Text length    | uint32 | Length of the text that follows                                          |
| Text           | UTF-8  | Name, then `\r` and the version that saved it (`-` = no name)            |
| (unknown)      | 5 B    | An int32 that is 0 or −1, then one byte                                  |
| Root-note list | bytes  | Root notes of the records that follow, one byte each, at most 51 entries |
| (unknown)      | varies | Not decoded                                                              |
| Record count   | uint8  | Number of records that follow (the header's last byte)                   |

Instruments with more than 51 records list only the first 51 root notes. One real instrument
header has only the name, 3 bytes and the count.

### Sample record (97 bytes + audio)

| Offset | Type   | Meaning                                                                  |
| ------ | ------ | ------------------------------------------------------------------------ |
| R+0    | uint8  | Root note, as a MIDI note number (60 = middle C)                         |
| R+1    | uint8  | Always `0x20`                                                            |
| R+2    | 31 B   | Name, UTF-8, null-padded (can fill all 31 bytes)                         |
| R+33   | uint16 | Sample rate, low 16 bits only                                            |
| R+35   | uint8  | Bits per sample (always 16)                                              |
| R+36   | uint8  | Channels (1 or 2)                                                        |
| R+37   | uint32 | Sample rate, full value (can exceed 65,535)                              |
| R+45   | uint32 | Frame count                                                              |
| R+69   | uint32 | Loop mode (values 0–3 seen)                                              |
| R+73   | uint32 | Loop start frame                                                         |
| R+77   | uint32 | Loop end frame (always at most frames − 1)                               |
| R+97   | bytes  | Audio: 16-bit signed PCM, interleaved if stereo, `frames × channels × 2` |

The next record (or instrument header) starts right after the audio, with no gap.

## How this is built

The code is written by AI coding agents (Claude Code), working from my
requirements and reviewed by me before each commit. The `.Set` format is
reverse-engineered from only a few files, so expect wrong results on other
sets and check the output. Audit it and exercise independent human
judgment before trusting it with important data or decisions.

## License

MIT. Not affiliated with Sofeh Sunrise or ORG 24.
