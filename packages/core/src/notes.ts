const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/**
 * The name of a MIDI note number, using the common convention where 60 is
 * middle C ("C4"): 12 notes per octave, and octave −1 starts at note 0.
 */
export function noteName(midi: number): string {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
    throw new RangeError(`MIDI notes go from 0 to 127, got ${midi}`)
  }
  const octave = Math.floor(midi / 12) - 1
  return `${NAMES[midi % 12] ?? ''}${octave}`
}

/**
 * A note name for file names and summaries. A sample's root note is one byte,
 * so it can be 128–255 (no real file has one); those become "note200" instead
 * of throwing.
 */
export function noteLabel(midi: number): string {
  return Number.isInteger(midi) && midi >= 0 && midi <= 127 ? noteName(midi) : `note${midi}`
}

/**
 * How an instrument's root notes are spread across the keyboard, from the
 * steps between neighbouring notes: "every semitone" or "every 7" when all
 * steps are equal; "mostly every semitone (1–2)" when one step makes up more
 * than half of them; otherwise the range, "every 6–24"; or "one sample".
 * Root notes that appear more than once are counted as repeats.
 */
export function describeSpacing(rootNotes: number[]): string {
  if (rootNotes.length === 0) {
    return 'no samples'
  }
  const unique = [...new Set(rootNotes)].sort((a, b) => a - b)
  const repeats = rootNotes.length - unique.length

  let spacing: string
  if (unique.length === 1) {
    spacing = rootNotes.length === 1 ? 'one sample' : 'one note'
  } else {
    // Count how often each step (gap between neighbouring notes) occurs.
    const stepCounts = new Map<number, number>()
    let previous: number | undefined
    for (const note of unique) {
      if (previous !== undefined) {
        const step = note - previous
        stepCounts.set(step, (stepCounts.get(step) ?? 0) + 1)
      }
      previous = note
    }

    let smallest = Infinity
    let largest = 0
    let mostCommon = 0
    let mostCommonCount = 0
    for (const [step, timesSeen] of stepCounts) {
      smallest = Math.min(smallest, step)
      largest = Math.max(largest, step)
      if (timesSeen > mostCommonCount) {
        mostCommon = step
        mostCommonCount = timesSeen
      }
    }

    const steps = unique.length - 1
    if (smallest === largest) {
      spacing = every(smallest)
    } else if (mostCommonCount * 2 > steps) {
      // Only say "mostly" when one step makes up more than half of them.
      spacing = `mostly ${every(mostCommon)} (${smallest}–${largest})`
    } else {
      spacing = `every ${smallest}–${largest}`
    }
  }

  if (repeats === 0) {
    return spacing
  }
  return `${spacing}, ${repeats} repeat${repeats === 1 ? '' : 's'}`
}

function every(step: number): string {
  return step === 1 ? 'every semitone' : `every ${step}`
}
