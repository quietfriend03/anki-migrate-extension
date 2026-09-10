/**
 * J-Lexicon AI Background Service Worker (Manifest V3)
 * Coordinates IndexedDB lookups, Gemini AI generation, and AnkiConnect synchronization.
 */

import { dictDB } from '../lib/db.js';
import { hanvietLookup } from '../lib/hanviet-lookup.js';

// Initialize DB and Han-Viet dataset
let isReady = false;
async function initialize() {
  try {
    await hanvietLookup.load();
    await dictDB.init();
    isReady = true;
    console.log('[ServiceWorker] J-Lexicon AI initialized successfully');
  } catch (err) {
    console.error('[ServiceWorker] Initialization error:', err);
  }
}

initialize();

// Ensure ready helper
async function ensureReady() {
  if (!isReady) {
    await initialize();
  }
}

/**
 * Japanese & English Part of Speech (POS) to Clean English Mapping
 */
const POS_ENGLISH_MAP = {
  noun: 'Noun',
  'noun-common': 'Noun',
  'noun-proper': 'Proper noun',
  'danh từ': 'Noun',
  suru: 'Suru verb',
  vs: 'Suru verb',
  'vs-i': 'Suru verb (intransitive)',
  'vs-s': 'Special suru verb',
  v1: 'Ichidan verb',
  v5: 'Godan verb',
  v5k: 'Godan verb (ku)',
  v5s: 'Godan verb (su)',
  v5t: 'Godan verb (tsu)',
  v5n: 'Godan verb (nu)',
  v5m: 'Godan verb (mu)',
  v5r: 'Godan verb (ru)',
  v5g: 'Godan verb (gu)',
  v5b: 'Godan verb (bu)',
  vk: 'Kuru verb',
  vi: 'Intransitive verb',
  vt: 'Transitive verb',
  intransitive: 'Intransitive verb',
  transitive: 'Transitive verb',
  'nội động từ': 'Intransitive verb',
  'tự động từ': 'Intransitive verb',
  'ngoại động từ': 'Transitive verb',
  'tha động từ': 'Transitive verb',
  'chuyển tiếp': 'Transitive verb',
  'adj-i': 'I-adjective',
  'adj-na': 'Na-adjective',
  'adj-no': 'No-adjective',
  adverb: 'Adverb',
  adv: 'Adverb',
  adjective: 'Adjective',
  expression: 'Expression',
  exp: 'Expression',
  counter: 'Counter',
  prefix: 'Prefix',
  suffix: 'Suffix',
  pronoun: 'Pronoun',
  particle: 'Particle',
  conjunction: 'Conjunction',
  interjection: 'Interjection'
};

function formatPosToEnglish(posList) {
  if (!posList) return '';
  const list = Array.isArray(posList) ? posList : [posList];
  const allTokens = [];

  list.forEach((p) => {
    if (typeof p !== 'string') return;
    let s = p.toLowerCase().trim();

    if (s.includes('danh từ') || s.includes('noun')) { allTokens.push('Noun'); s = s.replace(/danh\s*từ|noun/g, ''); }
    if (s.includes('suru') || s.includes('vs')) { allTokens.push('Suru verb'); s = s.replace(/(?:động từ\s+)?suru|vs/g, ''); }
    if (s.includes('chuyển tiếp') || s.includes('tha động từ') || s.includes('ngoại động từ') || s.includes('transitive') || s.includes('vt')) {
      allTokens.push('Transitive verb');
      s = s.replace(/chuyển\s*tiếp|tha\s*động\s*từ|ngoại\s*động\s*từ|transitive|vt/g, '');
    }
    if (s.includes('tự động từ') || s.includes('nội động từ') || s.includes('intransitive') || s.includes('vi')) {
      allTokens.push('Intransitive verb');
      s = s.replace(/tự\s*động\s*từ|nội\s*động\s*từ|intransitive|vi/g, '');
    }

    const parts = s.split(/[,/•\s]+/).filter(Boolean);
    parts.forEach((token) => {
      const mapped = POS_ENGLISH_MAP[token];
      if (mapped) allTokens.push(mapped);
      else if (token.length > 1 && !['and', 'of', 'with', 'for', 'và', 'của', 'với', 'cho'].includes(token)) {
        allTokens.push(token.charAt(0).toUpperCase() + token.slice(1));
      }
    });
  });

  return Array.from(new Set(allTokens)).join(' • ');
}

/**
 * Translation Cache & Service (Translates English definitions / Japanese terms to natural Vietnamese)
 */
const translationCache = new Map();

