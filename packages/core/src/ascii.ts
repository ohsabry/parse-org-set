// Arabic letters in the Arabic chat alphabet, the way Arabic is often typed with Latin letters
// (and how these sets' own designers write names like "3oud"): digits stand
// in for sounds English doesn't have. Short vowels aren't written in Arabic, so
// results are consonant-heavy: "الكمنجة" → "alkmnga".
const ARABIC: Record<string, string> = {
  ء: '2',
  آ: 'a',
  أ: 'a',
  إ: 'e',
  ؤ: '2',
  ئ: '2',
  ا: 'a',
  ب: 'b',
  ة: 'a',
  ت: 't',
  ث: 'th',
  ج: 'g',
  ح: '7',
  خ: 'kh',
  د: 'd',
  ذ: 'dh',
  ر: 'r',
  ز: 'z',
  س: 's',
  ش: 'sh',
  ص: 's',
  ض: 'd',
  ط: 't',
  ظ: 'z',
  ع: '3',
  غ: 'gh',
  ف: 'f',
  ق: 'q',
  ك: 'k',
  ل: 'l',
  م: 'm',
  ن: 'n',
  ه: 'h',
  و: 'o',
  ى: 'a',
  ي: 'i',
  // Persian letters that turn up in Arabic names
  پ: 'p',
  چ: 'ch',
  ڤ: 'v',
  گ: 'g',
  ک: 'k',
  ی: 'i',
}

/**
 * Turns text into plain ASCII: ASCII characters are kept, Arabic letters
 * become the Arabic chat alphabet, Arabic and Persian digits become 0–9, and everything else
 * (emoji, symbols, vowel marks, "�") is dropped.
 */
export function toAscii(text: string): string {
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x80) {
      out += char
    } else if (code >= 0x0660 && code <= 0x0669) {
      out += String(code - 0x0660) // Arabic-Indic digits ٠–٩
    } else if (code >= 0x06f0 && code <= 0x06f9) {
      out += String(code - 0x06f0) // Persian digits ۰–۹
    } else {
      out += ARABIC[char] ?? ''
    }
  }
  return out
}
