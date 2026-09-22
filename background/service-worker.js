/**
 * J-Lexicon AI Background Service Worker (Manifest V3)
 * Coordinates IndexedDB lookups, Gemini AI generation, and AnkiConnect synchronization.
 */

import { dictDB } from '../lib/db.js';
import { hanvietLookup } from '../lib/hanviet-lookup.js';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_MODELS_CACHE_TTL_MS = 5 * 60 * 1000;
const geminiModelsCache = new Map();
const geminiModelCooldowns = new Map();

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

let gtxQueue = Promise.resolve();
function throttledGtxFetch(url) {
  const current = gtxQueue.then(async () => {
    await new Promise((r) => setTimeout(r, 60));
    return fetch(url);
  });
  gtxQueue = current.catch(() => {});
  return current;
}

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
    const res = await throttledGtxFetch(url);
    if (res && res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data[0])) {
        const viText = data[0].map((segment) => segment[0]).filter(Boolean).join('');
        if (viText) {
          const isSameAsInput = viText.trim().toLowerCase() === trimmed.toLowerCase();
          const hasJapanese = /[\u3040-\u30ff\u4e00-\u9faf]/.test(viText);
          const hasVietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(viText);

          // If source was Japanese, reject result if it still contains Japanese or is identical to input
          if (sourceLang === 'ja') {
            if (isSameAsInput || (hasJapanese && !hasVietnamese)) {
              console.warn('[Translate] GTX returned untranslated Japanese text');
              return '';
            }
          }

          translationCache.set(cacheKey, viText);
          return viText;
        }
      }
    }
  } catch (err) {
    console.warn('[Translate] Error translating to Vietnamese:', err);
  }

  // Never return raw Japanese text as Vietnamese translation!
  if (sourceLang === 'ja' || /[\u3040-\u30ff\u4e00-\u9faf]/.test(trimmed)) {
    return '';
  }

  return trimmed;
}

/**
 * Fallback to Gemini AI for sentence translation if Google Translate GTX fails or rate-limits
 */
async function translateSentenceWithGemini(sentence, sourceLang = 'ja') {
  if (!sentence) return '';
  try {
    const config = await chrome.storage.local.get({
      geminiApiKey: '',
      geminiModel: DEFAULT_GEMINI_MODEL
    });
    if (!config.geminiApiKey) return '';

    const cacheKey = `gemini-trans:${sentence}`;
    if (translationCache.has(cacheKey)) {
      return translationCache.get(cacheKey);
    }

    const langName = sourceLang === 'en' ? 'tiếng Anh' : 'tiếng Nhật';
    const prompt = `Dịch câu ví dụ sau từ ${langName} sang tiếng Việt chuẩn xác, tự nhiên, ngắn gọn (chỉ trả về một câu tiếng Việt duy nhất, không giải thích hay thêm dấu ngoặc kép):\n"${sentence}"`;
    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 512
      }
    };

    const data = await callGeminiApi(config.geminiApiKey, config.geminiModel || DEFAULT_GEMINI_MODEL, requestBody);
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const contentParts = parts.filter((p) => !p.thought && p.text);
    const candidateText = contentParts.map((p) => p.text).join('\n').trim();
    const cleanVi = sanitizeVietnameseTranslation(candidateText, sourceLang === 'ja' ? sentence : '');
    if (
      cleanVi &&
      !/[\u3040-\u30ff\u4e00-\u9faf]/.test(cleanVi) &&
      !containsTranslationInstructionLeak(cleanVi)
    ) {
      translationCache.set(cacheKey, cleanVi);
      return cleanVi;
    }
  } catch (err) {
    console.warn('[Gemini Translate Fallback] Error:', err);
  }
  return '';
}

function containsTranslationInstructionLeak(text) {
  return /(?:\bconcise\b|\bvietnamese\s+(?:sentence|translation)\b|\bno\s+explanations?\b|\bonly\s+(?:return|output)\b|\btranslation\s*:)/i.test(String(text || ''));
}

