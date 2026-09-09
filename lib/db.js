/**
 * IndexedDB Database Layer for J-Lexicon AI
 * Manages Jitendex dictionary data (terms, kanji, tags, meta) with high-performance querying.
 */

import { Deinflector } from './deinflector.js';

const DB_NAME = 'JLexiconDB';
const DB_VERSION = 1;

export class DictionaryDB {
  constructor() {
    this.db = null;
    this.initPromise = null;
  }

  /**
   * Open / initialize IndexedDB connection
   */
  async init() {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store for terms
        if (!db.objectStoreNames.contains('terms')) {
          const termStore = db.createObjectStore('terms', { keyPath: 'id', autoIncrement: true });
          termStore.createIndex('term', 'term', { unique: false });
          termStore.createIndex('reading', 'reading', { unique: false });
          termStore.createIndex('term_length', 'termLength', { unique: false });
        }

        // Store for kanji bank
        if (!db.objectStoreNames.contains('kanji')) {
          db.createObjectStore('kanji', { keyPath: 'kanji' });
        }

        // Store for tags
        if (!db.objectStoreNames.contains('tags')) {
          db.createObjectStore('tags', { keyPath: 'name' });
        }

        // Store for metadata
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('[DictionaryDB] Failed to open IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });

    return this.initPromise;
  }

  /**
   * Insert array of terms in batches
   * @param {Array} entries Raw Jitendex term_bank entries or formatted objects
   * @param {string} dictName Name of dictionary
   * @param {Function} onProgress Optional callback (processed, total)
   */
  async insertTermsBatch(entries, dictName = 'Jitendex', onProgress = null) {
    const db = await this.init();
    const BATCH_SIZE = 2500;
    const total = entries.length;
    let processed = 0;

    for (let i = 0; i < total; i += BATCH_SIZE) {
      const chunk = entries.slice(i, i + BATCH_SIZE);
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['terms'], 'readwrite');
        const store = tx.objectStore('terms');

        for (const item of chunk) {
          let record;
          // Yomichan / Jitendex array format:
          // [term, reading, definition_tags, rules, score, [glossary], sequence_number, term_tags]
          if (Array.isArray(item)) {
            const [term, reading, defTags, rules, score, definitions, seq, termTags] = item;
            record = {
              term: term || '',
              reading: reading || term || '',
              definitionTags: defTags || '',
              rules: rules || '',
              score: typeof score === 'number' ? score : 0,
              definitions: Array.isArray(definitions) ? definitions : [definitions],
              sequence: seq || 0,
              termTags: termTags || '',
              termLength: (term || '').length,
              dictName
            };
          } else {
            record = {
              ...item,
              termLength: (item.term || '').length,
              dictName
            };
          }
          store.add(record);
        }

        tx.oncomplete = () => {
          processed += chunk.length;
          if (onProgress) onProgress(processed, total);
          resolve();
        };

        tx.onerror = (e) => {
          reject(e.target.error);
        };
      });