async function translateToVietnamese(text, sourceLang = 'en') {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';

  // If text already contains Vietnamese characters
  if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(trimmed)) {
    return trimmed;
  }

  const cacheKey = `${sourceLang}:${trimmed}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=vi&dt=t&q=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data[0])) {
        const viText = data[0].map((segment) => segment[0]).filter(Boolean).join('');
        if (viText) {
          translationCache.set(cacheKey, viText);
          return viText;
        }
      }
    }
  } catch (err) {
    console.warn('[Translate] Error translating to Vietnamese:', err);
  }

  return trimmed;
}

/**
 * Recursively translate only example sentence translations in Structured Content to Vietnamese,
 * while keeping definitions, glossaries, notes, and tags in authentic English as in Jitendex.
 */
async function translateExampleSentencesInNode(node, isInsideExample = false) {
  if (node === null || node === undefined) return node;
  if (typeof node === 'number') return node;

  if (typeof node === 'string') {
    if (isInsideExample && !/[\u3040-\u30ff\u4e00-\u9faf]/.test(node) && node.trim().length > 1) {
      return await translateToVietnamese(node, 'en');
    }
    return node;
  }

  if (Array.isArray(node)) {
    return await Promise.all(node.map((child) => translateExampleSentencesInNode(child, isInsideExample)));
  }

  if (typeof node === 'object') {
    const isExampleNode = isInsideExample || (node.data && typeof node.data === 'object' && /example/i.test(node.data.content));

    // Part of speech badge formatting in English
    if (node.data && typeof node.data === 'object' && node.data.content === 'partOfSpeech') {
      const formattedPos = formatPosToEnglish(node.content);
      return {
        ...node,
        content: formattedPos
      };
    }

    // Explicit English translation element inside example sentence: { tag: "div", lang: "en", content: "..." }
    if (isExampleNode && node.lang === 'en') {
      const newNode = { ...node, lang: 'vi' };
      if (typeof node.content === 'string') {
        newNode.content = await translateToVietnamese(node.content, 'en');
      } else if (node.content !== undefined) {
        newNode.content = await translateExampleSentencesInNode(node.content, true);
      }
      return newNode;
    }

    const newNode = { ...node };
    if (node.content !== undefined) {
      newNode.content = await translateExampleSentencesInNode(node.content, isExampleNode);
    }
    return newNode;
  }

  return node;
}

/**
 * Message Dispatcher
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;

  (async () => {
    await ensureReady();

    switch (type) {
      case 'LOOKUP_TERM':
        return await handleLookup(payload);

      case 'LOOKUP_EXACT':
        return await handleLookupExact(payload);

      case 'CHECK_NOTE_EXISTS':
        return await handleCheckNoteExists(payload);

      case 'GENERATE_AI_EXAMPLE':
        return await handleGeminiGenerate(payload);

      case 'ADD_TO_ANKI':
        return await handleAddToAnki(payload);

      case 'TEST_ANKI_CONNECTION':
        return await handleTestAnki(payload);

      case 'GET_ANKI_MODEL_FIELDS':
        return await handleGetAnkiModelFields(payload);

      case 'SETUP_LINGUIST_ANKI_MODEL':
        return await handleSetupLinguistAnkiModel(payload);

      case 'TEST_GEMINI_CONNECTION':
        return await handleTestGemini(payload);

      case 'LIST_GEMINI_MODELS':
        return await fetchAvailableGeminiModels(payload?.apiKey);

      case 'GET_STATS':
        return await handleGetStats();

      case 'GET_KANJI_STROKES':
        return await handleGetKanjiStrokes(payload);

      case 'CLEAR_DATABASE':
        return await handleClearDatabase();

      case 'OPEN_OPTIONS':
        await chrome.runtime.openOptionsPage();
        return { success: true };

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  })()
    .then((result) => sendResponse({ success: true, data: result }))
    .catch((error) => {
      console.error(`[ServiceWorker] Error handling ${type}:`, error);
      sendResponse({ success: false, error: error.message || String(error) });
    });

  // Keep channel open for async response
  return true;
});

/**
 * Helper to detect whether a list of definitions contains example sentences
 */
function hasExampleSentence(definitions) {
  if (!definitions || !Array.isArray(definitions) || definitions.length === 0) return false;

  function checkNode(node) {
    if (!node) return false;
    if (typeof node === 'string') {
      if (node.includes('jlex-sc-example') || node.includes('Tatoeba') || /<ruby>.*<\/ruby>.*[。？！]/s.test(node)) {
        return true;
      }
      return false;
    }
    if (Array.isArray(node)) {
      return node.some(checkNode);
    }
    if (typeof node === 'object') {
      if (node.data && typeof node.data === 'object') {
        const content = String(node.data.content || '');
        if (/example/i.test(content)) return true;
      }
      if (node.content !== undefined) {
        return checkNode(node.content);
      }
    }
    return false;
  }

  return definitions.some(checkNode);
}

/**
 * Handle term scan lookup at cursor position
 */
async function handleLookup({ text, maxScanLength = 16 }) {
  if (!text) return { matches: [], matchedText: '', hanviet: null };

  const scanResult = await dictDB.searchScan(text, maxScanLength);

  if (scanResult && scanResult.matches && scanResult.matches.length > 0) {
    // Enrich each match with Hán-Việt readings & English definitions + Vietnamese example sentences
    const enrichedMatches = await Promise.all(
      scanResult.matches.map(async (item) => {
        const hanviet = hanvietLookup.lookupWord(item.term);
        const enrichedDefs = item.definitions && item.definitions.length > 0
          ? await Promise.all(item.definitions.map((d) => translateExampleSentencesInNode(d)))
          : [];

        const enPos = formatPosToEnglish(item.definitionTags || item.rules || []);
        const hasExample = hasExampleSentence(enrichedDefs);

        return {
          ...item,
          hanviet,
          enPos,
          viPos: enPos, // Backward compatible property
          definitions: enrichedDefs,
          hasExample
        };
      })
    );

    return {
      matchedText: scanResult.matchedText,
      matchedLength: scanResult.matchedLength,
      dictionaryForm: scanResult.dictionaryForm,
      matches: enrichedMatches
    };
  }

  // If no dictionary match found, check Hán-Việt + online Japanese-to-Vietnamese translation
  const sampleTerm = text.slice(0, 4);
  const directHanviet = hanvietLookup.lookupWord(sampleTerm);
  let onlineMatch = null;

  try {
    const onlineVi = await translateToVietnamese(sampleTerm, 'ja');
    if (onlineVi && onlineVi.toLowerCase() !== sampleTerm.toLowerCase()) {
      onlineMatch = {
        term: sampleTerm,
        reading: '',
        definitions: [onlineVi],
        hanviet: directHanviet,
        enPos: '',
        viPos: '',
        hasExample: false
      };
    }
  } catch (e) {
    console.warn('[OnlineTranslate] Fallback lookup failed:', e);
  }

  return {
    matchedText: sampleTerm,
    matchedLength: 0,
    dictionaryForm: null,
    matches: onlineMatch ? [onlineMatch] : [],
    directHanviet: directHanviet.text ? directHanviet : null
  };
}

/**
 * Handle exact term lookup
 */
async function handleLookupExact({ text }) {
  if (!text) return [];
  const matches = await dictDB.findExact(text);
  return await Promise.all(
    matches.map(async (item) => {
      const hanviet = hanvietLookup.lookupWord(item.term);
      const enrichedDefs = item.definitions && item.definitions.length > 0
        ? await Promise.all(item.definitions.map((d) => translateExampleSentencesInNode(d)))
        : [];
      const enPos = formatPosToEnglish(item.definitionTags || item.rules || []);
      const hasExample = hasExampleSentence(enrichedDefs);
      return {
        ...item,
        hanviet,
        enPos,
        viPos: enPos,
        definitions: enrichedDefs,
        hasExample
      };
    })
  );
}

/**
 * Call Gemini AI (Google AI Studio) to generate contextual example sentences
 */
/**
 * Fetch available Gemini models that support generateContent for the given API key
 */
async function fetchAvailableGeminiModels(apiKey) {
  if (!apiKey) return [];
  const endpoints = [
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.models && Array.isArray(data.models)) {
          return data.models
            .filter((m) => {
              if (!m.supportedGenerationMethods?.includes('generateContent')) return false;
              const name = (m.name || '').replace(/^models\//, '').toLowerCase();
              // Strictly only genuine Gemini models; exclude Gemma and non-chat models
              if (!name.startsWith('gemini-')) return false;
              if (name.includes('gemma')) return false;
              if (
                name.includes('embedding') ||
                name.includes('imagen') ||
                name.includes('tts') ||
                name.includes('realtime') ||
                name.includes('audio')
              ) {
                return false;
              }
              return true;
            })
            .map((m) => {
              const cleanName = m.name.replace(/^models\//, '');
              return {
                name: cleanName,
                displayName: m.displayName || cleanName,
                description: m.description || ''
              };
            });
        }
      }
    } catch (e) {
      console.warn('[Gemini] ListModels fetch error for', url, e);
    }
  }
  return [];
}

async function callGeminiApi(apiKey, model, requestBody) {
  let cleanModel = (model || 'gemini-3.6-flash').trim().replace(/^models\//, '');
  if (
    !cleanModel ||
    cleanModel.startsWith('gemma-') ||
    cleanModel === 'gemini-2.0-flash' ||
    cleanModel === 'gemini-2.0-flash-lite' ||
    cleanModel === 'gemini-2.5-flash' ||
    cleanModel === 'gemini-3.1-pro-preview'
  ) {
    cleanModel = 'gemini-3.6-flash';
  }
  const versions = ['v1beta', 'v1'];
  let lastError = null;

  for (const ver of versions) {
    const url = `https://generativelanguage.googleapis.com/${ver}/models/${encodeURIComponent(cleanModel)}:generateContent?key=${apiKey}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (res.ok) {
        return await res.json();
      }

      const errData = await res.json().catch(() => ({}));
      lastError = errData.error?.message || `HTTP ${res.status} ${res.statusText}`;

      if (lastError.includes('API key not valid') || lastError.includes('API_KEY_INVALID')) {
        throw new Error(`API Key không hợp lệ: ${lastError}`);
      }
    } catch (err) {
      lastError = err.message;
      if (lastError.includes('API Key không hợp lệ')) throw err;
    }
  }

  // Fallback to gemini-3.6-flash or gemini-1.5-flash if user model was deprecated or failed
  if (cleanModel !== 'gemini-3.6-flash') {
    for (const fallbackModel of ['gemini-3.6-flash', 'gemini-1.5-flash']) {
      for (const ver of versions) {
        const url = `https://generativelanguage.googleapis.com/${ver}/models/${fallbackModel}:generateContent?key=${apiKey}`;
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          });
          if (res.ok) {
            return await res.json();
          }
        } catch (_) {}
      }
    }
  }

  throw new Error(`Lỗi gọi model "${cleanModel}": ${lastError}`);
}

/**
 * Helper to ensure Japanese Furigana is formatted as HTML ruby
 * Converts 漢字(かんじ) or 漢字[かんじ] into <ruby>漢字<rt>かんじ</rt></ruby>
 */
function ensureRubyFurigana(text) {
  if (!text) return '';
  if (/<ruby>/i.test(text)) return text;
  return text.replace(
    /([\u4e00-\u9faf\u3400-\u4dbf]+)[(（\[]([ぁ-んァ-ヶー]+)[)）\]]/g,
    '<ruby>$1<rt>$2</rt></ruby>'
  );
}

/**
 * 24 distinct colors for stroke order diagrams matching Mazii / standard stroke order guides
 */
const STROKE_COLORS = [
  '#2563eb', '#ef4444', '#1f2937', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#b91c1c', '#334155',
  '#059669', '#d97706', '#7c3aed', '#db2777', '#0284c7',
  '#ea580c', '#1e293b', '#16a34a', '#c026d3', '#475569',
  '#e11d48', '#4f46e5', '#0d9488', '#ca8a04'
];

const kanjiSvgCache = new Map();

/**
 * Fetch KanjiVG SVG for a character and transform it into an interactive self-writing animation
 * with coordinate crosshairs, ghost background lines, colored strokes, and staggered stroke-by-stroke animation
 */
async function getAnimatedKanjiSvg(char) {
  if (!char) return null;
  if (kanjiSvgCache.has(char)) {
    return kanjiSvgCache.get(char);
  }

  const hex = char.codePointAt(0).toString(16).padStart(5, '0');
  const url = `https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/${hex}.svg`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const svgText = await res.text();

    const paths = Array.from(svgText.matchAll(/<path\s+[^>]*d="([^"]+)"/g)).map((m) => m[1]);
    const numStrokes = paths.length;
    const uid = `kvg_${hex}`;
    const durationPerStroke = 0.42;

    let css = `<style>
@keyframes draw_${uid} {
  0% { stroke-dashoffset: 400; }
  100% { stroke-dashoffset: 0; }
}
@keyframes num_${uid} {
  0% { opacity: 0; transform: scale(0.6); }
  100% { opacity: 1; transform: scale(1); }
}
`;
    for (let i = 0; i < numStrokes; i++) {
      const delay = (i * durationPerStroke).toFixed(2);
      css += `.${uid}-s${i + 1} { stroke-dasharray: 400; stroke-dashoffset: 400; animation: draw_${uid} ${durationPerStroke}s ease forwards; animation-delay: ${delay}s; }\n`;
      css += `.${uid}-n${i + 1} { opacity: 0; animation: num_${uid} 0.25s ease forwards; animation-delay: ${delay}s; }\n`;
    }
    css += `</style>`;

    // Background ghost strokes
    let ghostGroup = `<g class="ghost-strokes" stroke="#e2e8f0" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" fill="none">\n`;
    for (const d of paths) {
      ghostGroup += `  <path d="${d}" />\n`;
    }
    ghostGroup += `</g>\n`;

    const grid = `<line x1="0" y1="54.5" x2="109" y2="54.5" stroke="#bfdbfe" stroke-dasharray="3,3" stroke-width="0.8" /><line x1="54.5" y1="0" x2="54.5" y2="109" stroke="#bfdbfe" stroke-dasharray="3,3" stroke-width="0.8" />`;

    let strokeIdx = 0;
    let colored = svgText.replace(/<path\s+([^>]+)\/>/g, (match, attrs) => {
      const i = strokeIdx;
      const color = STROKE_COLORS[i % STROKE_COLORS.length];
      strokeIdx++;
      let cleanAttrs = attrs
        .replace(/style="[^"]*"/g, '')
        .replace(/stroke="[^"]*"/g, '')
        .replace(/fill="[^"]*"/g, '')
        .replace(/class="[^"]*"/g, '');
      return `<path ${cleanAttrs} class="${uid}-s${i + 1}" fill="none" stroke="${color}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" />`;
    });

    colored = colored.replace(/<text\s+([^>]+)>(\d+)<\/text>/g, (match, attrs, numStr) => {
      const num = parseInt(numStr, 10) || 1;
      const color = STROKE_COLORS[(num - 1) % STROKE_COLORS.length] || '#808080';
      let cleanAttrs = attrs.replace(/class="[^"]*"/g, '');
      return `<text ${cleanAttrs} class="${uid}-n${num}" fill="${color}" font-size="8.5" font-weight="bold" font-family="sans-serif">${numStr}</text>`;
    });

    colored = colored.replace(/(<svg[^>]*>)/i, `$1${css}${grid}${ghostGroup}`);

    kanjiSvgCache.set(char, colored);
    return colored;
  } catch (err) {
    console.warn(`[KanjiVG] Failed to fetch SVG for ${char}:`, err);
    return null;
  }
}

