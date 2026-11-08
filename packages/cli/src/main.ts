#!/usr/bin/env bun
import { SetFormatError, parseSet } from '@parse-org-set/core'

import { formatSummary } from './summary'

const USAGE = 'Usage: parse-org-set inspect <file.Set>'

/** Runs the command line and returns the exit code: 0 on success, 1 on any error. */
async function main(args: string[]): Promise<number> {
  const [command, path, ...extra] = args
  if (command !== 'inspect' || path === undefined || extra.length > 0) {
    console.error(USAGE)
    return 1
  }

  const file = Bun.file(path)
  if (!(await file.exists())) {
    console.error(`No such file: ${path}`)
    return 1
  }

  let bytes: Uint8Array
  try {
    bytes = await file.bytes()
  } catch (error) {
    console.error(
      `Couldn't read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return 1
  }

  try {
    const fileName = path.split('/').pop() ?? path
    console.log(formatSummary(fileName, parseSet(bytes)))
    return 0
  } catch (error) {
    // Expected problems with the file get a one-line message; anything else
    // is a bug, so let it crash with a stack trace.
    if (error instanceof SetFormatError) {
      console.error(`${path}: ${error.message}`)
      return 1
    }
    throw error
  }
}

process.exitCode = await main(process.argv.slice(2))