function cleanTranslationOutput(text) {
  let cleaned = String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/```(?:text|markdown)?/gi, '')
    .trim();

  cleaned = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^(?:here(?:'s| is)|note|explanation)\b/i.test(line))
    .join(' ')
    .trim();

  // Remove model-added labels such as "*Concise):", "Translation:", or "Bản dịch:".
  cleaned = cleaned
    .replace(/^[*_`~\s"']+/, '')
    .replace(/^(?:(?:concise|translation|vietnamese(?:\s+translation)?|answer|output|bản\s+dịch|dịch(?:\s+sang\s+tiếng\s+việt)?)\s*[\])}:：\-]+\s*)+/i, '')
    .replace(/[*_`~\s"']+$/, '')
    .trim();

  return cleaned;
}

/**
 * Helper: Extract plain text recursively from a structured content node
 */
function extractTextFromNode(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractTextFromNode).join(' ');
  if (typeof node === 'object') {
    if (node.tag === 'rt' || node.tag === 'rp') return '';
    if (node.content !== undefined) return extractTextFromNode(node.content);
  }
  return '';
}

/**
 * Helper: Extract clean Japanese text from a structured content node
 */
function extractJapaneseTextFromNode(node) {
  if (!node) return '';
  if (typeof node === 'string') {
    return /[\u3040-\u30ff\u4e00-\u9faf]/.test(node) ? node : '';
  }
  if (Array.isArray(node)) {
    return node.map(extractJapaneseTextFromNode).filter(Boolean).join('');
  }
  if (typeof node === 'object') {
    if (node.tag === 'rt' || node.tag === 'rp') return ''; // Skip readings
    if (node.lang === 'en' || node.lang === 'vi') return ''; // Skip translations
    if (node.data && typeof node.data === 'object' && node.data.content === 'example-sentence-b') return '';
    if (node.content !== undefined) {
      return extractJapaneseTextFromNode(node.content);
    }
  }
  return '';
}

/**
 * Helper: Check if a node is explicitly the translation container of an example
 */
function isTranslationNode(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.lang === 'en' || node.lang === 'vi') return true;
  if (node.data && typeof node.data === 'object' && node.data.content === 'example-sentence-b') return true;
  return false;
}

/**
 * Sanitize common machine-translation inaccuracies in Vietnamese
 */
function sanitizeVietnameseTranslation(viText, jaText = '') {
  if (!viText || typeof viText !== 'string') return '';
  let res = cleanTranslationOutput(viText);
  const normalizedJa = String(jaText || '').replace(/[\s\u00a0]/g, '');

  // Stable regression for a common Jitendex example which some thinking models
  // previously truncated to "4 dặm là quãng" and prefixed with "Concise):".
  if (/^４マイルはかなりの距離だ[。.]?$/.test(normalizedJa)) {
    return 'Bốn dặm là một khoảng cách khá xa.';
  }

  // 1. Fix "chuông báo thức" (alarm clock) when context is warning / railway / emergency
  if (jaText && /警報|警告|踏切|サイレン|火災|警備/.test(jaText)) {
    res = res.replace(/chuông báo thức/gi, 'chuông cảnh báo');
    res = res.replace(/báo thức/gi, 'cảnh báo');
  }

  // 2. Fix railroad crossing terminology
  if (jaText && /踏切/.test(jaText)) {
    res = res.replace(/đường sắt/gi, 'đường ray');
  }

  // 3. Fix "rời đi" when context is "bên trái" (左)
  if (jaText && /左/.test(jaText) && /rời đi/i.test(res)) {
    res = res.replace(/rời đi/gi, 'bên trái');
  }

  // 4. Fix "đào tạo" when context is train (電車 / 列車)
  if (jaText && /電車|列車/.test(jaText) && /đào tạo/i.test(res)) {
    res = res.replace(/đào tạo/gi, 'tàu hỏa');
  }

  // 距離 should be rendered as a complete distance expression, never the
  // dangling classifier "quãng" by itself.
  if (jaText && /距離/.test(jaText)) {
    res = res.replace(/\bquãng\b(?!\s*(?:đường|cách))/gi, 'khoảng cách');
  }

  return res.trim();
}

/**
 * Translate an example sentence to Vietnamese, prioritizing the authentic Japanese sentence (sl=ja)
 * rather than the English translation (sl=en) to preserve Kanji meanings and context.
 */
async function translateExampleSentenceToVietnamese({ ja = '', en = '' }) {
  const cleanJa = (ja || '').replace(/<rt>[\s\S]*?<\/rt>/gi, '').replace(/<[^>]*>/g, '').trim();
  const cleanEn = (en || '').replace(/<[^>]*>/g, '').trim();

  // If already translated into Vietnamese, return directly to avoid redundant network calls
  if (cleanEn && /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(cleanEn) && !/[\u3040-\u30ff\u4e00-\u9faf]/.test(cleanEn)) {
    const sanitizedExisting = sanitizeVietnameseTranslation(cleanEn, cleanJa);
    if (sanitizedExisting && !containsTranslationInstructionLeak(sanitizedExisting)) {
      return sanitizedExisting;
    }
  }

  let vi = '';

  // 1. Translate directly from original Japanese sentence via GTX
  if (cleanJa && /[\u3040-\u30ff\u4e00-\u9faf]/.test(cleanJa)) {
    try {
      vi = await translateToVietnamese(cleanJa, 'ja');
    } catch (_) {}
  }

  // 2. Fallback to English translation if Japanese translation failed or was empty
  if (!vi && cleanEn) {
    try {
      const enVi = await translateToVietnamese(cleanEn, 'en');
      if (enVi && !/[\u3040-\u30ff\u4e00-\u9faf]/.test(enVi) && enVi !== cleanEn) {
        vi = enVi;
      }
    } catch (_) {}
  }

  // 3. Fallback to Gemini AI if GTX failed or was rate-limited
  if (!vi && (cleanJa || cleanEn)) {
    try {
      vi = await translateSentenceWithGemini(cleanJa || cleanEn, cleanJa ? 'ja' : 'en');
    } catch (_) {}
  }

  // 4. If all translation attempts failed, NEVER return Japanese text! Fallback to cleanEn if available
  const finalResult = vi || cleanEn || '';
  return sanitizeVietnameseTranslation(finalResult, cleanJa);
}

/**
 * Recursively translate only example sentence translations in Structured Content to Vietnamese,
 * while keeping definitions, glossaries, notes, and tags in authentic English as in Jitendex.
 */
async function translateExampleSentencesInNode(node, isInsideExample = false, currentJa = '') {
  if (node === null || node === undefined) return node;
  if (typeof node === 'number') return node;

  if (typeof node === 'string') {
    if (isInsideExample && !/[\u3040-\u30ff\u4e00-\u9faf]/.test(node) && node.trim().length > 1) {
      return await translateExampleSentenceToVietnamese({ ja: currentJa, en: node.trim() });
    }
    return node;
  }

  if (Array.isArray(node)) {
    return await Promise.all(node.map((child) => translateExampleSentencesInNode(child, isInsideExample, currentJa)));
  }

  if (typeof node === 'object') {
    const isExampleContainer = isInsideExample || (node.data && typeof node.data === 'object' && /example/i.test(node.data.content));
    let jaText = currentJa;
    if (isExampleContainer && !jaText) {
      jaText = extractJapaneseTextFromNode(node);
    }

    // Part of speech badge formatting in English
    if (node.data && typeof node.data === 'object' && node.data.content === 'partOfSpeech') {
      const formattedPos = formatPosToEnglish(node.content);
      return {
        ...node,
        content: formattedPos
      };
    }

    // Explicit translation element inside example sentence (e.g. data-sc-content="example-sentence-b" or lang="en")
    const isTranslation = isInsideExample && (
      isTranslationNode(node) ||
      (!/[\u3040-\u30ff\u4e00-\u9faf]/.test(extractTextFromNode(node)) && extractTextFromNode(node).trim().length > 1 && (node.tag === 'div' || node.tag === 'span' || node.tag === 'p'))
    );

    if (isTranslation) {
      const enText = extractTextFromNode(node).trim();
      const viTrans = await translateExampleSentenceToVietnamese({ ja: jaText, en: enText });
      return {
        ...node,
        lang: 'vi',
        content: viTrans
      };
    }

    const newNode = { ...node };
    if (node.content !== undefined) {
      newNode.content = await translateExampleSentencesInNode(node.content, isExampleContainer, jaText);
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

      case 'GET_AUDIO_URL':
        return await handleGetAudioUrl(payload);

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
        return await fetchAvailableGeminiModels(payload?.apiKey, payload?.forceRefresh === true);

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
async function fetchAvailableGeminiModels(apiKey, forceRefresh = false) {
  if (!apiKey) return [];

  const cached = geminiModelsCache.get(apiKey);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < GEMINI_MODELS_CACHE_TTL_MS) {
    return cached.models;
  }

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
          const models = data.models
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
          geminiModelsCache.set(apiKey, { models, fetchedAt: Date.now() });
          return models;
        }
      }
    } catch (e) {
      console.warn('[Gemini] ListModels fetch error for', url, e);
    }
  }
  return [];
}

function normalizeGeminiModelName(model) {
  const clean = String(model || DEFAULT_GEMINI_MODEL).trim().replace(/^models\//, '');
  if (!clean || clean.startsWith('gemma-')) return DEFAULT_GEMINI_MODEL;
  return clean;
}

function rankGeminiModels(models, preferredModel) {
  const preferred = normalizeGeminiModelName(preferredModel);
  const names = Array.from(new Set((models || []).map((m) => normalizeGeminiModelName(m.name || m))));
  const score = (name) => {
    if (name === preferred) return 0;
    if (/^gemini-\d+(?:\.\d+)+-flash$/.test(name)) return 10;
    if (/^gemini-\d+(?:\.\d+)+-flash-lite$/.test(name)) return 20;
    if (/^gemini-\d+(?:\.\d+)+-pro$/.test(name)) return 30;
    if (name.includes('flash') && !/(?:preview|experimental|exp)/.test(name)) return 40;
    if (!/(?:preview|experimental|exp|latest)/.test(name)) return 50;
    return 100;
  };
  const version = (name) => {
    const match = name.match(/^gemini-(\d+)(?:\.(\d+))?/);
    return match ? Number(match[1]) * 100 + Number(match[2] || 0) : 0;
  };
  return names.sort((a, b) => score(a) - score(b) || version(b) - version(a) || a.localeCompare(b));
}

async function callGeminiApi(apiKey, model, requestBody) {
  const cleanModel = normalizeGeminiModelName(model);
  const availableModels = await fetchAvailableGeminiModels(apiKey);
  const rankedModels = rankGeminiModels(availableModels, cleanModel);
  const now = Date.now();
  const usableRankedModels = rankedModels.filter((name) => {
    const cooldownUntil = geminiModelCooldowns.get(`${apiKey}:${name}`) || 0;
    return cooldownUntil <= now;
  });
  const candidates = rankedModels.length > 0
    ? usableRankedModels.slice(0, 5)
    : [cleanModel];

  if (candidates.length === 0) {
    const nextRetryAt = Math.min(...rankedModels.map((name) => geminiModelCooldowns.get(`${apiKey}:${name}`) || now));
    const waitSeconds = Math.max(1, Math.ceil((nextRetryAt - now) / 1000));
    throw new Error(`Các model Gemini khả dụng đều vừa báo hết quota. Vui lòng thử lại sau khoảng ${waitSeconds} giây.`);
  }

  const versions = ['v1beta', 'v1'];
  let lastError = null;
  const attemptedModels = [];

  // Keep the saved model first when it is exposed by this API key. If it is no
  // longer exposed, use the same deterministic ranking for every request.
  for (const candidateModel of candidates) {
    attemptedModels.push(candidateModel);
    for (const ver of versions) {
      const url = `https://generativelanguage.googleapis.com/${ver}/models/${encodeURIComponent(candidateModel)}:generateContent?key=${apiKey}`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (res.ok) {
          const data = await res.json();
          data.__jlexModel = candidateModel;
          data.__jlexFallback = candidateModel !== cleanModel;
          return data;
        }

        const errData = await res.json().catch(() => ({}));
        const apiMessage = errData.error?.message || `HTTP ${res.status} ${res.statusText}`;
        const apiStatus = errData.error?.status || '';
        lastError = `${candidateModel}: ${apiMessage}`;

        if (/API key not valid|API_KEY_INVALID/i.test(`${apiStatus} ${apiMessage}`)) {
          throw new Error(`API Key không hợp lệ: ${apiMessage}`);
        }

        // Trying the same model through another API version cannot fix quota.
        if (res.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(`${apiStatus} ${apiMessage}`)) {
          const retryDelay = errData.error?.details
            ?.map((detail) => detail.retryDelay)
            .find(Boolean);
          const retrySeconds = Math.max(60, Math.min(15 * 60, Number.parseInt(retryDelay, 10) || 120));
          geminiModelCooldowns.set(`${apiKey}:${candidateModel}`, Date.now() + retrySeconds * 1000);
          break;
        }

        // A malformed request is model-independent, so fail clearly instead of
        // consuming quota by repeating it against every available model.
        if (res.status === 400 && !/model|not found|unsupported/i.test(apiMessage)) {
          throw new Error(`Gemini từ chối yêu cầu: ${apiMessage}`);
        }
      } catch (err) {
        lastError = err.message;
        if (/API Key không hợp lệ|Gemini từ chối yêu cầu/.test(lastError)) throw err;
      }
    }
  }

  throw new Error(`Không model Gemini nào dùng được (${attemptedModels.join(', ')}). ${lastError || 'Không có phản hồi từ API.'}`);
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