/**
 * Build HTML cards for each Kanji character in the word matching Mazii stroke order layout
 * with self-writing animation and replay button
 */
async function buildKanjiCardsHtml(word, kanjiDetails = []) {
  const kanjiChars = (word || '').match(/[\u4e00-\u9faf\u3400-\u4dbf]/g) || [];
  if (kanjiChars.length === 0) {
    return '';
  }

  const detailsMap = new Map();
  if (Array.isArray(kanjiDetails)) {
    kanjiDetails.forEach((d) => {
      if (d && d.kanji) detailsMap.set(d.kanji, d);
    });
  }

  const cards = [];
  const uniqueChars = Array.from(new Set(kanjiChars));

  for (const char of uniqueChars) {
    const detail = detailsMap.get(char) || {};
    const directHv = hanvietLookup.lookupWord(char);
    const hanviet = detail.hanviet || directHv.text || '';
    const onyomi = detail.onyomi || '';
    const kunyomi = detail.kunyomi || '';
    const meaning = detail.meaning || '';

    const svg = await getAnimatedKanjiSvg(char);

    cards.push(`
      <div class="lab-kanji-card" style="background: var(--lab-surface, #ffffff); border: 1px solid var(--lab-border, #e2e8f0); border-radius: 16px; padding: 16px 18px; margin-bottom: 16px; box-shadow: var(--lab-shadow, 0 3px 10px rgba(0,0,0,0.04));">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 26px; font-weight: 700; color: #2563eb;">
            ${char} ${onyomi ? `<span style="font-size: 15px; color: var(--lab-muted, #64748b); font-weight: 500;">「${escapeHtml(onyomi)}」</span>` : ''}
          </div>
          <button type="button" class="btn-replay-stroke" onclick="var d=this.closest('.lab-kanji-card').querySelector('.lab-kanji-diagram svg'); if(d){ var c=d.cloneNode(true); d.parentNode.replaceChild(c, d); }" style="background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; font-size: 11.5px; font-weight: 600; padding: 4px 10px; border-radius: 6px; cursor: pointer;">
            🔄 Tự viết lại
          </button>
        </div>
        <div style="font-size: 18px; font-weight: 800; color: var(--lab-text, #1e293b); margin: 3px 0 12px; letter-spacing: 0.04em;">
          ${escapeHtml(hanviet)}
        </div>

        ${svg ? `
        <div class="lab-kanji-diagram" onclick="var s=this.querySelector('svg'); if(s){ var c=s.cloneNode(true); s.parentNode.replaceChild(c, s); }" style="display: flex; justify-content: center; align-items: center; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px; width: 160px; height: 160px; margin: 0 auto 8px; cursor: pointer;" title="Bấm vào đây để tự viết lại nét">
          ${svg}
        </div>
        <div style="text-align: center; font-size: 11px; color: var(--lab-muted, #64748b); margin-bottom: 12px;">
          ✨ Nét vẽ tự động viết theo thứ tự (Bấm vào hình để xem lại)
        </div>
        ` : ''}

        <div style="font-size: 13.5px; color: var(--lab-text, #334155); line-height: 1.6; border-top: 1px solid var(--lab-border, #f1f5f9); padding-top: 10px;">
          <div><strong>Hán tự:</strong> ${char} - ${escapeHtml(hanviet)}</div>
          ${(onyomi || kunyomi) ? `<div><strong>Âm:</strong> ${[onyomi ? `On: ${onyomi}` : '', kunyomi ? `Kun: ${kunyomi}` : ''].filter(Boolean).map(escapeHtml).join(' &nbsp;|&nbsp; ')}</div>` : ''}
          ${meaning ? `<div><strong>Ý nghĩa:</strong> ${escapeHtml(meaning)}</div>` : ''}
        </div>
      </div>
    `);
  }

  return `
    <div class="lab-kanji-container">
      <div style="font-size: 13.5px; font-weight: 700; color: var(--lab-muted, #64748b); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px;">
        Các chữ kanji của ${escapeHtml(word)}
      </div>
      ${cards.join('')}
    </div>
  `;
}

/**
 * Handle GET_KANJI_STROKES message
 */
async function handleGetKanjiStrokes({ word }) {
  const kanjiChars = (word || '').match(/[\u4e00-\u9faf\u3400-\u4dbf]/g) || [];
  const uniqueChars = Array.from(new Set(kanjiChars));
  const results = [];

  for (const char of uniqueChars) {
    const hv = hanvietLookup.lookupWord(char);
    const svg = await getAnimatedKanjiSvg(char);
    results.push({
      char,
      hanviet: hv.text || '',
      svg
    });
  }

  return results;
}

/**
 * In-memory cache for AI-generated examples to prevent redundant API calls
 */
const aiExampleCache = new Map();

/**
 * Call Gemini AI to analyze a word for Anki export / AI example generation:
 * - English definitions & POS (matching Jitendex standards)
 * - Natural Japanese example with Furigana (<ruby> tags)
 * - Accurate Vietnamese translation of the example sentence
 * - Kanji breakdown details (On, Kun, Hán-Việt, meaning)
 */
async function handleGeminiAnalyzeWord({ word, reading, definition, forceRegenerate = false }) {
  const config = await chrome.storage.local.get({
    geminiApiKey: '',
    geminiModel: 'gemini-3.6-flash'
  });

  const apiKey = config.geminiApiKey;
  if (!apiKey) return null;

  let model = (config.geminiModel || 'gemini-3.6-flash').trim();
  if (
    model.startsWith('gemma-') ||
    model === 'gemini-2.0-flash' ||
    model === 'gemini-2.0-flash-lite' ||
    model === 'gemini-2.5-flash' ||
    model === 'gemini-3.1-pro-preview'
  ) {
    model = 'gemini-3.6-flash';
    chrome.storage.local.set({ geminiModel: 'gemini-3.6-flash' }).catch(() => {});
  }

  const variationPrompt = forceRegenerate
    ? '\n(LƯU Ý: Vui lòng tạo một câu ví dụ mới, sinh động, tự nhiên và khác biệt với các câu ví dụ thông thường).'
    : '';

  const promptText = `Bạn là một từ điển Nhật - Anh - Việt chuyên sâu và chuẩn xác.
Hãy phân tích từ vựng tiếng Nhật sau:
Từ: "${word}", Cách đọc: "${reading || ''}".
Nghĩa gốc tham khảo: "${definition || ''}".${variationPrompt}

Yêu cầu nghiêm ngặt:
1. Định nghĩa và giải nghĩa bằng TIẾNG ANH súc tích, chuẩn từ điển Jitendex/JMdict (ví dụ: "establishment; creation", "setting; configuration").
2. Xác định các từ loại của từ bằng TIẾNG ANH (ví dụ: Noun • Suru verb • Transitive verb, I-adjective...).
3. Tạo 01 câu ví dụ tiếng Nhật tự nhiên, ngắn gọn, phù hợp ngữ cảnh từ.
4. Câu ví dụ BẮT BUỘC phải có Furigana cho TẤT CẢ các chữ Hán trong câu, viết theo thẻ HTML ruby: <ruby>漢字<rt>かんじ</rt></ruby>.
5. Dịch câu ví dụ sang TIẾNG VIỆT chính xác, tự nhiên và sát nghĩa nhất.
6. Phân tích chi tiết các chữ Hán (Kanji) có trong từ: chữ Hán, âm Hán-Việt, âm On'yomi (Katakana), âm Kun'yomi (Hiragana), ý nghĩa Hán-Việt ngắn gọn.

BẮT BUỘC trả về kết quả dưới dạng JSON thuần túy (không kèm markdown fences, không có suy nghĩ hay giải thích ngoài JSON):
{
  "pos_en": "Noun • Suru verb • Transitive verb",
  "meanings_en": [
    "Meaning 1 in English",
    "Meaning 2 in English"
  ],
  "ex_ruby": "<ruby>漢字<rt>かんじ</rt></ruby>の例文",
  "ex_vi": "Dịch câu ví dụ sang tiếng Việt",
  "kanji_details": [
    {
      "kanji": "chữ Hán",
      "hanviet": "ÂM HÁN VIỆT",
      "onyomi": "Âm On",
      "kunyomi": "Âm Kun",
      "meaning": "Ý nghĩa Hán-Việt ngắn gọn"
    }
  ]
}`;

  const requestBody = {
    contents: [
      {
        parts: [{ text: promptText }]
      }
    ],
    systemInstruction: {
      parts: [
        {
          text: "Bạn là một từ điển Nhật - Anh - Việt chuyên sâu. Bạn CHỈ trả về dữ liệu định dạng JSON thuần túy theo schema yêu cầu, không kèm bất kỳ giải thích, suy nghĩ hay markdown fences nào."
        }
      ]
    },
    generationConfig: {
      temperature: forceRegenerate ? 0.7 : 0.2,
      responseMimeType: "application/json"
    }
  };

  try {
    const data = await callGeminiApi(apiKey, model, requestBody);
    const parts = data.candidates?.[0]?.content?.parts || [];
    const contentParts = parts.filter((p) => !p.thought && p.text);
    let rawText = contentParts.map((p) => p.text).join('\n').trim();
    if (!rawText && parts.length > 0) {
      rawText = parts[parts.length - 1].text || '';
    }

    if (!rawText) return null;

    let cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch (_) {
      // Find all JSON candidates by scanning blocks from reverse order
      const jsonBlocks = cleaned.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g) || [];
      for (let i = jsonBlocks.length - 1; i >= 0; i--) {
        try {
          const candidate = JSON.parse(jsonBlocks[i]);
          if (candidate && (candidate.ex_ruby || candidate.ex_jp || candidate.meanings_vi)) {
            parsed = candidate;
            break;
          }
        } catch (_) {}
      }

      if (!parsed) {
        const fallbackMatch = cleaned.match(/\{[\s\S]*\}/);
        if (fallbackMatch) {
          try {
            parsed = JSON.parse(fallbackMatch[0]);
          } catch (_) {}
        }
      }
    }

    if (parsed) {
      if (parsed.ex_ruby) {
        parsed.ex_ruby = ensureRubyFurigana(parsed.ex_ruby);
      } else if (parsed.ex_jp) {
        parsed.ex_ruby = ensureRubyFurigana(parsed.ex_jp);
      }
      return parsed;
    }
  } catch (err) {
    console.warn('[Gemini] Word analysis failed:', err);
    throw err;
  }

  return null;
}

