/**
 * Browser tests of the built page (packages/web/dist), in Chromium, Firefox
 * and WebKit (Safari's engine), so the security policy, the worker build and
 * the minified code are all exercised. Run with `bun run test:e2e`, which
 * builds the page first; plain `bun test` skips this file (it isn't named
 * *.test.ts), so it doesn't need browsers.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from 'playwright'

import { buildSet, type FakeSample } from '../../core/test/helpers/build-set'

const dist = join(import.meta.dir, '../dist')
const server = Bun.serve({
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname
    return new Response(Bun.file(join(dist, path === '/' ? 'index.html' : path)))
  },
})

const silence = (name: string, rootNote: number, frames: number): FakeSample => ({
  name,
  rootNote,
  rate: 44100,
  channels: 1,
  audio: new Int16Array(frames),
})

const dir = mkdtempSync(join(tmpdir(), 'parse-org-set-e2e-'))
const setPath = join(dir, 'Test.Set')
writeFileSync(
  setPath,
  buildSet({
    instruments: [
      { name: '-', samples: [silence('Metronome', 0, 4410)] },
      // A hostile name: it must show as text, never become an element.
      { name: '<img src=x onerror=alert(1)>', samples: [silence('a', 60, 44100)] },
    ],
  }),
)
const notSetPath = join(dir, 'notes.txt')
writeFileSync(notSetPath, 'These are my notes, not an ORG 24 file of any kind.')

afterAll(() => {
  void server.stop()
  rmSync(dir, { recursive: true, force: true })
})

/** Opens the page and records anything that would mean something broke. */
async function openPage(browser: Browser): Promise<{ page: Page; problems: string[] }> {
  const page = await browser.newPage()
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(message.text())
    }
  })
  page.on('pageerror', (error) => problems.push(error.message))
  page.on('dialog', (dialog) => {
    problems.push(`dialog: ${dialog.message()}`)
    void dialog.dismiss()
  })
  await page.goto(server.url.href)
  return { page, problems }
}

const browsers: [string, BrowserType][] = [
  ['Chromium', chromium],
  ['Firefox', firefox],
  ['WebKit', webkit],
]

for (const [name, type] of browsers) {
  describe(name, () => {
    let browser: Browser
    beforeAll(async () => {
      browser = await type.launch()
    })
    afterAll(async () => {
      await browser.close()
    })

    test('opens a set and shows its summary, with no errors', async () => {
      const { page, problems } = await openPage(browser)
      await page.setInputFiles('input[type=file]', setPath)
      await page.locator('#result').waitFor({ state: 'visible', timeout: 5000 })

      expect(await page.locator('#file-name').textContent()).toBe('Test.Set')
      expect(await page.locator('#overview').textContent()).toBe(
        'Version 1.3.1 · 2 instruments · 2 samples · 1.1 s of audio',
      )
      const rows = await page
        .locator('#instruments tr')
        .evaluateAll((trs) =>
          trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)),
        )
      expect(rows).toEqual([
        ['1', '1', 'C-1', 'one sample', '0.1 s', 'Shots'],
        ['2', '1', 'C4', 'one sample', '1.0 s', '<img src=x onerror=alert(1)>'],
      ])
      expect(await page.locator('#result img').count()).toBe(0)
      expect(problems).toEqual([])
    })

    test('says why a file is not a set', async () => {
      const { page, problems } = await openPage(browser)
      await page.setInputFiles('input[type=file]', notSetPath)
      await page.locator('#status.error').waitFor({ timeout: 5000 })

      expect(await page.locator('#status').textContent()).toStartWith(
        "Couldn't read notes.txt: Not a .Set or .Instrument file",
      )
      expect(await page.locator('#result').isHidden()).toBe(true)
      expect(problems).toEqual([])
    })
  })
}
