/**
 * Han-Viet Lookup Utility for J-Lexicon AI
 * Extracts Kanji from Japanese words and maps them to Sino-Vietnamese (Hán-Việt) readings.
 */

export class HanVietLookup {
  constructor() {
    this.hanvietData = null;
    this.isLoaded = false;
  }

  /**
   * Load the hanviet.json dataset
   */
  async load(customUrl = null) {
    if (this.isLoaded && this.hanvietData) return;

    try {
      const url = customUrl || (typeof chrome !== 'undefined' && chrome.runtime?.getURL 
        ? chrome.runtime.getURL('data/hanviet.json') 
        : '../data/hanviet.json');
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load hanviet.json: ${response.status}`);
      }
      this.hanvietData = await response.json();
      this.isLoaded = true;
    } catch (err) {
      console.warn('[HanVietLookup] Failed to load hanviet.json:', err);
      this.hanvietData = {};
    }
  }

  /**
   * Check if character is a Kanji (CJK Unified Ideographs + Extension A)
   */
  isKanji(char) {
    const code = char.charCodeAt(0);
    return (code >= 0x4e00 && code <= 0x9faf) || (code >= 0x3400 && code <= 0x4dbf);
  }

  /**
   * Get Han-Viet reading for a single Kanji character
   */
  getKanjiReading(char) {
    if (!this.hanvietData) return null;
    return this.hanvietData[char] || null;
  }

  /**
   * Extract all Kanji and return their Hán-Việt readings for a word
   * Example: "食べる" -> { text: "THỰC", kanjis: [{ char: "食", reading: "THỰC" }] }
   * Example: "日本語" -> { text: "NHẬT BẢN NGỮ", kanjis: [...] }
   */
  lookupWord(word) {
    if (!word || typeof word !== 'string') {
      return { text: '', kanjis: [] };
    }

    const kanjis = [];
    const readings = [];

    for (const char of word) {
      if (this.isKanji(char)) {
        const reading = this.getKanjiReading(char);
        if (reading) {
          kanjis.push({ char, reading });
          readings.push(reading);
        } else {
          kanjis.push({ char, reading: '' });
        }
      }
    }

    const validReadings = readings.filter(Boolean);
    return {
      text: validReadings.join(' '),
      kanjis: kanjis
    };
  }
}

export const hanvietLookup = new HanVietLookup();