/**
 * Handle Gemini AI Example generation with caching and regeneration support
 */
async function handleGeminiGenerate({ word, reading, definition, forceRegenerate = false }) {
  const config = await chrome.storage.local.get({
    geminiApiKey: ''
  });

  const apiKey = config.geminiApiKey;
  if (!apiKey) {
    throw new Error('NO_API_KEY');
  }

  const cleanWord = (word || '').trim();
  if (!cleanWord) {
    throw new Error('Từ vựng không hợp lệ.');
  }

  if (!forceRegenerate && aiExampleCache.has(cleanWord)) {
    return aiExampleCache.get(cleanWord);
  }

  const analysis = await handleGeminiAnalyzeWord({
    word: cleanWord,
    reading,
    definition,
    forceRegenerate
  });

  if (analysis && (analysis.ex_ruby || analysis.ex_jp)) {
    const rawRuby = analysis.ex_ruby || analysis.ex_jp;
    const formattedRuby = ensureRubyFurigana(rawRuby);
    const plainJp = formattedRuby.replace(/<rt>[^<]*<\/rt>/g, '').replace(/<\/?ruby>/g, '');
    const result = {
      ex_jp: plainJp,
      ex_furigana: formattedRuby,
      ex_vi: analysis.ex_vi || ''
    };
    aiExampleCache.set(cleanWord, result);
    return result;
  }

  throw new Error('AI không thể tạo được câu ví dụ cho từ này. Vui lòng thử lại.');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Remove HTML blocks matching class name by tracking balanced open/close tags
 */
function stripBlocksByClass(html, className) {
  if (!html || !className) return html || '';
  let res = '';
  let i = 0;
  const target = className.toLowerCase();
  while (i < html.length) {
    const classIdx = html.toLowerCase().indexOf(target, i);
    if (classIdx === -1) {
      res += html.slice(i);
      break;
    }
    const tagOpenIdx = html.lastIndexOf('<', classIdx);
    const tagCloseIdx = html.indexOf('>', classIdx);
    if (tagOpenIdx === -1 || tagCloseIdx === -1 || tagOpenIdx < i) {
      res += html.slice(i, classIdx + 1);
      i = classIdx + 1;
      continue;
    }
    if (!/class\s*=\s*["'][^"']*$/i.test(html.slice(tagOpenIdx, classIdx))) {
      res += html.slice(i, classIdx + 1);
      i = classIdx + 1;
      continue;
    }

    res += html.slice(i, tagOpenIdx);
    let depth = 0;
    let pos = tagOpenIdx;
    let closed = false;
    while (pos < html.length) {
      const openMatch = html.slice(pos).match(/^<([a-zA-Z0-9]+)[^>]*>/);
      const closeMatch = html.slice(pos).match(/^<\/([a-zA-Z0-9]+)>/);
      if (openMatch) {
        if (!openMatch[0].endsWith('/>')) {
          depth++;
        }
        pos += openMatch[0].length;
      } else if (closeMatch) {
        depth--;
        pos += closeMatch[0].length;
        if (depth <= 0) {
          closed = true;
          break;
        }
      } else {
        const nextTag = html.indexOf('<', pos + 1);
        if (nextTag === -1) {
          pos = html.length;
        } else {
          pos = nextTag;
        }
      }
    }
    i = closed ? pos : tagOpenIdx + 1;
  }
  return res;
}

/**
 * Extract example sentence blocks matching jlex-sc-example* using balanced tag scanning
 */
function extractExampleBlocks(html) {
  if (!html) return { blocks: [], remaining: '' };
  const blocks = [];
  let remaining = '';
  let i = 0;
  while (i < html.length) {
    const classIdx = html.toLowerCase().indexOf('jlex-sc-example', i);
    if (classIdx === -1) {
      remaining += html.slice(i);
      break;
    }
    const tagOpenIdx = html.lastIndexOf('<', classIdx);
    const tagCloseIdx = html.indexOf('>', classIdx);
    if (tagOpenIdx === -1 || tagCloseIdx === -1 || tagOpenIdx < i) {
      remaining += html.slice(i, classIdx + 1);
      i = classIdx + 1;
      continue;
    }
    if (!/class\s*=\s*["'][^"']*$/i.test(html.slice(tagOpenIdx, classIdx))) {
      remaining += html.slice(i, classIdx + 1);
      i = classIdx + 1;
      continue;
    }

    remaining += html.slice(i, tagOpenIdx);
    let depth = 0;
    let pos = tagOpenIdx;
    let blockEnd = -1;
    while (pos < html.length) {
      const openMatch = html.slice(pos).match(/^<([a-zA-Z0-9]+)[^>]*>/);
      const closeMatch = html.slice(pos).match(/^<\/([a-zA-Z0-9]+)>/);
      if (openMatch) {
        if (!openMatch[0].endsWith('/>')) {
          depth++;
        }
        pos += openMatch[0].length;
      } else if (closeMatch) {
        depth--;
        pos += closeMatch[0].length;
        if (depth <= 0) {
          blockEnd = pos;
          break;
        }
      } else {
        const nextTag = html.indexOf('<', pos + 1);
        if (nextTag === -1) {
          pos = html.length;
        } else {
          pos = nextTag;
        }
      }
    }
    if (blockEnd !== -1) {
      blocks.push(html.slice(tagOpenIdx, blockEnd));
      i = blockEnd;
    } else {
      remaining += html.slice(tagOpenIdx, tagOpenIdx + 1);
      i = tagOpenIdx + 1;
    }
  }
  return { blocks, remaining };
}

/**
 * Extract top-level child elements using balanced tag depth tracking
 */
function extractTopLevelChildrenBalanced(containerHtml) {
  let inner = containerHtml.replace(/^<[a-zA-Z0-9]+[^>]*>/, '').replace(/<\/[a-zA-Z0-9]+>\s*$/, '').trim();
  const children = [];
  let pos = 0;
  while (pos < inner.length) {
    const tagMatch = inner.slice(pos).match(/^<([a-zA-Z0-9]+)[^>]*>/);
    if (!tagMatch) {
      const nextTag = inner.indexOf('<', pos);
      const text = (nextTag === -1 ? inner.slice(pos) : inner.slice(pos, nextTag)).trim();
      if (text) children.push({ tag: 'text', full: text, inner: text });
      pos = nextTag === -1 ? inner.length : nextTag;
      continue;
    }
    const tagStart = pos;
    const tagOpen = tagMatch[0];
    let depth = 1;
    pos += tagOpen.length;
    while (pos < inner.length) {
      const openM = inner.slice(pos).match(/^<([a-zA-Z0-9]+)[^>]*>/);
      const closeM = inner.slice(pos).match(/^<\/([a-zA-Z0-9]+)>/);
      if (openM) {
        if (!openM[0].endsWith('/>')) depth++;
        pos += openM[0].length;
      } else if (closeM) {
        depth--;
        if (depth === 0) {
          pos += closeM[0].length;
          children.push({
            tag: tagMatch[1].toLowerCase(),
            full: inner.slice(tagStart, pos),
            inner: inner.slice(tagStart + tagOpen.length, pos - closeM[0].length)
          });
          break;
        }
        pos += closeM[0].length;
      } else {
        const nextTag = inner.indexOf('<', pos + 1);
        pos = nextTag === -1 ? inner.length : nextTag;
      }
    }
  }
  return children;
}

/**
 * Helper: Extract Japanese sentence and translation from Jitendex example sentence container
 */
function extractFromExampleBlock(block) {
  if (!block) return { jp: '', vi: '' };
  let b = block;
  b = b.replace(/<div class="jlex-sc-attribution"[\s\S]*?<\/div>/gi, '');
  b = b.replace(/<a[^>]*>\[\d+\]<\/a>/gi, '');
  b = b.replace(/\[\d+\]/g, '');

  let jp = '';
  let vi = '';

  const langMatch = b.match(/<[^>]*lang="(?:en|vi)"[^>]*>([\s\S]*?)<\/(?:div|span|p)>/i);
  if (langMatch) {
    vi = langMatch[1].replace(/<[^>]*>/g, '').trim();
    b = b.replace(langMatch[0], '').trim();
  }

  const children = extractTopLevelChildrenBalanced(b);
  for (const child of children) {
    const textOnly = child.inner.replace(/<[^>]*>/g, '').trim();
    if (/<ruby>/i.test(child.inner) || /[\u3040-\u30ff\u4e00-\u9faf]/.test(textOnly)) {
      if (!jp) {
        jp = child.inner.trim();
      }
    } else if (textOnly.length > 2 && !vi && !textOnly.includes('JMdict') && !textOnly.includes('Tatoeba')) {
      vi = textOnly;
    }
  }

  if (!jp) {
    const innerText = b.replace(/^<[a-zA-Z0-9]+[^>]*>/, '').replace(/<\/[a-zA-Z0-9]+>\s*$/, '').trim();
    if (/<ruby>/i.test(innerText) || /[\u3040-\u30ff\u4e00-\u9faf]/.test(innerText.replace(/<[^>]*>/g, ''))) {
      jp = innerText;
    }
  }

  return { jp, vi };
}

/**
 * Check if a note already exists in the target Anki deck
 */
async function handleCheckNoteExists({ word, deckName }) {
  if (!word) return { exists: false };
  const cleanWord = word.trim();

  const config = await chrome.storage.local.get({
    ankiUrl: 'http://localhost:8765',
    deckName: 'Japanese_Learning'
  });

  const ankiUrl = config.ankiUrl || 'http://localhost:8765';
  const targetDeck = (deckName || config.deckName || 'Japanese_Learning').trim();

  try {
    const query = `deck:"${targetDeck}" "${cleanWord}"`;
    const res = await fetch(ankiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'findNotes',
        version: 6,
        params: { query }
      })
    });

    if (!res.ok) return { exists: false };
    const data = await res.json();
    const noteIds = data.result || [];
    if (noteIds.length === 0) {
      return { exists: false };
    }

    // Verify against note fields
    const resInfo = await fetch(ankiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'notesInfo',
        version: 6,
        params: { notes: noteIds.slice(0, 10) }
      })
    });

    if (resInfo.ok) {
      const dataInfo = await resInfo.json();
      const notes = dataInfo.result || [];
      for (const n of notes) {
        const fields = n.fields || {};
        for (const [key, valObj] of Object.entries(fields)) {
          const val = (valObj.value || '').trim();
          if (val === cleanWord) {
            return { exists: true, noteId: n.noteId };
          }
          const plain = val.replace(/<[^>]*>/g, '').trim();
          if (plain === cleanWord || plain.startsWith(cleanWord + '\n') || plain.startsWith(cleanWord + ' ')) {
            return { exists: true, noteId: n.noteId };
          }
        }
      }
    }

    return { exists: noteIds.length > 0, noteId: noteIds[0] };
  } catch (err) {
    console.warn('[Anki] checkNoteExists error:', err);
    return { exists: false };
  }
}

