import { describe, expect, test } from 'bun:test'

import { toAscii } from '../src/index'

describe('toAscii', () => {
  test('Arabic names in the Arabic chat alphabet', () => {
    expect(toAscii('الناي')).toBe('alnai')
    expect(toAscii('كمنجة')).toBe('kmnga')
    expect(toAscii('خليجي')).toBe('khligi')
    expect(toAscii('جاهز')).toBe('gahz')
    expect(toAscii('ربابه الصعيد')).toBe('rbabh als3id')
  })

  test('drops emoji and symbols, keeps ASCII as it is', () => {
    expect(toAscii('❌الناي')).toBe('alnai')
    expect(toAscii('🎵♦️NAY ♦️🎵')).toBe('NAY ')
    expect(toAscii('El mizmar🌀🌀')).toBe('El mizmar')
    expect(toAscii('abموسيقى (Audio)')).toBe('abmosiqa (Audio)')
  })

  test('Arabic and Persian digits become 0–9', () => {
    expect(toAscii('صانوه٢٠٢٢')).toBe('sanoh2022')
    expect(toAscii('۱۲۳')).toBe('123')
  })

  test('vowel marks and a cut-off character are dropped', () => {
    expect(toAscii('عُود')).toBe('3od') // the damma above ع is dropped
    expect(toAscii('نااااي�')).toBe('naaaai')
  })

  test('nothing but emoji leaves nothing', () => {
    expect(toAscii('🔥🔥')).toBe('')
  })
})