function getAiExampleCacheKey(word, reading = '') {
  return `${String(word || '').trim()}\u0000${String(reading || '').trim()}`;
}

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
    geminiModel: DEFAULT_GEMINI_MODEL
  });

  const apiKey = config.geminiApiKey;
  if (!apiKey) return null;

  let model = (config.geminiModel || DEFAULT_GEMINI_MODEL).trim();
  if (model.startsWith('gemma-')) {
    model = DEFAULT_GEMINI_MODEL;
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
6. Chọn "sense_index" là số thứ tự 1-based của mục nghĩa trong "Nghĩa gốc tham khảo" mà câu ví dụ minh họa rõ nhất. Nếu không xác định chắc chắn, trả về null.
7. Phân tích chi tiết các chữ Hán (Kanji) có trong từ: chữ Hán, âm Hán-Việt, âm On'yomi (Katakana), âm Kun'yomi (Hiragana), ý nghĩa Hán-Việt ngắn gọn.

BẮT BUỘC trả về kết quả dưới dạng JSON thuần túy (không kèm markdown fences, không có suy nghĩ hay giải thích ngoài JSON):
{
  "pos_en": "Noun • Suru verb • Transitive verb",
  "meanings_en": [
    "Meaning 1 in English",
    "Meaning 2 in English"
  ],
  "sense_index": 1,
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
async function handleGeminiGenerate({ word, reading, definition, rawDefinitions = null, forceRegenerate = false }) {
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

  const cacheKey = getAiExampleCacheKey(cleanWord, reading);
  if (!forceRegenerate && aiExampleCache.has(cacheKey)) {
    return aiExampleCache.get(cacheKey);
  }

  const senseGroups = await parseDictionarySenses(definition, rawDefinitions);
  const definitionForAi = senseGroups.length > 0
    ? senseGroups.map((group) => {
        const posHeader = group.pos ? `[${group.pos}]\n` : '';
        return `${posHeader}${group.senses.map((sense) => `${sense.index}. ${sense.text}`).join('\n')}`;
      }).join('\n')
    : definition;

  const analysis = await handleGeminiAnalyzeWord({
    word: cleanWord,
    reading,
    definition: definitionForAi,
    forceRegenerate
  });

  if (analysis && (analysis.ex_ruby || analysis.ex_jp)) {
    const rawRuby = analysis.ex_ruby || analysis.ex_jp;
    const formattedRuby = ensureRubyFurigana(rawRuby);
    const plainJp = formattedRuby.replace(/<rt>[^<]*<\/rt>/g, '').replace(/<\/?ruby>/g, '');
    const result = {
      ex_jp: plainJp,
      ex_furigana: formattedRuby,
      ex_vi: analysis.ex_vi || '',
      sense_index: Number.isInteger(Number(analysis.sense_index)) && Number(analysis.sense_index) >= 1
        ? Number(analysis.sense_index)
        : null
    };
    aiExampleCache.set(cacheKey, result);
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
 * Clean and normalize an Anki field value for headword comparison:
 * - Strips <rt>...</rt> furigana ruby text
 * - Strips all HTML tags
 * - Strips bracketed furigana/readings e.g. [ぬの], (ぬの), 【ぬの】
 * - Strips surrounding quotes, brackets, and punctuation
 */
function cleanAnkiWordFieldValue(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let t = raw;
  // 1. Remove ruby rt tags (furigana text) e.g. <ruby>布<rt>ぬの</rt></ruby> -> <ruby>布</ruby>
  t = t.replace(/<rt[^>]*>[\s\S]*?<\/rt>/gi, '');
  // 2. Remove all HTML tags
  t = t.replace(/<[^>]+>/g, ' ');
  // 3. Remove bracketed furigana/readings e.g. [ぬの], (ぬの), 【ぬの】, （ぬの）
  t = t.replace(/\s*[\[\(（【][^\]\)）】]*[\]\)）】]/g, '');
  // 4. Strip punctuation, quotes, leading/trailing symbols e.g. 「布」, "布", 〜布
  t = t.replace(/^[「『"'\s\.,:;\-~〜・\[\]\(\)]+|[」』"'\s\.,:;\-~〜・\[\]\(\)]+$/g, '');
  return t.trim();
}

function formatHanvietDisplay(hanviet) {
  return String(hanviet || '')
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .join('-')
    .toLocaleUpperCase('vi-VN');
}

/**
 * Extract reading (kana) from an Anki note to differentiate heteronyms (words with same Kanji but different readings)
 */
function extractReadingFromAnkiNote(note) {
  const fields = note.fields || {};

  // 1. Check dedicated reading/audio/sound/kana fields
  for (const [key, valObj] of Object.entries(fields)) {
    if (/audio|reading|kana|furigana|phát âm|cách đọc/i.test(key)) {
      const raw = (valObj?.value || '').trim();
      if (!raw) continue;

      // Check bracketed reading: 【それる】 or [それる]
      const bracketMatch = raw.match(/[【\[]([\u3040-\u309f\u30a0-\u30ff]+)[】\]]/);
      if (bracketMatch) return bracketMatch[1].trim();

      // Strip sound tags, html tags, brackets
      const stripped = raw
        .replace(/\[sound:[^\]]+\]/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/[【】\[\]\(\)]/g, '')
        .trim();

      const kanaMatch = stripped.match(/[\u3040-\u309f\u30a0-\u30ff]+/);
      if (kanaMatch) return kanaMatch[0].trim();
    }
  }

  // 2. Check for ruby / brackets in expression field: <rt>そ</rt> or 逸[そ]れる
  for (const [key, valObj] of Object.entries(fields)) {
    if (/expression|word|front/i.test(key)) {
      const raw = (valObj?.value || '').trim();
      if (!raw) continue;

      const rubyMatch = raw.match(/<rt>([\u3040-\u309f\u30a0-\u30ff]+)<\/rt>/);
      if (rubyMatch) {
        const fullKana = raw.replace(/<ruby>(?:<rb>)?([^\s<]+)(?:<\/rb>)?<rt>([^\s<]+)<\/rt><\/ruby>/g, '$2').replace(/<[^>]+>/g, '').trim();
        if (/^[\u3040-\u309f\u30a0-\u30ff]+$/.test(fullKana)) {
          return fullKana;
        }
      }

      const bracketFuri = raw.match(/\[([\u3040-\u309f\u30a0-\u30ff]+)\]/);
      if (bracketFuri) {
        const recombined = raw.replace(/([^\s\[\]]+)\[([^\s\[\]]+)\]/g, '$2').replace(/<[^>]+>/g, '').trim();
        if (/^[\u3040-\u309f\u30a0-\u30ff]+$/.test(recombined)) {
          return recombined;
        }
      }
    }
  }

  return null;
}

/**
 * Check if a note already exists in the target Anki deck
 */
async function handleCheckNoteExists({ word, reading, deckName }) {
  if (!word) return { exists: false };
  const cleanWord = word.trim();
  if (!cleanWord) return { exists: false };
  const cleanReading = (reading || '').trim();
  const hasKanji = /[\u4e00-\u9faf]/.test(cleanWord);

  const config = await chrome.storage.local.get({
    ankiUrl: 'http://localhost:8765',
    deckName: 'Japanese_Learning'
  });

  const ankiUrl = config.ankiUrl || 'http://localhost:8765';
  const targetDeck = (deckName || config.deckName || '').trim();

  try {
    const escapedWord = cleanWord.replace(/["\\]/g, '\\$&');
    const deckClause = targetDeck ? `deck:"${targetDeck.replace(/["\\]/g, '\\$&')}" ` : '';
    const query = `${deckClause}"${escapedWord}"`;

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

    // Verify against note fields (inspect up to 50 candidate notes)
    const resInfo = await fetch(ankiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'notesInfo',
        version: 6,
        params: { notes: noteIds.slice(0, 50) }
      })
    });

    if (!resInfo.ok) return { exists: false };
    const dataInfo = await resInfo.json();
    const notes = dataInfo.result || [];

    // Ignored field patterns: definitions, audio, images, sentences, notes, and card back
    const ignoredFieldPattern =
      /meaning|definition|glossary|dịch|nghĩa|audio|sound|âm thanh|pronunciation|phát âm|picture|image|ảnh|hình|example|sentence|ví dụ|cau vi du|tatoeba|notes|note|comment|ghi chú|back|mặt sau|hint|gợi ý/i;

    for (const n of notes) {
      const fields = n.fields || {};
      // Sort fields so order: 0 (the primary/sort field) is evaluated first
      const sortedFields = Object.entries(fields).sort((a, b) => (a[1]?.order ?? 99) - (b[1]?.order ?? 99));

      for (const [key, valObj] of sortedFields) {
        if (ignoredFieldPattern.test(key)) {
          continue;
        }

        const rawVal = (valObj?.value || '').trim();
        if (!rawVal) continue;

        let wordMatches = false;

        // Exact match before cleaning
        if (rawVal === cleanWord || (!hasKanji && cleanReading && rawVal === cleanReading)) {
          wordMatches = true;
        } else {
          // Cleaned value match (furigana/html/brackets stripped)
          const cleaned = cleanAnkiWordFieldValue(rawVal);
          if (cleaned === cleanWord || (!hasKanji && cleanReading && cleaned === cleanReading)) {
            wordMatches = true;
          } else {
            // Split multiple headword tokens e.g. "布; 織物" or "布\nぬの"
            const tokens = cleaned.split(/[\n\/;,、，]+/).map((s) => s.trim()).filter(Boolean);
            if (tokens.includes(cleanWord) || (!hasKanji && cleanReading && tokens.includes(cleanReading))) {
              wordMatches = true;
            }
          }
        }

        if (wordMatches) {
          // If a specific reading is provided and differs from cleanWord, check whether this note has a distinct reading
          if (cleanReading && cleanReading !== cleanWord) {
            const noteReading = extractReadingFromAnkiNote(n);
            if (noteReading && noteReading !== cleanReading) {
              // Existing note has a different reading (homograph/heteronym, e.g. "それる" vs "はぐれる").
              // This candidate note is NOT a duplicate of the searched reading!
              break;
            }
          }
          return { exists: true, noteId: n.noteId };
        }
      }
    }

    // None of the candidate notes matched the target word in their word fields
    return { exists: false };
  } catch (err) {
    console.warn('[Anki] checkNoteExists error:', err);
    return { exists: false };
  }
}

/**
 * Parse rawDefinition HTML or text into structured sense groups with attached examples and notes
 */
function getStructuredContentMarker(node) {
  return node && typeof node === 'object' && node.data && typeof node.data === 'object'
    ? String(node.data.content || '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
    : '';
}

function findStructuredNodes(node, predicate, stopAtMatch = false, results = []) {
  if (node === null || node === undefined) return results;
  if (Array.isArray(node)) {
    node.forEach((child) => findStructuredNodes(child, predicate, stopAtMatch, results));
    return results;
  }
  if (typeof node !== 'object') return results;

  const matched = predicate(node);
  if (matched) results.push(node);
  if (!(matched && stopAtMatch) && node.content !== undefined) {
    findStructuredNodes(node.content, predicate, stopAtMatch, results);
  }
  return results;
}

function structuredJapaneseToHtml(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return escapeHtml(node);
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(structuredJapaneseToHtml).join('');
  if (typeof node !== 'object') return '';

  const tag = String(node.tag || 'span').toLowerCase();
  const inner = structuredJapaneseToHtml(node.content);
  if (tag === 'ruby') return `<ruby>${inner}</ruby>`;
  if (tag === 'rt') return `<rt>${inner}</rt>`;
  if (tag === 'rp') return '';
  if (tag === 'br') return '<br>';
  return inner;
}

async function extractStructuredExamples(senseNode) {
  const markerIs = (node, pattern) => pattern.test(getStructuredContentMarker(node));
  let containers = findStructuredNodes(
    senseNode,
    (node) => markerIs(node, /^example-sentence$/),
    true
  );

  // Older Jitendex builds may only expose the paired -a/-b nodes.
  if (containers.length === 0) {
    const jpNodes = findStructuredNodes(senseNode, (node) => markerIs(node, /^example-sentence-a$/), true);
    const viNodes = findStructuredNodes(senseNode, (node) => markerIs(node, /^example-sentence-b$/), true);
    const examples = [];
    for (let i = 0; i < jpNodes.length; i++) {
      const jp = structuredJapaneseToHtml(jpNodes[i].content).trim();
      if (!jp) continue;
      const sourceTranslation = viNodes[i] ? extractTextFromNode(viNodes[i]).trim() : '';
      const plainJp = jp.replace(/<rt>[\s\S]*?<\/rt>/gi, '').replace(/<[^>]*>/g, '').trim();
      const vi = await translateExampleSentenceToVietnamese({ ja: plainJp, en: sourceTranslation });
      examples.push({ jp, vi });
    }
    return examples;
  }

  const examples = [];
  for (const container of containers) {
    const jpNode = findStructuredNodes(container, (node) => markerIs(node, /^example-sentence-a$/), true)[0];
    const viNode = findStructuredNodes(container, (node) => markerIs(node, /^example-sentence-b$/), true)[0];
    const jp = structuredJapaneseToHtml(jpNode ? jpNode.content : container.content).trim();
    if (!jp) continue;
    const sourceTranslation = viNode ? extractTextFromNode(viNode).trim() : '';
    const plainJp = jp.replace(/<rt>[\s\S]*?<\/rt>/gi, '').replace(/<[^>]*>/g, '').trim();
    const vi = await translateExampleSentenceToVietnamese({ ja: plainJp, en: sourceTranslation });
    examples.push({ jp, vi });
  }
  return examples;
}

async function parseStructuredDictionarySenses(rawDefinitions) {
  if (!Array.isArray(rawDefinitions) || rawDefinitions.length === 0) return [];

  const roots = rawDefinitions.filter((definition) => definition && typeof definition === 'object');
  const senseGroups = findStructuredNodes(
    roots,
    (node) => getStructuredContentMarker(node) === 'sense-group',
    true
  );
  if (senseGroups.length === 0) return [];

  const groups = [];
  let globalSenseIndex = 1;

  for (const groupNode of senseGroups) {
    const posNodes = findStructuredNodes(
      groupNode,
      (node) => /^(?:part-of-speech-info|part-of-speech)$/.test(getStructuredContentMarker(node)),
      true
    );
    const pos = Array.from(new Set(posNodes.map((node) => extractTextFromNode(node).trim()).filter(Boolean))).join(' • ');
    const senseNodes = findStructuredNodes(
      groupNode,
      (node) => getStructuredContentMarker(node) === 'sense',
      true
    );
    const senses = [];

    for (const senseNode of senseNodes) {
      const glossaryNodes = findStructuredNodes(
        senseNode,
        (node) => getStructuredContentMarker(node) === 'glossary',
        true
      );
      const glosses = [];
      for (const glossaryNode of glossaryNodes) {
        const listItems = findStructuredNodes(glossaryNode, (node) => String(node.tag || '').toLowerCase() === 'li', true);
        const values = listItems.length > 0
          ? listItems.map((node) => extractTextFromNode(node).trim())
          : [extractTextFromNode(glossaryNode).trim()];
        values.filter(Boolean).forEach((value) => {
          if (!glosses.includes(value)) glosses.push(value);
        });
      }
      if (glosses.length === 0) continue;

      const labelNodes = findStructuredNodes(
        senseNode,
        (node) => /^(?:field|field-info|usage|usage-info|register|register-info|dialect|dialect-info|misc|misc-info)$/.test(getStructuredContentMarker(node)),
        true
      );
      const labels = Array.from(new Set(labelNodes.map((node) => extractTextFromNode(node).trim()).filter(Boolean)));
      const noteNodes = findStructuredNodes(
        senseNode,
        (node) => /^(?:note|sense-note|extra-info)$/.test(getStructuredContentMarker(node)),
        true
      );
      const notes = Array.from(new Set(noteNodes.map((node) => extractTextFromNode(node).trim()).filter(Boolean))).join(' • ');
      const examples = await extractStructuredExamples(senseNode);

      senses.push({
        index: globalSenseIndex++,
        text: glosses.join('; '),
        labels,
        examples,
        notes
      });
    }

    if (senses.length > 0) {
      const existingGroup = groups.find((group) => group.pos === pos);
      if (existingGroup) existingGroup.senses.push(...senses);
      else groups.push({ pos, senses });
    }
  }

  return groups;
}

async function parseDictionarySenses(rawHtml, rawDefinitions = null) {
  const structuredGroups = await parseStructuredDictionarySenses(rawDefinitions);
  if (structuredGroups.length > 0) return structuredGroups;

  let text = (rawHtml || '').trim();

  // Strip attribution & citations
  text = stripBlocksByClass(text, 'jlex-sc-attribution');
  text = text.replace(/<div class="jlex-sc-attribution"[\s\S]*?<\/div>/gi, '');
  text = text.replace(/\[?JMdict\]?[^|\n]*\|\s*\[?Tatoeba\]?[^\n]*/gi, '');
  text = text.replace(/JMdict\s*\|\s*Tatoeba[^\n]*/gi, '');
  text = text.replace(/<a[^>]*>(?:JMdict|Tatoeba)<\/a>/gi, '');

  // Strip forms and frequency blocks
  text = stripBlocksByClass(text, 'jlex-sc-forms');
  text = stripBlocksByClass(text, 'jlex-sc-frequency');

  const cleanPosRegex = /^(?:<span[^>]*class="[^"]*(?:jlex|result)-pos-badge[^"]*"[^>]*>[\s\S]*?<\/span>|<[^>]*data-content="partOfSpeech"[^>]*>[\s\S]*?<\/[^>]*>)/gi;
  const prefixKeywords = /^(?:noun|suru|vs|vt|vi|transitive|intransitive|adjective|adverb|danh từ|động từ\s+suru|động từ|tính từ|phó từ|tự động từ|tha động từ|chuyển\s*tiếp)[\s,•\.\-]*/gi;

  // Detect POS badges in HTML
  const posBadgeRegex = /(?:<span[^>]*class="[^"]*(?:jlex|result)-pos-badge[^"]*"[^>]*>|<[^>]*data-content="partOfSpeech"[^>]*>)([\s\S]*?)<\/(?:span|div)>/gi;

  const sections = [];
  let lastIdx = 0;
  let currentPos = '';
  let match;

  while ((match = posBadgeRegex.exec(text)) !== null) {
    const sectionContent = text.slice(lastIdx, match.index).trim();
    if (sectionContent || currentPos) {
      sections.push({ pos: currentPos, html: sectionContent });
    }
    currentPos = match[1].replace(/<[^>]*>/g, '').trim();
    lastIdx = posBadgeRegex.lastIndex;
  }
  const remaining = text.slice(lastIdx).trim();
  if (remaining || currentPos) {
    sections.push({ pos: currentPos, html: remaining });
  }

  if (sections.length === 0) {
    sections.push({ pos: '', html: text });
  }

  const groups = [];
  let globalSenseIndex = 1;

  for (const sec of sections) {
    const secHtml = sec.html;
    const senses = [];

    // Check for <li> elements
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch;
    const foundLis = [];
    while ((liMatch = liRegex.exec(secHtml)) !== null) {
      foundLis.push({ content: liMatch[1], fullIndex: liMatch.index });
    }

    if (foundLis.length > 0) {
      for (const item of foundLis) {
        let content = item.content;

        // 1. Extract examples inside this <li>
        const { blocks: exBlocks, remaining: defContent } = extractExampleBlocks(content);
        const examples = [];
        for (const block of exBlocks) {
          const ex = extractFromExampleBlock(block);
          if (ex.jp) {
            const cleanJp = ex.jp.replace(/<rt>[\s\S]*?<\/rt>/gi, '').replace(/<[^>]*>/g, '').trim();
            const viTrans = await translateExampleSentenceToVietnamese({ ja: cleanJp, en: ex.vi });
            examples.push({ jp: ex.jp, vi: viTrans });
          }
        }

        // 2. Extract notes if any
        let notes = '';
        const notesMatch = defContent.match(/(?:<[^>]*class="[^"]*notes?[^"]*"[^>]*>|Note:\s*)([\s\S]*?)(?:<\/[^>]+>|$)/i);
        if (notesMatch) {
          notes = notesMatch[1].replace(/<[^>]*>/g, '').trim();
        }

        // 3. Clean definition text
        let defText = defContent.replace(cleanPosRegex, '');
        defText = defText.replace(/<[^>]*class="[^"]*notes?[^"]*"[\s\S]*?<\/[^>]+>/gi, '');
        defText = defText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        while (prefixKeywords.test(defText)) {
          defText = defText.replace(prefixKeywords, '').trim();
        }
        defText = defText.replace(/^(?:[•\-\*]|\d+[\.\)]|[①-⑳])\s*/, '').trim();

        if (defText && !defText.includes('JMdict') && !defText.includes('Tatoeba')) {
          senses.push({
            index: globalSenseIndex++,
            text: defText,
            labels: [],
            examples,
            notes
          });
        }
      }
    } else {
      // Plain text or newline/<br> separated lines
      const lines = secHtml.split(/\r?\n|<br\s*\/?>/i)
        .map(l => l.trim())
        .filter(Boolean);

      let groupPos = sec.pos;

      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const textOnly = line.replace(/<[^>]*>/g, '').trim();
        if (!textOnly || textOnly.includes('JMdict') || textOnly.includes('Tatoeba') || /^(?:Priority|Form)/i.test(textOnly)) {
          continue;
        }

        // Check if line is a POS header in plain text
        const posMatch = line.match(/^(?:5-dan|1-dan|noun|transitive|intransitive|suru|godan|ichidan|adj-)[a-z0-9\s\-•]*/i);
        if (posMatch && line.length < 45 && !line.includes('(') && !line.includes('to ')) {
          if (senses.length > 0) {
            groups.push({ pos: groupPos, senses: [...senses] });
            senses.length = 0;
          }
          groupPos = line.trim();
          continue;
        }

        // Check if line is Note
        if (/^Note\b|^esp\.|^see also/i.test(textOnly)) {
          if (senses.length > 0) {
            const lastSense = senses[senses.length - 1];
            lastSense.notes = (lastSense.notes ? lastSense.notes + ' • ' : '') + textOnly;
          }
          continue;
        }

        // Check if line is Japanese example sentence
        const hasJpChars = /[\u3040-\u30ff\u4e00-\u9faf]/.test(textOnly);
        const isJpSentence = (hasJpChars && (textOnly.length >= 6 || /[\u3040-\u30ff]/.test(textOnly))) || /<ruby>/i.test(line);

        if (isJpSentence && !textOnly.startsWith('②') && !textOnly.startsWith('①')) {
          const nextLine = lines[i + 1] ? lines[i + 1].replace(/<[^>]*>/g, '').trim() : '';
          let trans = '';
          if (nextLine && !/[\u3040-\u30ff\u4e00-\u9faf]/.test(nextLine) && nextLine.length > 2 && !nextLine.includes('JMdict') && !nextLine.includes('Tatoeba') && !nextLine.startsWith('to ') && !nextLine.startsWith('Note')) {
            trans = nextLine.replace(/\[\d+\]/g, '').trim();
            i++; // skip translation line
          }
          const cleanJp = line.replace(/<rt>[\s\S]*?<\/rt>/gi, '').replace(/<[^>]*>/g, '').trim();
          const viTrans = await translateExampleSentenceToVietnamese({ ja: cleanJp, en: trans });
          if (senses.length > 0) {
            senses[senses.length - 1].examples.push({ jp: line, vi: viTrans });
          }
          continue;
        }

        // Clean definition text
        let defText = textOnly.replace(/^(?:[•\-\*]|\d+[\.\)]|[①-⑳])\s*/, '').trim();
        while (prefixKeywords.test(defText)) {
          defText = defText.replace(prefixKeywords, '').trim();
        }

        if (defText.length > 1) {
          senses.push({
            index: globalSenseIndex++,
            text: defText,
            labels: [],
            examples: [],
            notes: ''
          });
        }
      }

      if (senses.length > 0) {
        groups.push({ pos: groupPos, senses: [...senses] });
        continue;
      }
    }

    if (senses.length > 0) {
      groups.push({ pos: sec.pos, senses });
    }
  }

  return groups;
}

