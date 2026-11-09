import type { Sample } from './types'

/** The total length of `samples` in seconds. */
export function totalSeconds(samples: Sample[]): number {
  let seconds = 0
  for (const sample of samples) {
    seconds += sample.frames / sample.sampleRate
  }
  return seconds
}

/** For example "0.4 s", "38 s", "2 min 7 s" or "1 h 2 min". */
export function formatDuration(seconds: number): string {
  if (seconds < 10) {
    return `${seconds.toFixed(1)} s`
  }
  const whole = Math.round(seconds)
  if (whole < 60) {
    return `${whole} s`
  }
  if (whole < 3600) {
    return `${Math.floor(whole / 60)} min ${whole % 60} s`
  }
  return `${Math.floor(whole / 3600)} h ${Math.floor((whole % 3600) / 60)} min`
}