/**
 * Format and beautify the Meaning section:
 * - POS badges in English (Noun, Suru verb, Transitive verb...)
 * - Meanings list in modern numbered card items with circular accent badges (authentic English from Jitendex)
 * - Contextual example in a sleek callout card with ruby furigana and Vietnamese translation beneath
 * - Cleans any raw JMdict / Tatoeba or unformatted text
 */
async function formatBeautifiedMeaningHtml({ aiData, rawDefinition, word, reading, providedExample }) {
  let text = (rawDefinition || '').trim();

  // Strip attribution & citations
  text = stripBlocksByClass(text, 'jlex-sc-attribution');
  text = text.replace(/<div class="jlex-sc-attribution"[\s\S]*?<\/div>/gi, '');
  text = text.replace(/\[?JMdict\]?[^|\n]*\|\s*\[?Tatoeba\]?[^\n]*/gi, '');
  text = text.replace(/JMdict\s*\|\s*Tatoeba[^\n]*/gi, '');
  text = text.replace(/<a[^>]*>(?:JMdict|Tatoeba)<\/a>/gi, '');

  // Strip forms and frequency blocks completely so alternative kanji and forms headers never leak into definitions
  text = stripBlocksByClass(text, 'jlex-sc-forms');
  text = stripBlocksByClass(text, 'jlex-sc-frequency');

  const posList = [];
  const addPos = (name) => { if (name && !posList.includes(name)) posList.push(name); };

  // Detect POS in raw text (English badges)
  if (/(?:^|\s|<[^>]*>|[\d\W_])(?:noun|danh từ)(?:\s|<[^>]*>|[\d\W_]|$)/i.test(text)) addPos('Noun');
  if (/(?:^|\s|<[^>]*>|[\d\W_])(?:suru|vs)(?:\s|<[^>]*>|[\d\W_]|$)/i.test(text)) addPos('Suru verb');
  if (/(?:^|\s|<[^>]*>|[\d\W_])(?:transitive|vt|tha\s*động\s*từ|chuyển\s*tiếp)/i.test(text)) addPos('Transitive verb');
  if (/(?:^|\s|<[^>]*>|[\d\W_])(?:intransitive|vi|tự\s*động\s*từ|nội\s*động\s*từ)/i.test(text)) addPos('Intransitive verb');
  if (/(?:^|\s|<[^>]*>|[\d\W_])(?:adj-na|na-adjective)/i.test(text)) addPos('Na-adjective');
  else if (/(?:^|\s|<[^>]*>|[\d\W_])(?:adj-i|i-adjective)/i.test(text)) addPos('I-adjective');
  else if (/(?:^|\s|<[^>]*>|[\d\W_])(?:adjective|tính từ)/i.test(text)) addPos('Adjective');
  if (/(?:^|\s|<[^>]*>|[\d\W_])(?:adverb|adv|phó từ)/i.test(text)) addPos('Adverb');

  // Also check badge elements in HTML
  const badgeMatches = Array.from(text.matchAll(/(?:class="[^"]*pos-badge[^"]*"|data-content="partOfSpeech")[^>]*>([\s\S]*?)<\/(?:span|div)>/gi));
  badgeMatches.forEach((m) => {
    const formatted = formatPosToEnglish(m[1]);
    if (formatted) {
      formatted.split(' • ').forEach((p) => addPos(p));
    }
  });

  const examples = [];

  // Extract structured HTML example blocks using balanced tag scanning
  const { blocks: exBlocks, remaining: remainingAfterExamples } = extractExampleBlocks(text);
  text = remainingAfterExamples;

  for (const block of exBlocks) {
    const extracted = extractFromExampleBlock(block);
    if (extracted.jp) {
      let viTrans = extracted.vi;
      if (viTrans && !/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(viTrans)) {
        try {
          viTrans = await translateToVietnamese(viTrans, 'en');
        } catch (_) {}
      }
      examples.push({ jp: extracted.jp, vi: viTrans });
    }
  }

  // Extract <li> elements if any
  const liMatches = Array.from(text.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi));
  const rawItems = [];
  const remainingLines = text.split(/\r?\n|<br\s*\/?>/i)
    .map((l) => l.trim())
    .filter(Boolean);

  if (liMatches.length > 0) {
    liMatches.forEach((m) => {
      rawItems.push(m[1]);
    });
    // Check if remaining lines contain any Japanese example sentences that weren't inside example blocks
    if (examples.length === 0) {
      for (let i = 0; i < remainingLines.length; i++) {
        const line = remainingLines[i];
        const textOnly = line.replace(/<[^>]*>/g, '').trim();
        const hasJpChars = /[\u3040-\u30ff\u4e00-\u9faf]/.test(textOnly);
        const isJpSentence = (hasJpChars && (textOnly.length >= 8 || /[\u3040-\u30ff]/.test(textOnly))) || /<ruby>/i.test(line);
        if (isJpSentence) {
          const nextLine = remainingLines[i + 1] ? remainingLines[i + 1].replace(/<[^>]*>/g, '').trim() : '';
          let trans = '';
          if (nextLine && !/[\u3040-\u30ff\u4e00-\u9faf]/.test(nextLine) && nextLine.length > 2 && !nextLine.includes('JMdict') && !nextLine.includes('Tatoeba')) {
            trans = nextLine.replace(/\[\d+\]/g, '').trim();
            i++;
          }
          let viTrans = trans;
          if (viTrans && !/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(viTrans)) {
            try {
              viTrans = await translateToVietnamese(viTrans, 'en');
            } catch (_) {}
          }
          examples.push({ jp: line, vi: viTrans });
          break;
        }
      }
    }
  } else {
    // Process remaining lines when no <li> tags exist
    for (let i = 0; i < remainingLines.length; i++) {
      const line = remainingLines[i];
      const textOnly = line.replace(/<[^>]*>/g, '').trim();

      // Check if line is a Japanese example sentence
      const hasJpChars = /[\u3040-\u30ff\u4e00-\u9faf]/.test(textOnly);
      const isJpSentence = (hasJpChars && (textOnly.length >= 8 || /[\u3040-\u30ff]/.test(textOnly))) || /<ruby>/i.test(line);

      if (isJpSentence) {
        const nextLine = remainingLines[i + 1] ? remainingLines[i + 1].replace(/<[^>]*>/g, '').trim() : '';
        let trans = '';
        if (nextLine && !/[\u3040-\u30ff\u4e00-\u9faf]/.test(nextLine) && nextLine.length > 2 && !nextLine.includes('JMdict') && !nextLine.includes('Tatoeba')) {
          trans = nextLine.replace(/\[\d+\]/g, '').trim();
          i++; // skip translation line
        }
        let viTrans = trans;
        if (viTrans && !/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(viTrans)) {
          try {
            viTrans = await translateToVietnamese(viTrans, 'en');
          } catch (_) {}
        }
        examples.push({ jp: line, vi: viTrans });
        continue;
      }

      rawItems.push(line);
    }
  }

  // Clean each meaning item: strip pos badges and prefix keywords
  const cleanPosRegex = /^(?:<span[^>]*pos-badge[^>]*>[\s\S]*?<\/span>|<[^>]*data-content="partOfSpeech"[^>]*>[\s\S]*?<\/[^>]*>)/gi;
  const prefixKeywords = /^(?:noun|suru|vs|vt|vi|transitive|intransitive|adjective|adverb|danh từ|động từ\s+suru|động từ|tính từ|phó từ|tự động từ|tha động từ|chuyển\s*tiếp)[\s,•\.\-]*/gi;

  const meaningItems = [];
  rawItems.forEach((item) => {
    let s = item.replace(cleanPosRegex, '');
    s = s.replace(/<[^>]*>/g, '').trim();
    while (prefixKeywords.test(s)) {
      s = s.replace(prefixKeywords, '').trim();
    }
    s = s.replace(/^(?:[•\-\*]|\d+[\.\)])\s*/, '').trim();
    if (s && s.length > 1 && !s.includes('JMdict') && !s.includes('Tatoeba')) {
      meaningItems.push(s);
    }
  });

  // Fallback to AI data if dictionary was completely empty
  if (meaningItems.length === 0 && (aiData?.meanings_en || aiData?.meanings_vi)) {
    meaningItems.push(...(aiData.meanings_en || aiData.meanings_vi));
  }
  if (posList.length === 0 && (aiData?.pos_en || aiData?.pos_vi)) {
    (aiData.pos_en || aiData.pos_vi).split(/[•,]/).forEach((p) => addPos(p.trim()));
  }

  // Prioritize provided example from client, then aiData, then cache
  if (examples.length === 0) {
    if (providedExample && (providedExample.jp || providedExample.ex_ruby || providedExample.ex_furigana)) {
      examples.push({
        jp: ensureRubyFurigana(providedExample.jp || providedExample.ex_ruby || providedExample.ex_furigana),
        vi: providedExample.vi || providedExample.ex_vi || ''
      });
    } else if (aiData?.ex_ruby) {
      examples.push({ jp: ensureRubyFurigana(aiData.ex_ruby), vi: aiData.ex_vi || '' });
    } else if (word && aiExampleCache.has(word)) {
      const cached = aiExampleCache.get(word);
      if (cached?.ex_furigana) {
        examples.push({ jp: ensureRubyFurigana(cached.ex_furigana), vi: cached.ex_vi || '' });
      }
    }
  }

  // Build HTML Badges
  const posBadges = posList.map((s, idx) => {
    const bgColors = [
      'background:#eff6ff; color:#1e40af; border-color:#bfdbfe;',
      'background:#faf5ff; color:#6b21a8; border-color:#e9d5ff;',
      'background:#f0fdf4; color:#166534; border-color:#bbf7d0;',
      'background:#fff7ed; color:#9a3412; border-color:#fed7aa;'
    ];
    const style = bgColors[idx % bgColors.length];
    return `<span class="lab-pos-badge" style="display:inline-flex; align-items:center; ${style} font-size:13px; font-weight:700; padding:4px 12px; border-radius:9999px; border-width:1px; border-style:solid; box-shadow:0 1px 2px rgba(0,0,0,0.04); letter-spacing:0.02em;">${escapeHtml(s)}</span>`;
  }).join(' ');

  // Build HTML Meanings List
  const defsList = (meaningItems.length > 0 ? meaningItems : ['Definition'])
    .map((m, idx) => `
      <div class="lab-meaning-item" style="display:flex; align-items:flex-start; gap:12px; padding:10px 14px; background:var(--lab-surface, #ffffff); border:1px solid var(--lab-border, #e2e8f0); border-radius:10px; box-shadow:0 1px 3px rgba(0,0,0,0.03); margin-bottom:8px;">
        <span class="num-badge" style="display:inline-flex; justify-content:center; align-items:center; width:22px; height:22px; background:var(--lab-accent, #b54834); color:#ffffff; border-radius:50%; font-size:12px; font-weight:700; flex-shrink:0; margin-top:2px;">${idx + 1}</span>
        <span class="meaning-text" style="font-size:16px; font-weight:600; color:var(--lab-text, #1e293b); line-height:1.5;">${escapeHtml(m)}</span>
      </div>
    `)
    .join('');

  // Build HTML Example Cards
  const exampleSection = examples.length > 0 ? `
    <div class="lab-examples-container" style="margin-top: 16px;">
      ${examples.map((ex, idx) => `
        <div class="lab-example-card" style="margin-top: ${idx === 0 ? '0' : '12px'}; padding: 14px 18px; background: var(--lab-surface, #fffdf8); border: 1px solid var(--lab-border, #ebd8c8); border-left: 4px solid var(--lab-accent, #b54834); border-radius: 0 12px 12px 0; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
          <div class="example-title" style="font-size: 11px; font-weight: 800; color: var(--lab-accent, #b54834); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">
            Ví dụ ngữ cảnh ${examples.length > 1 ? `(${idx + 1})` : ''}
          </div>
          <div class="example-jp" style="font-size: 17px; font-weight: 600; line-height: 2; color: var(--lab-text, #1e293b); margin-bottom: 6px;">
            ${ensureRubyFurigana(ex.jp)}
          </div>
          ${ex.vi ? `
          <div class="example-vi" style="font-size: 14.5px; color: var(--lab-muted, #475569); font-style: italic; line-height: 1.55;">
            ${escapeHtml(ex.vi)}
          </div>` : ''}
        </div>
      `).join('')}
    </div>
  ` : '';

  return `
    ${posBadges ? `<div class="lab-pos-row" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px;">${posBadges}</div>` : ''}
    <div class="lab-meanings-list">${defsList}</div>
    ${exampleSection}
  `;
}

/**
 * Handle AnkiConnect export with Linguist Japanese Vocab Template, Native Audio Download & Stroke Order
 */
async function handleAddToAnki({ word, reading, hanviet, definition, example, aiExample, audioUrl }) {
  const config = await chrome.storage.local.get({
    ankiUrl: 'http://localhost:8765',
    deckName: 'Japanese_Learning',
    modelName: 'Japanese (Linguist)',
    fieldMap: {
      Word: 'Expression',
      Reading: 'Audio',
      HanViet: 'Kanji',
      Definition: 'Meaning',
      Example: 'Meaning',
      Audio: 'Audio'
    }
  });

  const ankiUrl = config.ankiUrl || 'http://localhost:8765';
  let deckName = config.deckName || 'Japanese_Learning';
  let modelName = config.modelName || 'Japanese (Linguist)';
  const fieldMap = config.fieldMap || {};

  const cleanWord = (word || '').trim();
  const cleanReading = (reading || cleanWord).trim();
  const cleanHanviet = (hanviet || '').trim();
  const cleanDefinition = (definition || '').trim();

  // Check duplicate before proceeding
  const existCheck = await handleCheckNoteExists({ word: cleanWord, deckName });
  if (existCheck.exists) {
    throw new Error(`Từ "${cleanWord}" đã tồn tại trong deck "${deckName}" của Anki.`);
  }

  const providedExample = aiExample || (example && typeof example === 'object' ? example : null);

  // 1. Analyze word via Gemini AI if no example provided and key is present
  let aiData = null;
  try {
    aiData = await handleGeminiAnalyzeWord({
      word: cleanWord,
      reading: cleanReading,
      definition: cleanDefinition
    });
  } catch (e) {
    console.warn('[Anki] Gemini word analysis skipped or failed:', e.message);
  }

  // 2. Construct Beautified Meaning HTML (English definitions & POS, Vietnamese translated example sentences)
  const meaningHtml = await formatBeautifiedMeaningHtml({
    aiData,
    rawDefinition: cleanDefinition,
    word: cleanWord,
    reading: cleanReading,
    providedExample
  });

  // 3. Build Kanji Stroke Order Cards with Self-Writing Animations matching Image 2
  const kanjiCardsHtml = await buildKanjiCardsHtml(cleanWord, aiData?.kanji_details || []);

  // 4. Query available models and decks from AnkiConnect
  let availableModels = [];
  try {
    const resM = await fetch(ankiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'modelNames', version: 6 })
    });
    if (resM.ok) {
      const dataM = await resM.json();
      availableModels = dataM.result || [];
    }
  } catch (e) {
    console.warn('[Anki] Could not fetch models list:', e);
  }

  // If modelName does not exist in Anki, pick first suitable available model
  if (availableModels.length > 0 && !availableModels.includes(modelName)) {
    modelName = availableModels.find((m) => /linguist|japan/i.test(m)) || availableModels[0];
  }

  // 5. Fetch actual field names of target model
  let modelFields = [];
  try {
    const resF = await fetch(ankiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'modelFieldNames', version: 6, params: { modelName } })
    });
    if (resF.ok) {
      const dataF = await resF.json();
      modelFields = dataF.result || [];
    }
  } catch (e) {
    console.warn('[Anki] Could not fetch model fields:', e);
  }

  // 6. Map fields intelligently based on model structure
  const fields = {};
  let targetAudioField = null;

  if (modelFields.length > 0) {
    const isLinguistStyle = modelFields.some((f) => /expression|meaning|kanji/i.test(f));

    if (isLinguistStyle) {
      // 5-field Linguist Note Type: Expression, Audio, Meaning, Kanji, Picture
      const expField = modelFields.find((f) => /expression|word|vocab/i.test(f)) || modelFields[0];
      const audioField = modelFields.find((f) => /audio|reading|sound/i.test(f));
      const meaningField = modelFields.find((f) => /meaning|definition|glossary/i.test(f));
      const kanjiField = modelFields.find((f) => /kanji|hanviet/i.test(f));
      const picField = modelFields.find((f) => /picture|image/i.test(f));

      if (expField) fields[expField] = cleanWord;
      if (audioField) {
        fields[audioField] = cleanReading && cleanReading !== cleanWord ? `【${cleanReading}】` : '';
        targetAudioField = audioField;
      }
      if (meaningField) {
        fields[meaningField] = meaningHtml;
      }
      if (kanjiField) {
        fields[kanjiField] = kanjiCardsHtml || cleanHanviet;
      }
      if (picField) {
        fields[picField] = '';
      }
    } else if (modelFields.length === 2) {
      // 2-field card (e.g. Basic: Front & Back) -> Embed full Linguist styling
      const frontField = modelFields[0];
      const backField = modelFields[1];
      targetAudioField = backField;

      fields[frontField] = `<main class="lab-shell lab-front" lang="ja" style="text-align:center; padding: 24px 14px; font-family: 'Noto Sans JP', sans-serif;">
  <div class="lab-kicker" style="color: #b54834; font-size: 12px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase;">Tiếng Nhật</div>
  <div class="lab-expression" style="font-size: 46px; font-weight: 700; font-family: 'Noto Serif JP', serif; margin: 10px 0; color: #1e3a8a;">${escapeHtml(cleanWord)}</div>
  <div class="lab-prompt" style="color: #746f66; font-size: 13px;">Ghi nhớ cách đọc và ý nghĩa</div>
