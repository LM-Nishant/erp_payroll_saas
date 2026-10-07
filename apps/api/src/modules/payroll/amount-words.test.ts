import { describe, expect, it } from 'vitest';
import { integerInWordsIndian, rupeesInWords } from './amount-words';

describe('rupeesInWords', () => {
  it('uses the Indian numbering system', () => {
    expect(rupeesInWords(68000)).toBe('Indian Rupee Sixty-Eight Thousand Only');
    expect(integerInWordsIndian(816000)).toBe('Eight Lakh Sixteen Thousand');
    expect(integerInWordsIndian(12_345_678)).toBe(
      'One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight',
    );
    expect(integerInWordsIndian(0)).toBe('Zero');
  });

  it('appends paise', () => {
    expect(rupeesInWords(101.5)).toBe('Indian Rupee One Hundred One and Fifty Paise Only');
  });
});