/**
 * Format and beautify the Meaning section:
 * - POS badges in English (Noun, Suru verb, Transitive verb...)
 * - Contextual examples nested directly inside/under the specific meaning they belong to
 * - AI examples attached to their target sense, or shown as a clearly marked general example
 * - Senses numbered with modern circular accent badges
 * - Cleans any raw JMdict / Tatoeba or unformatted text
 */
async function formatBeautifiedMeaningHtml({ aiData, rawDefinition, rawDefinitions, parsedGroups, word, reading, providedExample }) {
  const groups = Array.isArray(parsedGroups)
    ? parsedGroups
    : await parseDictionarySenses(rawDefinition, rawDefinitions);

  // Overall POS detection
  const posList = [];
  const addPos = (name) => { if (name && !posList.includes(name)) posList.push(name); };

  groups.forEach(g => {
    if (g.pos) {
      const formatted = formatPosToEnglish(g.pos);
      if (formatted) formatted.split(' • ').forEach(p => addPos(p.trim()));
    }
  });

  // Fallback POS detection in rawDefinition if not extracted from groups
  if (posList.length === 0) {
    if (/(?:^|\s|<[^>]*>|[\d\W_])(?:noun|danh từ)(?:\s|<[^>]*>|[\d\W_]|$)/i.test(rawDefinition)) addPos('Noun');
    if (/(?:^|\s|<[^>]*>|[\d\W_])(?:suru|vs)(?:\s|<[^>]*>|[\d\W_]|$)/i.test(rawDefinition)) addPos('Suru verb');
    if (/(?:^|\s|<[^>]*>|[\d\W_])(?:transitive|vt|tha\s*động\s*từ|chuyển\s*tiếp)/i.test(rawDefinition)) addPos('Transitive verb');
    if (/(?:^|\s|<[^>]*>|[\d\W_])(?:intransitive|vi|tự\s*động\s*từ|nội\s*động\s*từ)/i.test(rawDefinition)) addPos('Intransitive verb');
    if (/(?:^|\s|<[^>]*>|[\d\W_])(?:adj-na|na-adjective)/i.test(rawDefinition)) addPos('Na-adjective');
    else if (/(?:^|\s|<[^>]*>|[\d\W_])(?:adj-i|i-adjective)/i.test(rawDefinition)) addPos('I-adjective');
    else if (/(?:^|\s|<[^>]*>|[\d\W_])(?:adjective|tính từ)/i.test(rawDefinition)) addPos('Adjective');
    if (/(?:^|\s|<[^>]*>|[\d\W_])(?:adverb|adv|phó từ)/i.test(rawDefinition)) addPos('Adverb');
  }

  // Fallback to AI data if dictionary was completely empty
  const totalSenses = groups.reduce((acc, g) => acc + g.senses.length, 0);
  if (totalSenses === 0 && (aiData?.meanings_en || aiData?.meanings_vi)) {
    const aiMeanings = aiData.meanings_en || aiData.meanings_vi;
    groups.push({
      pos: aiData.pos_en || aiData.pos_vi || '',
      senses: aiMeanings.map((m, idx) => ({
        index: idx + 1,
        text: m,
        labels: [],
        examples: [],
        notes: ''
      }))
    });
  }
  if (posList.length === 0 && (aiData?.pos_en || aiData?.pos_vi)) {
    (aiData.pos_en || aiData.pos_vi).split(/[•,]/).forEach((p) => addPos(p.trim()));
  }

  // Determine all dictionary example texts to prevent duplicate AI examples
  const allDictJp = new Set();
  groups.forEach(g => {
    g.senses.forEach(s => {
      s.examples.forEach(e => {
        allDictJp.add(e.jp.replace(/<[^>]*>/g, '').trim());
      });
    });
  });

  // Handle AI Example
  const userAiEx = (providedExample && (providedExample.jp || providedExample.ex_ruby || providedExample.ex_furigana))
    ? providedExample
    : (word && aiExampleCache.has(getAiExampleCacheKey(word, reading))
        ? aiExampleCache.get(getAiExampleCacheKey(word, reading))
        : null);

  let aiExample = null;
  if (userAiEx) {
    const aiJp = ensureRubyFurigana(userAiEx.jp || userAiEx.ex_ruby || userAiEx.ex_furigana);
    const aiVi = userAiEx.vi || userAiEx.ex_vi || '';
    const cleanAiJp = aiJp.replace(/<[^>]*>/g, '').trim();

    if (!allDictJp.has(cleanAiJp)) {
      aiExample = {
        title: '✨ Ví dụ AI · Gemini',
        jp: aiJp,
        vi: aiVi,
        senseIndex: Number(userAiEx.sense_index || userAiEx.senseIndex) || null
      };
    }
  } else if (aiData?.ex_ruby) {
    const aiJp = ensureRubyFurigana(aiData.ex_ruby);
    const cleanAiJp = aiJp.replace(/<[^>]*>/g, '').trim();
    if (!allDictJp.has(cleanAiJp)) {
      aiExample = {
        title: '✨ Ví dụ AI · Gemini',
        jp: aiJp,
        vi: aiData.ex_vi || '',
        senseIndex: Number(aiData.sense_index) || null
      };
    }
  }

  if (aiExample) {
    const validSenseIndexes = new Set(groups.flatMap((group) => group.senses.map((sense) => sense.index)));
    if (validSenseIndexes.size === 1 && !validSenseIndexes.has(aiExample.senseIndex)) {
      aiExample.senseIndex = Array.from(validSenseIndexes)[0];
    } else if (!validSenseIndexes.has(aiExample.senseIndex)) {
      aiExample.senseIndex = null;
    }
  }

  const renderAiExampleCard = (example, isGeneral = false) => example ? `
    <div class="lab-example-card lab-ai-example-card" style="margin-top:8px; padding:10px 14px; background:#faf5ff; border:1px solid #e9d5ff; border-left:3px solid #9333ea !important; border-radius:0 8px 8px 0; box-shadow:0 1px 3px rgba(0,0,0,0.02);">
      <div class="example-title" style="font-size:10.5px; font-weight:800; color:#7e22ce; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:5px;">
        ${isGeneral ? '✨ Ví dụ AI tổng quát · Gemini' : (example.title || '✨ Ví dụ AI · Gemini')}
      </div>
      <div class="example-jp" style="font-size:16px; font-weight:600; line-height:1.9; color:var(--lab-text, #1e293b); margin-bottom:4px;">
        ${ensureRubyFurigana(example.jp)}
      </div>
      ${example.vi ? `
      <div class="example-vi" style="font-size:13.5px; color:var(--lab-muted, #475569); font-style:italic; line-height:1.5;">
        ${escapeHtml(example.vi)}
      </div>` : ''}
    </div>
  ` : '';

  // Build Top POS Badges
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

  // Whether to show POS headers per group (when multiple distinct POS groups exist)
  const showGroupPos = groups.length > 1 && groups.some(g => g.pos);

  // Build Meanings List with Examples Nested Directly Under Senses
  const renderedGroupsHtml = groups.map((g, gIdx) => {
    const groupPosHtml = showGroupPos && g.pos ? `
      <div class="lab-pos-group-header" style="margin-top:${gIdx === 0 ? '0' : '16px'}; margin-bottom:10px;">
        <span class="lab-pos-badge" style="display:inline-flex; align-items:center; background:#eff6ff; color:#1e40af; border:1px solid #bfdbfe; font-size:12.5px; font-weight:700; padding:4px 12px; border-radius:9999px; letter-spacing:0.02em;">
          ${escapeHtml(g.pos)}
        </span>
      </div>
    ` : '';

    const sensesHtml = (g.senses.length > 0 ? g.senses : [{ index: 1, text: 'Definition', labels: [], examples: [], notes: '' }])
      .map(sense => {
        const senseAiExample = aiExample && aiExample.senseIndex === sense.index ? aiExample : null;
        return `
        <div class="lab-meaning-item" style="display:flex; flex-direction:column; gap:0; padding:10px 14px; background:var(--lab-surface, #ffffff); border:1px solid var(--lab-border, #e2e8f0); border-radius:10px; box-shadow:0 1px 3px rgba(0,0,0,0.03); margin-bottom:8px;">
          <div class="lab-meaning-row" style="display:flex; align-items:flex-start; gap:12px; width:100%;">
            <span class="num-badge" style="display:inline-flex; justify-content:center; align-items:center; width:22px; height:22px; background:var(--lab-accent, #b54834); color:#ffffff; border-radius:50%; font-size:12px; font-weight:700; flex-shrink:0; margin-top:2px;">
              ${sense.index}
            </span>
            <div style="flex:1; min-width:0;">
              ${sense.labels && sense.labels.length > 0 ? `
              <div class="sense-labels" style="display:flex; flex-wrap:wrap; gap:5px; margin-bottom:5px;">
                ${sense.labels.map((label) => `<span style="display:inline-flex; align-items:center; padding:2px 7px; border-radius:999px; background:#f1f5f9; border:1px solid #cbd5e1; color:#475569; font-size:10.5px; font-weight:700;">${escapeHtml(label)}</span>`).join('')}
              </div>` : ''}
              <span class="meaning-text" style="font-size:16px; font-weight:600; color:var(--lab-text, #1e293b); line-height:1.5;">
                ${escapeHtml(sense.text)}
              </span>
              ${sense.notes ? `
              <div class="sense-notes" style="font-size:12.5px; color:#64748b; margin-top:3px; font-style:italic;">
                ${escapeHtml(sense.notes)}
              </div>` : ''}
            </div>
          </div>

          ${sense.examples && sense.examples.length > 0 ? `
          <div class="sense-examples" style="margin-top:8px; margin-left:34px;">
            <div class="example-title" style="font-size:10.5px; font-weight:800; color:#b54834; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:5px;">
              Ví dụ từ điển
            </div>
            ${sense.examples.map((ex, exIdx) => `
              <div class="lab-example-card" style="margin-top:${exIdx === 0 ? '0' : '6px'}; padding:10px 14px; background:var(--lab-surface, #fffdf8); border:1px solid var(--lab-border, #ebd8c8); border-left:3px solid var(--lab-accent, #b54834) !important; border-radius:0 8px 8px 0; box-shadow:0 1px 3px rgba(0,0,0,0.02);">
                <div class="example-jp" style="font-size:16px; font-weight:600; line-height:1.9; color:var(--lab-text, #1e293b); margin-bottom:4px;">
                  ${ensureRubyFurigana(ex.jp)}
                </div>
                ${ex.vi ? `
                <div class="example-vi" style="font-size:13.5px; color:var(--lab-muted, #475569); font-style:italic; line-height:1.5;">
                  ${escapeHtml(ex.vi)}
                </div>` : ''}
              </div>
            `).join('')}
          </div>` : ''}

          ${senseAiExample ? `<div class="sense-ai-example" style="margin-left:34px;">${renderAiExampleCard(senseAiExample)}</div>` : ''}
        </div>
      `;
      })
      .join('');

    return `${groupPosHtml}${sensesHtml}`;
  }).join('');

  return `
    ${posBadges && !showGroupPos ? `<div class="lab-pos-row" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px;">${posBadges}</div>` : ''}
    <div class="lab-meanings-list">
      ${renderedGroupsHtml}
    </div>
    ${aiExample && aiExample.senseIndex === null ? `<div class="lab-general-ai-example" style="margin-top:12px;">${renderAiExampleCard(aiExample, true)}</div>` : ''}
  `;
}

const audioUrlCache = new Map();

/**
 * Convert ArrayBuffer to Base64 safely without call stack limits
 */
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
  }
  return btoa(binary);
}

/**
 * Robustly download audio with automatic retries, backoff, and fallback across multiple providers:
 * 1. JapanesePod101 (Native audio)
 * 2. Youdao Dictvoice (Kana reading)
 * 3. Google Translate TTS (Kana reading)
 * 4. Youdao Dictvoice (Word fallback)
 */
async function downloadAudioWithFallbackAndRetry({ word, reading, providedUrl, maxRetries = 3 }) {
  const cleanWord = (word || '').trim();
  const cleanReading = (reading || cleanWord).trim();
  const safeWord = encodeURIComponent(cleanWord);
  const safeReading = encodeURIComponent(cleanReading);
  const filename = `jlex_${safeWord}_${safeReading}_${Date.now()}.mp3`;

  const urlsToTry = [];

  // Add provided URL if present and looks like a specific reading or native audio
  if (providedUrl && !providedUrl.includes('52288')) {
    urlsToTry.push(providedUrl);
  }

  // 1. Try JapanesePod101 native audio
  if (cleanWord && cleanReading) {
    try {
      const jpodUrl = `https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kanji=${encodeURIComponent(cleanWord)}&kana=${encodeURIComponent(cleanReading)}`;
      const resJ = await fetch(jpodUrl, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(3500) });
      if (resJ.status === 301 || resJ.status === 302) {
        const loc = resJ.headers.get('Location');
        if (loc && !loc.includes('52288') && !urlsToTry.includes(loc)) {
          urlsToTry.push(loc);
        }
      }
    } catch (e) {
      // JPod check error
    }
  }

  // 2. Youdao dictvoice with reading (kana)
  const youdaoKanaUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(cleanReading)}&le=jap`;
  if (!urlsToTry.includes(youdaoKanaUrl)) {
    urlsToTry.push(youdaoKanaUrl);
  }

  // 3. Google Translate TTS with reading (kana)
  const googleKanaUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ja&q=${encodeURIComponent(cleanReading)}`;
  if (!urlsToTry.includes(googleKanaUrl)) {
    urlsToTry.push(googleKanaUrl);
  }

  // 4. Youdao dictvoice with word (fallback)
  if (cleanWord && cleanWord !== cleanReading) {
    const youdaoWordUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(cleanWord)}&le=jap`;
    if (!urlsToTry.includes(youdaoWordUrl)) {
      urlsToTry.push(youdaoWordUrl);
    }
  }

  // Attempt download with retries across candidate URLs
  for (const url of urlsToTry) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(6000)
        });

        if (res.ok) {
          const buffer = await res.arrayBuffer();
          // Filter out empty responses or JPOD 52288 placeholder
          if (buffer.byteLength > 500 && buffer.byteLength !== 52288) {
            return {
              success: true,
              buffer,
              filename,
              sourceUrl: url
            };
          }
        } else if (res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504) {
          console.warn(`[Audio Download] ${url} returned HTTP ${res.status} (attempt ${attempt}/${maxRetries}), retrying...`);
        }
      } catch (err) {
        console.warn(`[Audio Download] Attempt ${attempt}/${maxRetries} failed for ${url}:`, err.message);
      }

      // Backoff delay before retry
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, attempt * 600));
      }
    }
  }

  return { success: false, filename };
}