</main>`;

      fields[backField] = `<main class="lab-shell lab-back" style="padding: 18px 12px; font-family: 'Noto Sans JP', sans-serif;">
  <header class="lab-answer" style="text-align: center; margin-bottom: 16px; padding: 18px; border: 1px solid #d9d1c4; border-radius: 18px; background: #fffdf8;">
    <div class="lab-kicker" style="color: #b54834; font-size: 11px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase;">Tiếng Nhật</div>
    <div class="lab-expression" lang="ja" style="font-size: 38px; font-weight: 700; font-family: 'Noto Serif JP', serif; margin: 4px 0; color: #1e3a8a;">${escapeHtml(cleanWord)}</div>
    ${cleanReading && cleanReading !== cleanWord ? `<div class="lab-reading" lang="ja" style="font-size: 18px; font-weight: 600; color: #b54834; margin-top: 4px;">【${escapeHtml(cleanReading)}】</div>` : ''}
  </header>

  <section class="lab-panel lab-meaning" style="margin-bottom: 14px; padding: 16px; border: 1px solid #d9d1c4; border-radius: 14px; background: #fffdf8;">
    <div class="lab-panel-title" style="color: #b54834; font-size: 11px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #d9d1c4;">Ý nghĩa &amp; Cách dùng</div>
    <div class="lab-content">
      ${meaningHtml}
    </div>
  </section>

  ${kanjiCardsHtml ? `
  <section class="lab-panel lab-kanji" style="padding: 14px 16px; border: 1px solid #d9d1c4; border-radius: 14px; background: #fffdf8;">
    <div class="lab-panel-title" style="color: #b54834; font-size: 11px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #d9d1c4;">Cấu tạo Hán tự &amp; Cách viết nét</div>
    <div class="lab-content">
      ${kanjiCardsHtml}
    </div>
  </section>` : ''}
