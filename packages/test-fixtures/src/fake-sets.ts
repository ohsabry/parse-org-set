/**
 * Fake .Set and .Instrument files covering every case the parser supports,
 * built in code (never committed: real .Set files are often paid packs). The
 * smoke checks and the browser tests run on all of them.
 *
 * They're built from our reading of the format, so they prove the code is
 * consistent, not that our reading is right; real files stay the ground truth.
 * `bun run fixtures <folder>` writes them to disk to try by hand.
 */
import { buildInstrumentFile, buildSet, type FakeInstrument, type FakeSample } from './build-set'

export interface FakeFile {
  name: string
  bytes: Uint8Array
  /** What parsing it must find, so a fake can't quietly lose what it's for. */
  expected: { instruments: number; samples: number; layers: number; poolEntries: number }
}

/** A sine wave at the root note's pitch: real-looking audio, which the alignment check needs. */
function tone(
  name: string,
  rootNote: number,
  options: { rate?: number; channels?: 1 | 2; seconds?: number; loop?: boolean } = {},
): FakeSample {
  const rate = options.rate ?? 44100
  const channels = options.channels ?? 1
  const frames = Math.round(rate * (options.seconds ?? 0.2))
  const hertz = 440 * 2 ** ((rootNote - 69) / 12)
  const audio = new Int16Array(frames * channels)
  for (let frame = 0; frame < frames; frame++) {
    const value = Math.round(8000 * Math.sin((2 * Math.PI * hertz * frame) / rate))
    for (let channel = 0; channel < channels; channel++) {
      audio[frame * channels + channel] = value
    }
  }
  const loop = options.loop === true ? { mode: 2, start: frames >> 2, end: frames - 1 } : undefined
  return { name, rootNote, rate, channels, audio, ...(loop === undefined ? {} : { loop }) }
}

// Long enough to hold the type byte (+124) and the envelope.
const SETTINGS = 133

/** Shots, as in real files: the metronome and a crash, typed as a drum kit. */
function shots(kind = 1): FakeInstrument {
  return {
    name: '-',
    kind,
    settingsLength: SETTINGS,
    samples: [tone('Metronome Long', 0), tone('Metronome Short', 1), tone('Syncro Crash', 12)],
  }
}

function melodic(
  name: string,
  roots: number[],
  options: Parameters<typeof tone>[2] = {},
): FakeInstrument {
  return {
    name,
    settingsLength: SETTINGS,
    samples: roots.map((root) => tone(`${name} ${root}`, root, { loop: true, ...options })),
  }
}

export function fakeFiles(): FakeFile[] {
  return [
    {
      name: 'Fake 1.3.1.Set',
      bytes: buildSet({
        version: '1.3.1',
        trailer: true,
        instruments: [
          shots(),
          {
            ...melodic('Oud', [48, 55, 62]),
            // 100 ms attack, 1,000 ms release, auto release on.
            envelope: { attack: 1, decay: 0, release: 10, autoRelease: true },
          },
          // An empty instrument (sample count 0), in the middle as in real files.
          { name: 'Empty', settingsLength: SETTINGS, samples: [] },
          melodic('كمنجة 🎻', [55, 67], { channels: 2 }),
          {
            name: 'GENERAL',
            kind: 1,
            settingsLength: SETTINGS,
            samples: [tone('36 Bass Drum', 36), tone('38 Snare', 38)],
          },
          // An audio phrase, named the way designers mark them.
          {
            name: 'Groove (Audio)',
            kind: 2,
            settingsLength: SETTINGS,
            samples: [tone('Groove 1', 60), tone('Groove 2', 61)],
          },
        ],
      }),
      expected: { instruments: 6, samples: 12, layers: 0, poolEntries: 0 },
    },
    {
      name: 'Fake 1.2.8 pool.Set',
      bytes: buildSet({
        version: '1.2.8',
        instruments: [
          shots(),
          {
            name: 'Strings',
            settingsLength: SETTINGS,
            // Two samples share pool entry 0; one has its audio inline.
            samples: [
              { ...tone('Strings 52', 52), poolId: 0 },
              { ...tone('Strings 52', 52), poolId: 0, rootNote: 53 },
              tone('Strings 64', 64),
            ],
          },
        ],
      }),
      expected: { instruments: 2, samples: 6, layers: 0, poolEntries: 1 },
    },
    {
      name: 'Fake 1.4.9 layers.Set',
      bytes: buildSet({
        version: '1.4.9',
        instruments: [
          shots(),
          {
            ...melodic('Alto Sax', [55, 60, 65]),
            // 1.4.x adds sustain: 500 ms decay to 90 %, then 700 ms release.
            envelope: { attack: 0, decay: 5, sustain: 90, release: 7, autoRelease: true },
          },
          // Two layers of the sax: headers with only a name.
          { name: 'Alto Sax p', bare: true, samples: [tone('Sax p 60', 60)] },
          { name: 'Sax Breath', bare: true, samples: [{ ...tone('Breath', 72), poolId: 3 }] },
        ],
      }),
      expected: { instruments: 2, samples: 8, layers: 2, poolEntries: 1 },
    },
    {
      name: 'Fake 1.10.Set',
      bytes: buildSet({
        version: '1.10',
        instruments: [
          // In the one real 1.10 set, Shots is only the metronome, typed melodic.
          { ...shots(0), samples: shots().samples.slice(0, 2) },
          {
            name: 'Piano (Stereo)',
            settingsLength: SETTINGS,
            samples: [
              { ...tone('PNO C3', 48, { rate: 22050, channels: 2 }), nameLeftovers: '   ' },
              { ...tone('NewSample_0000', 60, { rate: 32000 }), nameStyle: 'null-padded' },
            ],
          },
        ],
      }),
      expected: { instruments: 2, samples: 4, layers: 0, poolEntries: 0 },
    },
    {
      name: 'Fake 1.10.Instrument',
      bytes: buildInstrumentFile(
        {
          name: 'Kanoun MT',
          settingsLength: SETTINGS,
          samples: [
            { ...tone('KAN C2', 36, { rate: 16000 }), nameLeftovers: '  ' },
            tone('KAN G2', 43, { rate: 16000, loop: true }),
          ],
        },
        '1.10',
      ),
      expected: { instruments: 1, samples: 2, layers: 0, poolEntries: 0 },
    },
    {
      name: 'Fake 1.2.8.Instrument',
      bytes: buildInstrumentFile(melodic('Accordion A MT', [60, 64, 69]), '1.2.8'),
      expected: { instruments: 1, samples: 3, layers: 0, poolEntries: 0 },
    },
  ]
}