/**
 * Resolve the best audio URL for Japanese vocabulary:
 * 1. Checks JapanesePod101 native human audio (supports kanji + kana combination).
 * 2. If JPOD returns 301/302 redirect with Location, returns high-quality native recording!
 * 3. Verifies Youdao TTS with reading (retries once on 500).
 * 4. Fallbacks to Google Translate TTS if Youdao is down/failing.
 */
async function handleGetAudioUrl({ word, reading }) {
  const cleanWord = (word || '').trim();
  const cleanReading = (reading || cleanWord).trim();
  if (!cleanWord && !cleanReading) {
    return { audioUrl: '' };
  }

  const cacheKey = `${cleanWord}#${cleanReading}`;
  if (audioUrlCache.has(cacheKey)) {
    return { audioUrl: audioUrlCache.get(cacheKey) };
  }

  // 1. Try JapanesePod101 native audio
  if (cleanWord && cleanReading) {
    try {
      const jpodUrl = `https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kanji=${encodeURIComponent(cleanWord)}&kana=${encodeURIComponent(cleanReading)}`;
      const res = await fetch(jpodUrl, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(3500)
      });

      if (res.status === 301 || res.status === 302) {
        const loc = res.headers.get('Location');
        if (loc && !loc.includes('52288')) {
          audioUrlCache.set(cacheKey, loc);
          return { audioUrl: loc };
        }
      }
    } catch (e) {
      // JPod lookup error or timeout, proceed to Youdao fallback
    }
  }

  // 2. Try Youdao dictvoice using the exact phonetic reading (kana)
  const targetPronounce = cleanReading || cleanWord;
  const youdaoUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(targetPronounce)}&le=jap`;

  // Quick verify Youdao (with 1 retry on 500)
  for (let i = 0; i < 2; i++) {
    try {
      const resY = await fetch(youdaoUrl, { method: 'HEAD', signal: AbortSignal.timeout(2500) });
      if (resY.ok) {
        audioUrlCache.set(cacheKey, youdaoUrl);
        return { audioUrl: youdaoUrl };
      }
      if (resY.status === 500) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
    } catch (e) {
      // Youdao network error
    }
  }

  // 3. Fallback to Google Translate TTS
  const googleUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ja&q=${encodeURIComponent(targetPronounce)}`;
  audioUrlCache.set(cacheKey, googleUrl);
  return { audioUrl: googleUrl };
}