</main>`;
    } else {
      // Custom multi-field model
      for (const f of modelFields) {
        const lower = f.toLowerCase();
        if (/word|expression|vocab/i.test(lower)) fields[f] = cleanWord;
        else if (/reading|kana|furigana/i.test(lower)) {
          fields[f] = cleanReading;
          if (!targetAudioField) targetAudioField = f;
        } else if (/hanviet|han-viet|kanji/i.test(lower)) fields[f] = kanjiCardsHtml || cleanHanviet;
        else if (/meaning|definition|glossary/i.test(lower)) fields[f] = meaningHtml;
        else if (/audio|sound/i.test(lower)) targetAudioField = f;
      }
    }

    // Guarantee first field is NEVER empty
    if (!fields[modelFields[0]]) {
      fields[modelFields[0]] = cleanWord;
    }
  } else {
    // Fallback if no model fields returned
    fields['Front'] = cleanWord;
    fields['Back'] = `${cleanReading}<br>${meaningHtml}${kanjiCardsHtml ? `<br>${kanjiCardsHtml}` : ''}`;
    targetAudioField = 'Back';
  }

  const payload = {
    action: 'addNote',
    version: 6,
    params: {
      note: {
        deckName,
        modelName,
        fields,
        options: {
          allowDuplicate: false,
          duplicateScope: 'deck'
        },
        tags: ['j-lexicon-ai']
      }
    }
  };

  // 7. Download audio directly into Anki Media collection via AnkiConnect native audio downloader
  if (audioUrl && targetAudioField) {
    payload.params.note.audio = [
      {
        url: audioUrl,
        filename: `jlex_${encodeURIComponent(cleanWord)}_${Date.now()}.mp3`,
        fields: [targetAudioField]
      }
    ];
  }

  const response = await fetch(ankiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`AnkiConnect HTTP Error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  if (result.error) {
    throw new Error(`AnkiConnect: ${result.error}`);
  }

  return { noteId: result.result };
}

/**
 * Setup Linguist Japanese Vocab Note Type in Anki
 */
const LINGUIST_FRONT_HTML = `<main class="lab-shell lab-front" lang="ja">
  <div class="lab-kicker">Tiếng Nhật</div>
  <div class="lab-expression">{{Expression}}</div>
  <div class="lab-prompt">Ghi nhớ cách đọc và ý nghĩa</div>
</main>`;

const LINGUIST_BACK_HTML = `<main class="lab-shell lab-back">
  <header class="lab-answer">
    <div class="lab-kicker">Tiếng Nhật</div>
    <div class="lab-expression" lang="ja">{{Expression}}</div>
    {{#Audio}}
    <div class="lab-reading" lang="ja">{{Audio}}</div>
    {{/Audio}}
  </header>

  {{#Picture}}
  <section class="lab-picture" aria-label="Meaning image">
    {{Picture}}
  </section>
  {{/Picture}}

  {{#Meaning}}
  <section class="lab-panel lab-meaning">
    <div class="lab-panel-title">Ý nghĩa &amp; Cách dùng</div>
    <div class="lab-content">{{Meaning}}</div>
  </section>
  {{/Meaning}}

  {{#Kanji}}
  <section class="lab-panel lab-kanji">
    <div class="lab-panel-title">Cấu tạo Hán tự &amp; Cách viết nét (Hán-Việt)</div>
    <div class="lab-content">{{Kanji}}</div>
  </section>
  {{/Kanji}}
</main>`;

const LINGUIST_CSS = `.card {
  --lab-bg: #f4f1ea;
  --lab-surface: #fffdf8;
  --lab-surface-soft: #ebe6dc;
  --lab-text: #25231f;
  --lab-muted: #746f66;
  --lab-accent: #b54834;
  --lab-accent-soft: #f1d8d1;
  --lab-border: #d9d1c4;
  --lab-shadow: 0 18px 50px rgba(50, 42, 31, .12);
  box-sizing: border-box;
  min-height: 100%;
  margin: 0;
  padding: 24px 14px;
  overflow-wrap: anywhere;
  background: var(--lab-bg);
  color: var(--lab-text);
  font-family: "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
  font-size: 18px;
  line-height: 1.58;
  text-align: left;
}

.nightMode {
  --lab-bg: #171715;
  --lab-surface: #23221f;
  --lab-surface-soft: #2d2b27;
  --lab-text: #efebe3;
  --lab-muted: #aaa397;
  --lab-accent: #ef8f79;
  --lab-accent-soft: #4a2b25;
  --lab-border: #46423b;
  --lab-shadow: 0 18px 50px rgba(0, 0, 0, .3);
}

*, *::before, *::after { box-sizing: border-box; }

.lab-shell {
  width: min(100%, 760px);
  margin: 0 auto;
}

.lab-front {
  min-height: min(68vh, 560px);
  display: grid;
  place-content: center;
  text-align: center;
}

.lab-kicker,
.lab-panel-title {
  color: var(--lab-accent);
  font-size: .72rem;
  font-weight: 800;
  letter-spacing: .14em;
  text-transform: uppercase;
}

.lab-expression {
  margin: .14em 0;
  color: var(--lab-text);
  font-family: "Noto Serif JP", "Yu Mincho", serif;
  font-size: clamp(3rem, 11vw, 6.2rem);
  font-weight: 700;
  line-height: 1.14;
  letter-spacing: .035em;
}

.lab-prompt {
  margin-top: 18px;
  color: var(--lab-muted);
  font-size: .82rem;
}

.lab-answer {
  margin-bottom: 18px;
  padding: 26px 24px 20px;
  border: 1px solid var(--lab-border);
  border-radius: 22px;
  background: var(--lab-surface);
  box-shadow: var(--lab-shadow);
  text-align: center;
}

.lab-answer .lab-expression {
  font-size: clamp(2.4rem, 9vw, 5rem);
}

.lab-reading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 40px;
  color: var(--lab-accent);
  font-size: 1.18rem;
  font-weight: 650;
}

.lab-reading .replay-button,
.lab-reading .soundLink {
  margin: 0;
}

.lab-reading .replay-button svg {
  width: 30px;
  height: 30px;
}

.lab-picture {
  display: flex;
  justify-content: center;
  margin: 0 0 18px;
  padding: 12px;
  border: 1px solid var(--lab-border);
  border-radius: 22px;
  background: var(--lab-surface);
  box-shadow: var(--lab-shadow);
}

.lab-picture img {
  display: block;
  width: auto;
  max-width: 100%;
  max-height: min(46vh, 430px);
  border-radius: 14px;
  object-fit: contain;
}

.lab-panel {
  margin: 0 0 18px;
  padding: 20px 22px;
  border: 1px solid var(--lab-border);
  border-radius: 18px;
  background: var(--lab-surface);
  box-shadow: var(--lab-shadow);
}

.lab-panel-title {
  margin-bottom: 13px;
  padding-bottom: 9px;
  border-bottom: 1px solid var(--lab-border);
}

.lab-content > :first-child { margin-top: 0 !important; }
.lab-content > :last-child { margin-bottom: 0 !important; }

.lab-content [data-source="llm"] {
  margin-top: 12px !important;
  padding: 11px 13px;
  border-left: 3px solid var(--lab-accent);
  border-radius: 0 9px 9px 0;
  background: var(--lab-accent-soft);
  color: var(--lab-text) !important;
}

.lab-content ol { margin-bottom: 0 !important; }
.lab-content li { padding-left: 3px; }

ruby {
  ruby-align: center;
}

rt {
  font-size: 0.62em;
  color: var(--lab-muted);
  user-select: none;
  font-family: "Noto Sans JP", sans-serif;
  font-weight: 500;
  line-height: 1;
}

/* Pos tags & pill badges */
.lab-pos-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.lab-pos-badge {
  display: inline-flex;
  align-items: center;
  font-size: 13px;
  font-weight: 700;
  padding: 4px 12px;
  border-radius: 9999px;
  border-width: 1px;
  border-style: solid;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .04);
  letter-spacing: .02em;
}

/* Meaning items list */
.lab-meanings-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.lab-meaning-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 14px;
  background: var(--lab-surface, #ffffff);
  border: 1px solid var(--lab-border, #e2e8f0);
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .03);
}

.lab-meaning-item .num-badge {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 22px;
  height: 22px;
  background: var(--lab-accent, #b54834);
  color: #ffffff;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 2px;
}

.lab-meaning-item .meaning-text {
  font-size: 16px;
  font-weight: 600;
  color: var(--lab-text, #1e293b);
  line-height: 1.5;
}

/* Contextual Example Callout */
.lab-example-card {
  margin-top: 16px;
  padding: 14px 18px;
  background: var(--lab-surface, #fffdf8);
  border: 1px solid var(--lab-border, #ebd8c8);
  border-left: 4px solid var(--lab-accent, #b54834) !important;
  border-radius: 0 12px 12px 0;
  box-shadow: 0 2px 6px rgba(0, 0, 0, .03);
}

.lab-example-card .example-title {
  font-size: 11px;
  font-weight: 800;
  color: var(--lab-accent, #b54834);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 6px;
}

.lab-example-card .example-jp {
  font-size: 17px;
  font-weight: 600;
  line-height: 2;
  color: var(--lab-text, #1e293b);
  margin-bottom: 6px;
}

.lab-example-card .example-vi {
  font-size: 14.5px;
  color: var(--lab-muted, #475569);
  font-style: italic;
  line-height: 1.55;
}

/* Kanji Card & Self-writing Diagram */
.lab-kanji-card {
  background: var(--lab-surface, #ffffff);
  border: 1px solid var(--lab-border, #e2e8f0);
  border-radius: 16px;
  padding: 16px 18px;
  margin-bottom: 16px;
  box-shadow: var(--lab-shadow, 0 3px 10px rgba(0, 0, 0, .04));
}

.btn-replay-stroke {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1d4ed8;
  font-size: 11.5px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all .2s ease;
}

.btn-replay-stroke:hover {
  background: #dbeafe;
}

.lab-kanji-diagram {
  display: flex;
  justify-content: center;
  align-items: center;
  background: #ffffff;
  border: 1px solid var(--lab-border, #e2e8f0);
  border-radius: 12px;
  padding: 8px;
  width: 160px;
  height: 160px;
  margin: 0 auto 8px;
  cursor: pointer;
  transition: transform .15s ease;
}

.lab-kanji-diagram:hover {
  transform: scale(1.02);
}

.lab-kanji-diagram svg {
  display: block;
  width: 100%;
  height: 100%;
}

/* Dark Mode (.nightMode) */
.nightMode .lab-pos-badge {
  background: #2d2b27 !important;
  color: #ef8f79 !important;
  border-color: #46423b !important;
}

.nightMode .lab-meaning-item {
  background: #23221f !important;
  border-color: #46423b !important;
}

.nightMode .lab-meaning-item .num-badge {
  background: #ef8f79 !important;
  color: #171715 !important;
}

.nightMode .lab-meaning-item .meaning-text {
  color: #efebe3 !important;
}

.nightMode .lab-example-card {
  background: #23221f !important;
  border-color: #46423b !important;
  border-left-color: #ef8f79 !important;
}

.nightMode .lab-example-card .example-jp {
  color: #efebe3 !important;
}

.nightMode .lab-example-card .example-vi {
  color: #aaa397 !important;
}

.nightMode .btn-replay-stroke {
  background: #2d2b27 !important;
  border-color: #46423b !important;
  color: #ef8f79 !important;
}

.nightMode .lab-kanji-diagram {
  background: #23221f !important;
  border-color: #46423b !important;
}

.nightMode .lab-kanji-diagram line {
  stroke: #46423b !important;
}

.nightMode .lab-kanji-diagram .ghost-strokes path {
  stroke: #383530 !important;
}

a { color: var(--lab-accent); }

@media (max-width: 520px) {
  .card { padding: 14px 9px; font-size: 16px; }
  .lab-answer { padding: 21px 14px 16px; border-radius: 17px; }
  .lab-panel { padding: 17px 14px; border-radius: 15px; }
  .lab-picture { padding: 8px; border-radius: 15px; }
}`;

