#!/usr/bin/env bun
import { SetFormatError, defaultOutputFolder, parseSet, type SetFile } from '@parse-org-set/core'

import { ExtractError } from './errors/extract-error'
import { writeExtraction } from './extract'
import { formatSummary } from './summary'

const USAGE = `Usage:
  parse-org-set inspect <file.Set>
  parse-org-set extract <file.Set> [folder] [--ascii]

  folder   defaults to <set name>_samples
  --ascii  use only ASCII in folder and file names (Arabic uses the Arabic chat alphabet)`

/** Runs the command line and returns the exit code: 0 on success, 1 on any error. */
async function main(args: string[]): Promise<number> {
  // --ascii can go anywhere; everything else is positional.
  const ascii = args.includes('--ascii')
  const positional: string[] = []
  for (const arg of args) {
    if (arg !== '--ascii') {
      positional.push(arg)
    }
  }
  const [command, path, folder, ...extra] = positional
  const valid =
    path !== undefined &&
    extra.length === 0 &&
    !positional.some((arg) => arg.startsWith('--')) &&
    ((command === 'inspect' && folder === undefined && !ascii) || command === 'extract')
  if (!valid) {
    console.error(USAGE)
    return 1
  }

  const loaded = await loadSet(path)
  if (loaded === undefined) {
    return 1
  }
  const { bytes, set, fileName } = loaded

  if (command === 'inspect') {
    console.log(formatSummary(fileName, set))
    return 0
  }

  const target = folder ?? defaultOutputFolder(fileName, { ascii })
  try {
    const written = writeExtraction(bytes, fileName, set, target, { ascii })
    console.log(
      `Wrote ${written.files.toLocaleString('en-US')} WAV files in ${written.folders} folders to ${target}/`,
    )
    return 0
  } catch (error) {
    if (error instanceof ExtractError) {
      console.error(error.message)
      return 1
    }
    throw error
  }
}

/**
 * Reads and parses a .Set file. Prints a one-line error and returns undefined
 * if the file is missing, unreadable or not a supported .Set.
 */
async function loadSet(
  path: string,
): Promise<{ bytes: Uint8Array; set: SetFile; fileName: string } | undefined> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    console.error(`No such file: ${path}`)
    return undefined
  }

  let bytes: Uint8Array
  try {
    bytes = await file.bytes()
  } catch (error) {
    console.error(
      `Couldn't read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return undefined
  }

  try {
    return { bytes, set: parseSet(bytes), fileName: path.split('/').pop() ?? path }
  } catch (error) {
    // Expected problems with the file get a one-line message; anything else
    // is a bug, so let it crash with a stack trace.
    if (error instanceof SetFormatError) {
      console.error(`${path}: ${error.message}`)
      return undefined
    }
    throw error
  }
}

process.exitCode = await main(process.argv.slice(2))