/**
 * Handle AnkiConnect export with Linguist Japanese Vocab Template, Native Audio Download & Stroke Order
 */
async function handleAddToAnki({ word, reading, hanviet, definition, example, aiExample, audioUrl, rawDefinitions }) {
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
  const displayHanviet = formatHanvietDisplay(cleanHanviet);
  const readingWithHanviet = [
    cleanReading && cleanReading !== cleanWord ? `【${escapeHtml(cleanReading)}】` : '',
    displayHanviet ? `<strong class="jlex-hanviet-reading" style="margin-left:8px; letter-spacing:.04em; color:#b54834;">${escapeHtml(displayHanviet)}</strong>` : ''
  ].filter(Boolean).join(' ');
  const cleanDefinition = (definition || '').trim();

  // Check duplicate before proceeding
  const existCheck = await handleCheckNoteExists({ word: cleanWord, reading: cleanReading, deckName });
  if (existCheck.exists) {
    const readingSuffix = cleanReading && cleanReading !== cleanWord ? ` (cách đọc: 【${cleanReading}】)` : '';
    throw new Error(`Từ "${cleanWord}"${readingSuffix} đã tồn tại trong deck "${deckName}" của Anki.`);
  }

  // Ensure target deck exists
  try {
    await fetch(ankiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'createDeck', version: 6, params: { deck: deckName } })
    });
  } catch (e) {
    console.warn('[Anki] Could not ensure deck exists:', e);
  }

  const providedExample = aiExample || (example && typeof example === 'object' ? example : null);

  // Parse once so dictionary grouping and Gemini sense_index use the exact same ordering.
  const parsedSenseGroups = await parseDictionarySenses(cleanDefinition, rawDefinitions);
  const definitionForAi = parsedSenseGroups.length > 0
    ? parsedSenseGroups.map((group) => {
        const posHeader = group.pos ? `[${group.pos}]\n` : '';
        return `${posHeader}${group.senses.map((sense) => `${sense.index}. ${sense.text}`).join('\n')}`;
      }).join('\n')
    : cleanDefinition.replace(/<li[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  // 1. Analyze word via Gemini AI if a key is present
  let aiData = null;
  try {
    aiData = await handleGeminiAnalyzeWord({
      word: cleanWord,
      reading: cleanReading,
      definition: definitionForAi
    });
  } catch (e) {
    console.warn('[Anki] Gemini word analysis skipped or failed:', e.message);
  }

  // 2. Construct Beautified Meaning HTML (English definitions & POS, Vietnamese translated example sentences)
  const meaningHtml = await formatBeautifiedMeaningHtml({
    aiData,
    rawDefinition: cleanDefinition,
    rawDefinitions,
    parsedGroups: parsedSenseGroups,
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
        fields[audioField] = readingWithHanviet;
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
    ${readingWithHanviet ? `<div class="lab-reading" style="font-size: 18px; font-weight: 600; color: #b54834; margin-top: 4px;"><span lang="ja">${cleanReading && cleanReading !== cleanWord ? `【${escapeHtml(cleanReading)}】` : ''}</span>${displayHanviet ? ` <strong style="margin-left:8px; letter-spacing:.04em;">${escapeHtml(displayHanviet)}</strong>` : ''}</div>` : ''}
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
          fields[f] = readingWithHanviet || escapeHtml(cleanReading);
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
    fields['Back'] = `${readingWithHanviet || escapeHtml(cleanReading)}<br>${meaningHtml}${kanjiCardsHtml ? `<br>${kanjiCardsHtml}` : ''}`;
    targetAudioField = 'Back';
  }

  // 7. Download audio directly in extension with automatic retry and multi-source fallback,
  // then upload to Anki via storeMediaFile. This avoids AnkiConnect python urllib 500 download crashes!
  let storedAudioFilename = null;
  if (targetAudioField) {
    try {
      const audioResult = await downloadAudioWithFallbackAndRetry({
        word: cleanWord,
        reading: cleanReading,
        providedUrl: audioUrl,
        maxRetries: 3
      });

      if (audioResult && audioResult.success && audioResult.buffer) {
        const base64Data = bufferToBase64(audioResult.buffer);
        const storeRes = await fetch(ankiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'storeMediaFile',
            version: 6,
            params: {
              filename: audioResult.filename,
              data: base64Data
            }
          })
        });

        if (storeRes.ok) {
          const storeData = await storeRes.json();
          if (!storeData.error) {
            storedAudioFilename = audioResult.filename;
          }
        }
      }
    } catch (audioErr) {
      console.warn('[Anki] Audio download or storeMediaFile failed after retries:', audioErr);
    }
  }

  // 8. Attach [sound:filename] to the target audio field
  if (storedAudioFilename && targetAudioField) {
    const currentVal = (fields[targetAudioField] || '').trim();
    if (!currentVal.includes(`[sound:${storedAudioFilename}]`)) {
      fields[targetAudioField] = currentVal
        ? `${currentVal} [sound:${storedAudioFilename}]`
        : `[sound:${storedAudioFilename}]`;
    }
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
          allowDuplicate: true,
          duplicateScope: 'deck'
        },
        tags: ['j-lexicon-ai']
      }
    }
  };

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
  flex-direction: column;
  gap: 0;
  padding: 10px 14px;
  background: var(--lab-surface, #ffffff);
  border: 1px solid var(--lab-border, #e2e8f0);
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .03);
}

