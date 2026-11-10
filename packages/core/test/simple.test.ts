import { describe, expect, test } from 'bun:test'

import { parseSet, planSimpleExtraction, type Sample } from '../src/index'
import { pickMelodicSample } from '../src/simple'
import { buildSet, type FakeSample } from './helpers/build-set'

function root(rootNote: number): Sample {
  return {
    offset: 0,
    rootNote,
    name: `n${rootNote}`,
    sampleRate: 44100,
    channels: 1,
    frames: 1,
    loop: { mode: 0, start: 0, end: 0 },
    poolId: undefined,
    audioOffset: 0,
    audioLength: 2,
  }
}

describe('pickMelodicSample', () => {
  test('a C closest to middle C', () => {
    expect(pickMelodicSample([root(57), root(60), root(62)])?.rootNote).toBe(60)
    expect(pickMelodicSample([root(36), root(48), root(84)])?.rootNote).toBe(48)
  })

  test('any C beats a note closer to middle C', () => {
    expect(pickMelodicSample([root(59), root(72)])?.rootNote).toBe(72)
  })

  test('with no C, the note closest to middle C', () => {
    expect(pickMelodicSample([root(55), root(67)])?.rootNote).toBe(55)
    expect(pickMelodicSample([])).toBeUndefined()
  })
})

const tone = (name: string, rootNote: number, values: number[]): FakeSample => ({
  name,
  rootNote,
  rate: 44100,
  channels: 1,
  audio: Int16Array.from(values),
})

describe('planSimpleExtraction', () => {
  const bytes = buildSet({
    instruments: [
      // Shots is a drum kit; its last sound is an exact copy of its first.
      {
        name: '-',
        kind: 1,
        samples: [tone('click', 0, [1, 2]), tone('crash', 12, [3]), tone('again', 61, [1, 2])],
      },
      {
        name: 'Oud',
        kind: 0,
        samples: [tone('a', 57, [4]), tone('c', 60, [5]), tone('d', 62, [6])],
      },
      { name: 'Phrase', kind: 2, samples: [tone('0', 55, [7]), tone('1', 56, [8])] },
    ],
  })
  const plan = planSimpleExtraction('x.Set', bytes, parseSet(bytes))

  test('drums keep every distinct sound, melodic keeps one sample, audio is left out', () => {
    const paths: string[] = []
    for (const file of plan.files) {
      paths.push(file.path)
    }
    expect(paths).toEqual([
      'drums/01_Shots/001_C-1_click.wav',
      'drums/01_Shots/002_C0_crash.wav',
      'melodic/02_Oud_C4.wav',
    ])
  })

  test('different drum sounds of the same length are both kept', () => {
    const kit = buildSet({
      instruments: [
        { name: '-', kind: 1, samples: [tone('a', 36, [1, 2]), tone('b', 37, [2, 1])] },
      ],
    })
    expect(planSimpleExtraction('x.Set', kit, parseSet(kit)).files.length).toBe(2)
  })

  test("a drum kit's layers are exported with the kit", () => {
    const kit = buildSet({
      instruments: [
        { name: '-', kind: 1, samples: [tone('kick', 36, [1])] },
        { name: 'Breath', bare: true, samples: [tone('breath', 37, [2])] },
      ],
    })
    const paths: string[] = []
    for (const file of planSimpleExtraction('x.Set', kit, parseSet(kit)).files) {
      paths.push(file.path)
    }
    expect(paths).toEqual(['drums/01_Shots/001_C2_kick.wav', 'drums/01_Shots/002_C#2_breath.wav'])
  })

  test('the index keeps the original names', () => {
    expect(plan.index.instruments[1]).toMatchObject({ folder: 'melodic', name: 'Oud' })
    expect(plan.index.instruments[1]?.samples[0]?.name).toBe('c')
  })
})
