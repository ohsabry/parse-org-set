/**
 * Real bytes from a .Set file saved by the ORG 24 app with its own default
 * content (no paid packs): sample headers (metadata only, no audio) and the
 * start of the file header. Where a fixture is edited, the comment says how.
 */

export function hex(text: string): Uint8Array {
  const pairs = text.match(/../g) ?? []
  return Uint8Array.from(pairs, (pair) => parseInt(pair, 16))
}

/** 97-byte sample headers. */
export const SAMPLE_HEADERS = {
  // App default set. Mono, 48 kHz, 17,800 frames (0.37 s), no loop.
  metronomeLong: hex(
    '00204d6574726f6e6f6d65204c6f6e67000000000000000000000000000000000080bb100180bb00000000000088450000000000006400000000000000000000004f00000000000000000000008745000000000000000000000000000000000000',
  ),
  // App default set. Stereo, 44.1 kHz, 114,980 frames, root note 28 (E1).
  kel: hex(
    '1c204b656c0000000000000000000000000000000000000000000000000000000044ac100244ac00000000000024c101000000000064000000000000000000000000000000000000000000000023c1010000000000000000000000000000000000',
  ),
  // App default set (a piano). Mono, 44.1 kHz, loop mode 2 from frame 69,090 to 89,636.
  xpFSharp2: hex(
    '2a2058502d4623320000000000000000000000000000000000000000000000000044ac100144ac00004c0a0000255e0100000000006400000000000000000000000000000002000000e20d0100245e010000000000000000000000000000000000',
  ),
  // Metronome Long with its rate fields edited to 152,174 Hz (no default sound goes
  // above 65,535 Hz). R+33 holds the low 16 bits (21,102), R+37 the full rate.
  highRate: hex(
    '00204d6574726f6e6f6d65204c6f6e6700000000000000000000000000000000006e5210016e5202000000000088450000000000006400000000000000000000004f00000000000000000000008745000000000000000000000000000000000000',
  ),
}

/** The first 48 bytes of a file: title, version length, version text. */
export const FILE_STARTS = {
  // The 1.4.9 start below with the title in lowercase and the version text set to
  // "\r1.3.1\r" (length 7), which is how every 1.3.1 file starts.
  v131: hex(
    '4d757369632053747564696f206d757369630000000000000000000000000000070000000d312e332e310dffff000000',
  ),
  // As saved by the app.
  v149: hex(
    '4d757369632053747564696f204d757369630000000000000000000000000000060000000d312e342e39ffff00000000',
  ),
}