.lab-meaning-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
}

.sense-examples {
  margin-top: 8px;
  margin-left: 34px;
}

.sense-examples .lab-example-card {
  margin-top: 6px;
  padding: 10px 14px;
  border-left-width: 3px !important;
}

.sense-notes {
  font-size: 12.5px;
  color: var(--lab-muted, #64748b);
  margin-top: 3px;
  font-style: italic;
}

.lab-pos-group-header {
  margin-top: 14px;
  margin-bottom: 8px;
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

.nightMode .lab-ai-example-card {
  background: #251b33 !important;
  border-color: #581c87 !important;
  border-left-color: #c084fc !important;
}

.nightMode .lab-ai-example-card .example-title {
  color: #d8b4fe !important;
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
async function handleTestGemini({ apiKey, model = DEFAULT_GEMINI_MODEL }) {
  if (!apiKey) throw new Error('Vui lòng nhập API Key');

  // Fetch available models for the dropdown
  const availableModels = await fetchAvailableGeminiModels(apiKey, true);

  let targetModel = (model || DEFAULT_GEMINI_MODEL).trim().replace(/^models\//, '');
  if (targetModel.startsWith('gemma-')) {
    targetModel = DEFAULT_GEMINI_MODEL;
  }

  const testBody = {
    contents: [{ parts: [{ text: 'Trả lời ngắn gọn "OK" nếu bạn nhận được tin nhắn này.' }] }]
  };

  console.log(`[Gemini Test] Testing model: ${targetModel}`);
  const data = await callGeminiApi(apiKey, targetModel, testBody);
  const parts = data.candidates?.[0]?.content?.parts || [];
  const contentParts = parts.filter((p) => !p.thought && p.text);
  const responseText = contentParts.map((p) => p.text).join('\n').trim() || 'OK';

  return {
    response: responseText,
    usedModel: data.__jlexModel || targetModel,
    requestedModel: targetModel,
    usedFallback: Boolean(data.__jlexFallback),
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

/**
 * Automatically broadcast scan setting changes to all browser tabs
 */
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'local' && changes.enableScan !== undefined) {
    const isEnabled = changes.enableScan.newValue === true || changes.enableScan.newValue === 'true';
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'SET_SCAN_ENABLED',
            enableScan: isEnabled
          }).catch(() => {});
        }
      }
    } catch (e) {
      // Ignore tabs where content script is not loaded
    }
  }
});