async function handleSetupLinguistAnkiModel({ ankiUrl = 'http://localhost:8765' }) {
  const modelName = 'Japanese (Linguist)';
  const fields = ['Expression', 'Audio', 'Meaning', 'Kanji', 'Picture'];

  // Check if model already exists
  const resM = await fetch(ankiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'modelNames', version: 6 })
  });
  const dataM = await resM.json();
  const existingModels = dataM.result || [];

  if (!existingModels.includes(modelName)) {
    // Create new model
    const resCreate = await fetch(ankiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'createModel',
        version: 6,
        params: {
          modelName,
          inOrderFields: fields,
          css: LINGUIST_CSS,
          cardTemplates: [
            {
              Name: 'Card 1',
              Front: LINGUIST_FRONT_HTML,
              Back: LINGUIST_BACK_HTML
            }
          ]
        }
      })
    });
    const createData = await resCreate.json();
    if (createData.error) throw new Error(createData.error);
  } else {
    // Update existing model templates & styling
    await fetch(ankiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateModelTemplates',
        version: 6,
        params: {
          model: {
            name: modelName,
            templates: {
              'Card 1': {
                Front: LINGUIST_FRONT_HTML,
                Back: LINGUIST_BACK_HTML
              }
            }
          }
        }
      })
    });

    await fetch(ankiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateModelStyling',
        version: 6,
        params: {
          model: {
            name: modelName,
            css: LINGUIST_CSS
          }
        }
      })
    });
  }

  // Update extension settings to use this model
  await chrome.storage.local.set({
    modelName: modelName,
    fieldMap: {
      Word: 'Expression',
      Reading: 'Audio',
      HanViet: 'Kanji',
      Definition: 'Meaning',
      Example: 'Meaning',
      Audio: 'Audio'
    }
  });

  return { success: true, modelName, fields };
}

/**
 * Get field names for a specific Anki model
 */
async function handleGetAnkiModelFields({ ankiUrl, modelName }) {
  const url = ankiUrl || 'http://localhost:8765';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'modelFieldNames', version: 6, params: { modelName } })
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.result || [];
  } catch (_) {
    return [];
  }
}

/**
 * Test AnkiConnect connection
 */
async function handleTestAnki({ ankiUrl, modelName }) {
  const url = ankiUrl || 'http://localhost:8765';
  
  const resVer = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'version', version: 6 })
  });

  if (!resVer.ok) {
    throw new Error(`Không thể kết nối AnkiConnect (${resVer.status})`);
  }

  const verData = await resVer.json();
  if (verData.error) throw new Error(verData.error);

  const resDecks = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'deckNames', version: 6 })
  });
  const decksData = await resDecks.json();

  const resModels = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'modelNames', version: 6 })
  });
  const modelsData = await resModels.json();

  const decks = decksData.result || [];
  const models = modelsData.result || [];

  const targetModel = modelName || (models.includes('Japanese (Linguist)') ? 'Japanese (Linguist)' : models[0] || '');
  let modelFields = [];
  if (targetModel) {
    modelFields = await handleGetAnkiModelFields({ ankiUrl: url, modelName: targetModel });
  }

  return {
    version: verData.result,
    decks: decks,
    models: models,
    currentModel: targetModel,
    modelFields: modelFields
  };
}

/**
 * Test Gemini API connection
 */
async function handleTestGemini({ apiKey, model = 'gemini-3.6-flash' }) {
  if (!apiKey) throw new Error('Vui lòng nhập API Key');

  // Fetch available models first
  const availableModels = await fetchAvailableGeminiModels(apiKey);
  const availableNames = availableModels.map((m) => m.name);

  let targetModel = (model || 'gemini-3.6-flash').trim().replace(/^models\//, '');
  if (
    !targetModel ||
    targetModel.startsWith('gemma-') ||
    targetModel === 'gemini-2.0-flash' ||
    targetModel === 'gemini-2.0-flash-lite' ||
    targetModel === 'gemini-2.5-flash' ||
    targetModel === 'gemini-3.1-pro-preview'
  ) {
    if (availableNames.includes('gemini-3.6-flash')) {
      targetModel = 'gemini-3.6-flash';
    } else if (availableNames.length > 0) {
      targetModel = availableNames[0];
    } else {
      targetModel = 'gemini-3.6-flash';
    }
  }

  const testBody = {
    contents: [{ parts: [{ text: 'Trả lời ngắn gọn "OK" nếu bạn nhận được tin nhắn này.' }] }]
  };

  let responseText = 'OK';
  try {
    console.log(`[Gemini Test] Testing model: ${targetModel}`);
    const data = await callGeminiApi(apiKey, targetModel, testBody);
    responseText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'OK';
  } catch (err) {
    console.warn(`[Gemini Test] Model ${targetModel} failed:`, err.message);
    // If targetModel failed or is no longer available, try gemini-3.6-flash or other genuine available Gemini models
    let fallbackWorked = false;
    const fallbackCandidates = ['gemini-3.6-flash', ...availableNames].filter(
      (m, idx, arr) => m && m !== targetModel && arr.indexOf(m) === idx
    );

    for (const cand of fallbackCandidates) {
      try {
        console.log(`[Gemini Test] Trying fallback candidate: ${cand}`);
        const fallbackData = await callGeminiApi(apiKey, cand, testBody);
        responseText = fallbackData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'OK';
        targetModel = cand;
        fallbackWorked = true;
        break;
      } catch (_) {}
    }

    if (!fallbackWorked) {
      throw err;
    }
  }

  await chrome.storage.local.set({ geminiModel: targetModel });

  return {
    response: responseText,
    usedModel: targetModel,
    availableModels
  };
}

/**
 * Get database statistics
 */
async function handleGetStats() {
  const stats = await dictDB.getStats();
  const config = await chrome.storage.local.get(['geminiApiKey', 'deckName', 'modelName']);
  return {
    ...stats,
    hasGeminiKey: Boolean(config.geminiApiKey),
    deckName: config.deckName || 'Japanese_Learning',
    modelName: config.modelName || 'Japanese (Linguist)'
  };
}

/**
 * Clear database
 */
async function handleClearDatabase() {
  await dictDB.clearDatabase();
  return await dictDB.getStats();
}