      // Yield event loop
      await new Promise((r) => setTimeout(r, 0));
    }

    await this.updateMetaStats();
  }

  /**
   * Insert Kanji bank entries
   */
  async insertKanjiBatch(entries, dictName = 'Jitendex') {
    const db = await this.init();
    const BATCH_SIZE = 2000;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const chunk = entries.slice(i, i + BATCH_SIZE);
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['kanji'], 'readwrite');
        const store = tx.objectStore('kanji');

        for (const item of chunk) {
          // [kanji, onyomi, kunyomi, tags, [meanings], stats]
          if (Array.isArray(item)) {
            const [kanji, onyomi, kunyomi, tags, meanings, stats] = item;
            store.put({
              kanji,
              onyomi: onyomi || '',
              kunyomi: kunyomi || '',
              tags: tags || '',
              meanings: Array.isArray(meanings) ? meanings : [meanings],
              stats: stats || {},
              dictName
            });
          }
        }

        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      });
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  /**
   * Search terms by exact match on term or reading
   */
  async findExact(text) {
    if (!text) return [];
    const db = await this.init();

    return new Promise((resolve) => {
      const tx = db.transaction(['terms'], 'readonly');
      const store = tx.objectStore('terms');
      const results = [];

      // Query term index
      const termReq = store.index('term').getAll(text);
      termReq.onsuccess = () => {
        if (termReq.result && termReq.result.length > 0) {
          results.push(...termReq.result);
        }

        // Also query reading index if different
        const readingReq = store.index('reading').getAll(text);
        readingReq.onsuccess = () => {
          if (readingReq.result && readingReq.result.length > 0) {
            for (const r of readingReq.result) {
              if (!results.some(existing => existing.id === r.id)) {
                results.push(r);
              }
            }
          }
          resolve(results);
        };
        readingReq.onerror = () => resolve(results);
      };
      termReq.onerror = () => resolve([]);
    });
  }

  /**
   * Scan text at cursor: checks prefixes from max length down to 1,
   * deinflecting each slice to find matching dictionary words.
   * @param {string} text Text starting at selection or hover point
   * @param {number} maxScanLength Maximum characters to scan ahead (default: 16)
   */
  async searchScan(text, maxScanLength = 16) {
    if (!text) return { matches: [], matchedLength: 0 };

    const cleanText = text.trim();
    const scanLen = Math.min(cleanText.length, maxScanLength);
    const db = await this.init();

    // Iterate prefixes from longest down to 1 character
    for (let len = scanLen; len >= 1; len--) {
      const slice = cleanText.slice(0, len);
      const candidates = Deinflector.deinflect(slice);

      for (const candidate of candidates) {
        const matches = await this.findExact(candidate);
        if (matches && matches.length > 0) {
          // Sort matches by score descending
          matches.sort((a, b) => (b.score || 0) - (a.score || 0));
          return {
            matchedText: slice,
            matchedLength: len,
            dictionaryForm: candidate,
            matches: matches
          };
        }
      }
    }

    return { matches: [], matchedLength: 0 };
  }

  /**
   * Update metadata with total term count
   */
  async updateMetaStats() {
    const db = await this.init();
    return new Promise((resolve) => {
      const tx = db.transaction(['terms', 'meta'], 'readwrite');
      const termStore = tx.objectStore('terms');
      const metaStore = tx.objectStore('meta');

      const countReq = termStore.count();
      countReq.onsuccess = () => {
        const count = countReq.result;
        metaStore.put({
          key: 'stats',
          totalTerms: count,
          lastUpdated: new Date().toISOString()
        });
        resolve(count);
      };
      countReq.onerror = () => resolve(0);
    });
  }

  /**
   * Get database statistics (total terms, last updated)
   */
  async getStats() {
    const db = await this.init();
    return new Promise((resolve) => {
      const tx = db.transaction(['meta', 'terms'], 'readonly');
      const metaStore = tx.objectStore('meta');
      const termStore = tx.objectStore('terms');

      const metaReq = metaStore.get('stats');
      metaReq.onsuccess = () => {
        if (metaReq.result) {
          resolve(metaReq.result);
        } else {
          // Fallback: direct count
          const countReq = termStore.count();
          countReq.onsuccess = () => {
            resolve({ totalTerms: countReq.result || 0, lastUpdated: null });
          };
          countReq.onerror = () => resolve({ totalTerms: 0, lastUpdated: null });
        }
      };
      metaReq.onerror = () => resolve({ totalTerms: 0, lastUpdated: null });
    });
  }

  /**
   * Clear all dictionary data
   */
  async clearDatabase() {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['terms', 'kanji', 'tags', 'meta'], 'readwrite');
      tx.objectStore('terms').clear();
      tx.objectStore('kanji').clear();
      tx.objectStore('tags').clear();
      tx.objectStore('meta').clear();

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }
}

export const dictDB = new DictionaryDB();
