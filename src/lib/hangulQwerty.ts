/**
 * Convert Hangul text into the QWERTY keystrokes that would have produced it
 * on the standard 두벌식 (dubeolsik) keyboard layout.
 *
 * Use case: a user means to type an English command (e.g. `table`) but leaves
 * the IME in Korean mode, so the editor receives `ㅅ뮤ㅣㄷ` instead. Running
 * this on that string yields `table`, letting wrong-layout input still match
 * English command keywords. Characters that aren't Hangul (already-Latin
 * letters, digits, punctuation) pass through unchanged, so it is safe to call
 * on any query.
 */

// Compatibility-jamo → dubeolsik key. Uppercase keys mean Shift was held
// (the double consonants ㄲㄸㅃㅆㅉ and the wide vowels ㅒㅖ). Compound jamo
// that take two keystrokes map to their two-key sequence (e.g. ㅘ = ㅗ+ㅏ = hk).
const JAMO_TO_QWERTY: Record<string, string> = {
  // Leading / trailing consonants
  ㄱ: 'r', ㄲ: 'R', ㄳ: 'rt', ㄴ: 's', ㄵ: 'sw', ㄶ: 'sg', ㄷ: 'e', ㄸ: 'E',
  ㄹ: 'f', ㄺ: 'fr', ㄻ: 'fa', ㄼ: 'fq', ㄽ: 'ft', ㄾ: 'fx', ㄿ: 'fv', ㅀ: 'fg',
  ㅁ: 'a', ㅂ: 'q', ㅃ: 'Q', ㅄ: 'qt', ㅅ: 't', ㅆ: 'T', ㅇ: 'd', ㅈ: 'w',
  ㅉ: 'W', ㅊ: 'c', ㅋ: 'z', ㅌ: 'x', ㅍ: 'v', ㅎ: 'g',
  // Vowels
  ㅏ: 'k', ㅐ: 'o', ㅑ: 'i', ㅒ: 'O', ㅓ: 'j', ㅔ: 'p', ㅕ: 'u', ㅖ: 'P',
  ㅗ: 'h', ㅘ: 'hk', ㅙ: 'ho', ㅚ: 'hl', ㅛ: 'y', ㅜ: 'n', ㅝ: 'nj', ㅞ: 'np',
  ㅟ: 'nl', ㅠ: 'b', ㅡ: 'm', ㅢ: 'ml', ㅣ: 'l',
};

// Jamo, indexed as in a composed syllable, expressed as compatibility-jamo so
// they resolve through JAMO_TO_QWERTY above.
const CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];
const JUNGSEONG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ',
  'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
];
const JONGSEONG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ',
  'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const JUNG_COUNT = JUNGSEONG.length; // 21
const JONG_COUNT = JONGSEONG.length; // 28

function jamoKeys(jamo: string): string {
  return JAMO_TO_QWERTY[jamo] ?? '';
}

export function hangulToQwerty(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      const offset = code - HANGUL_BASE;
      const cho = Math.floor(offset / (JUNG_COUNT * JONG_COUNT));
      const jung = Math.floor((offset % (JUNG_COUNT * JONG_COUNT)) / JONG_COUNT);
      const jong = offset % JONG_COUNT;
      out += jamoKeys(CHOSEONG[cho] ?? '');
      out += jamoKeys(JUNGSEONG[jung] ?? '');
      if (jong > 0) out += jamoKeys(JONGSEONG[jong] ?? '');
    } else if (JAMO_TO_QWERTY[ch] !== undefined) {
      out += JAMO_TO_QWERTY[ch];
    } else {
      out += ch;
    }
  }
  return out;
}
