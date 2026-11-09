/** The canonical WAV header (RIFF + fmt + data chunk headers) is 44 bytes. */
const HEADER_LENGTH = 44

export interface WavAudio {
  /** In Hz. */
  sampleRate: number
  channels: 1 | 2
  /** 16-bit signed little-endian PCM, interleaved L R … if stereo. */
  audio: Uint8Array
}

/**
 * Wraps 16-bit PCM audio in a WAV file. The audio bytes are copied as they are:
 * .Set files and WAV files both store 16-bit little-endian PCM.
 *
 * Layout (all numbers little-endian):
 *
 *   0  "RIFF"            the container format
 *   4  uint32            size of everything after this field: 36 + audio length
 *   8  "WAVE"            what the container holds
 *  12  "fmt "            start of the format chunk (note the space)
 *  16  uint32 16         size of the format chunk's body
 *  20  uint16 1          audio format 1 = uncompressed PCM
 *  22  uint16            channels
 *  24  uint32            sample rate (frames per second)
 *  28  uint32            byte rate = sample rate × block align
 *  32  uint16            block align = bytes per frame = channels × 2
 *  34  uint16 16         bits per sample
 *  36  "data"            start of the data chunk
 *  40  uint32            audio length in bytes
 *  44  …                 the audio
 */
export function encodeWav({ sampleRate, channels, audio }: WavAudio): Uint8Array {
  const out = new Uint8Array(HEADER_LENGTH + audio.length)
  out.set(wavHeader({ sampleRate, channels, audioLength: audio.length }))
  out.set(audio, HEADER_LENGTH)
  return out
}

/**
 * Just the 44-byte header (layout above) for `audioLength` bytes of audio.
 * Writing the header and then the audio as it is gives the same bytes as
 * encodeWav, without first copying the audio into one new array, which
 * matters when a whole set's audio is being zipped.
 */
export function wavHeader({
  sampleRate,
  channels,
  audioLength,
}: Omit<WavAudio, 'audio'> & { audioLength: number }): Uint8Array {
  const blockAlign = channels * 2
  if (audioLength % blockAlign !== 0) {
    throw new RangeError(
      `Audio must be whole frames: ${audioLength} bytes isn't a multiple of ${blockAlign}`,
    )
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`Sample rate must be a positive whole number, got ${sampleRate}`)
  }

  const out = new Uint8Array(HEADER_LENGTH)
  const view = new DataView(out.buffer)
  writeAscii(out, 0, 'RIFF')
  view.setUint32(4, HEADER_LENGTH - 8 + audioLength, true)
  writeAscii(out, 8, 'WAVE')

  writeAscii(out, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)

  writeAscii(out, 36, 'data')
  view.setUint32(40, audioLength, true)
  return out
}

function writeAscii(out: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    out[offset + i] = text.charCodeAt(i)
  }
}
