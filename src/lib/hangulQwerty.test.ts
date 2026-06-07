import { describe, expect, it } from 'vitest';

import { hangulToQwerty } from './hangulQwerty';

describe('hangulToQwerty', () => {
  it('maps Korean-IME "table" (ㅅ뮤ㅣㄷ) back to "table"', () => {
    expect(hangulToQwerty('ㅅ뮤ㅣㄷ')).toBe('table');
  });

  it('decomposes composed syllables with a final consonant', () => {
    // 안녕 = ㅇㅏㄴ + ㄴㅕㅇ -> dks + sud
    expect(hangulToQwerty('안녕')).toBe('dkssud');
  });

  it('expands compound vowels (ㅘ = ㅗ+ㅏ = hk)', () => {
    // 과 = ㄱ + ㅘ -> r + hk
    expect(hangulToQwerty('과')).toBe('rhk');
  });

  it('expands compound final consonants (ㄺ = ㄹ+ㄱ = fr)', () => {
    // 닭 = ㄷ + ㅏ + ㄺ -> e + k + fr
    expect(hangulToQwerty('닭')).toBe('ekfr');
  });

  it('maps double consonants via their shifted key (ㄲ -> R)', () => {
    // 깍 = ㄲ + ㅏ + ㄱ -> R + k + r
    expect(hangulToQwerty('깍')).toBe('Rkr');
  });

  it('handles standalone compatibility jamo', () => {
    expect(hangulToQwerty('ㅅ')).toBe('t');
    expect(hangulToQwerty('ㅣ')).toBe('l');
    expect(hangulToQwerty('ㄷ')).toBe('e');
  });

  it('passes non-Hangul characters through unchanged', () => {
    expect(hangulToQwerty('table')).toBe('table');
    expect(hangulToQwerty('h1')).toBe('h1');
    expect(hangulToQwerty('')).toBe('');
  });

  it('converts mixed Hangul + Latin segments', () => {
    // "ㅅ뮤ㅣㄷ123" -> "table123"
    expect(hangulToQwerty('ㅅ뮤ㅣㄷ123')).toBe('table123');
  });
});
