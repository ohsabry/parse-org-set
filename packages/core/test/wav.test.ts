import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { encodeWav } from '../src/index'
import { hex } from './fixtures/real-bytes'

describe('encodeWav', () => {
  test('writes the standard 44-byte header: 1 second of mono 44.1 kHz audio', () => {
    // Worked out by hand from the WAV format's field definitions:
    // data size 88,200 = 0x015888, RIFF size 36 + 88,200 = 88,236 = 0x0158AC,
    // byte rate 44,100 × 2 = 88,200, block align 2.
    const expected = hex(
      '52494646' + // "RIFF"
        'ac580100' + // 88,236
        '57415645' + // "WAVE"
        '666d7420' + // "fmt "
        '10000000' + // 16
        '0100' + // PCM
        '0100' + // 1 channel
        '44ac0000' + // 44,100 Hz
        '88580100' + // 88,200 bytes per second
        '0200' + // 2 bytes per frame
        '1000' + // 16 bits
        '64617461' + // "data"
        '88580100', // 88,200 bytes of audio
    )
    const wav = encodeWav({ sampleRate: 44100, channels: 1, audio: new Uint8Array(88200) })
    expect(Array.from(wav.subarray(0, 44))).toEqual(Array.from(expected))
    expect(wav.length).toBe(44 + 88200)
  })

  test('stereo doubles the bytes per frame and per second', () => {
    const wav = encodeWav({ sampleRate: 48000, channels: 2, audio: new Uint8Array(8) })
    const view = new DataView(wav.buffer)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(28, true)).toBe(192000) // 48,000 × 4
    expect(view.getUint16(32, true)).toBe(4)
  })

  test('copies the audio bytes unchanged after the header', () => {
    const audio = Uint8Array.from([0xe8, 0x03, 0xfe, 0xff]) // 1000, then −2
    expect(Array.from(encodeWav({ sampleRate: 8000, channels: 1, audio }).subarray(44))).toEqual(
      Array.from(audio),
    )
  })

  test('rejects audio that is not whole frames', () => {
    expect(() => encodeWav({ sampleRate: 44100, channels: 2, audio: new Uint8Array(6) })).toThrow(
      'whole frames',
    )
  })
})

// A check outside our code: macOS's own audio tool must read the file back.
const afinfo = Bun.which('afinfo')

describe.skipIf(afinfo === null)('afinfo reads what encodeWav writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parse-org-set-wav-'))
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('stereo 48 kHz, 0.5 seconds', () => {
    const path = join(dir, 'test.wav')
    writeFileSync(path, encodeWav({ sampleRate: 48000, channels: 2, audio: new Uint8Array(96000) }))
    const output = Bun.spawnSync({ cmd: [afinfo ?? 'afinfo', path] }).stdout.toString()
    expect(output).toContain('Data format:     2 ch,  48000 Hz, Int16, interleaved')
    expect(output).toContain('estimated duration: 0.500000 sec')
    expect(output).toContain('audio bytes: 96000')
    expect(output).toContain('audio data file offset: 44') // the audio starts after our header
  })
})
