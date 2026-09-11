/**
 * J-Lexicon AI Content Script
 * Listens for user interactions (Shift + Hover or Selection),
 * queries background worker, and renders isolated Shadow DOM Popup.
 */

(() => {
  // Prevent duplicate injection
  if (window.__J_LEXICON_INJECTED__) return;
  window.__J_LEXICON_INJECTED__ = true;

  let hostElement = null;
  let shadowRoot = null;
  let currentPopup = null;
  let currentAudio = null;
  let lastLookupQuery = '';
  let activeWordData = null;

  // Configuration (sync with storage)
  let settings = {
    triggerKey: 'Shift', // 'Shift', 'Alt', or 'none' (selection only)
    enableScan: true,
    maxScanLength: 16,
    autoAiExamples: true
  };

  chrome.storage.local.get(['triggerKey', 'enableScan', 'maxScanLength', 'autoAiExamples'], (items) => {
    if (items.triggerKey !== undefined) settings.triggerKey = items.triggerKey;
    if (items.enableScan !== undefined) settings.enableScan = items.enableScan;
    if (items.maxScanLength !== undefined) settings.maxScanLength = items.maxScanLength;
    if (items.autoAiExamples !== undefined) settings.autoAiExamples = items.autoAiExamples;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.triggerKey) settings.triggerKey = changes.triggerKey.newValue;
    if (changes.enableScan) settings.enableScan = changes.enableScan.newValue;
    if (changes.maxScanLength) settings.maxScanLength = changes.maxScanLength.newValue;
    if (changes.autoAiExamples !== undefined) settings.autoAiExamples = changes.autoAiExamples.newValue;
  });

  /**
   * Ensure Shadow DOM container exists
   */
  function ensureShadowHost() {
    if (!hostElement) {
      hostElement = document.createElement('div');
      hostElement.id = 'j-lexicon-root';
      hostElement.style.all = 'initial';
      hostElement.style.position = 'absolute';
      hostElement.style.top = '0';
      hostElement.style.left = '0';
      hostElement.style.zIndex = '2147483647'; // Max z-index
      const targetParent = document.documentElement || document.body;
      targetParent.appendChild(hostElement);
      shadowRoot = hostElement.attachShadow({ mode: 'open' });
      injectShadowStyles();
    }
  }

  /**
   * CSS styles encapsulated entirely within the Shadow DOM
   */
  function injectShadowStyles() {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        color: #1f2937;
      }

      * {
        box-sizing: border-box;
      }

      .jlex-popup {
        position: fixed;
        width: 360px;
        max-width: 90vw;
        max-height: 480px;
        overflow-y: auto;
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
        border: 1px solid #e5e7eb;
        padding: 16px;
        animation: jlexFadeIn 0.15s ease-out;
        z-index: 2147483647;
      }

      @keyframes jlexFadeIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .jlex-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        border-bottom: 1px solid #f3f4f6;
        padding-bottom: 10px;
        margin-bottom: 10px;
      }

      .jlex-term-group {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .jlex-reading {
        font-size: 13px;
        color: #4b5563;
      }

      .jlex-term-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .jlex-term {
        font-size: 22px;
        font-weight: 700;
        color: #111827;
      }

      .jlex-badge-hanviet {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 700;
        color: #92400e;
        background-color: #fef3c7;
        border: 1px solid #fde68a;
        border-radius: 9999px;
        letter-spacing: 0.5px;
      }

      .jlex-pos-badge {
        display: inline-block;
        font-size: 11px;
        font-weight: 600;
        color: #0369a1;
        background: #f0f9ff;
        border: 1px solid #bae6fd;
        border-radius: 4px;
        padding: 2px 7px;
        margin-right: 6px;
        margin-bottom: 8px;
      }

      .jlex-actions-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .jlex-btn-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 6px;
        border: 1px solid #e5e7eb;
        background: #f9fafb;
        cursor: pointer;
        color: #4b5563;
        transition: all 0.15s ease;
      }

      .jlex-btn-icon:hover {
        background: #f3f4f6;
        color: #111827;
        border-color: #d1d5db;
      }

      .jlex-btn-close {
        font-size: 18px;
        line-height: 1;
      }

      .jlex-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: 8px;
      }

      .jlex-tag {
        font-size: 10px;
        text-transform: uppercase;
        padding: 1px 5px;
        border-radius: 4px;
        background: #f3f4f6;
        color: #6b7280;
        font-weight: 600;
      }

      .jlex-definitions {
        list-style: decimal inside;
        padding: 0;
        margin: 0 0 12px 0;
        color: #374151;
        font-size: 13.5px;
        max-height: 220px;
        overflow-y: auto;
      }

      .jlex-definitions li {
        margin-bottom: 8px;
        line-height: 1.5;
      }

      /* Jitendex Structured Content Styles */
      .jlex-popup ruby {
        ruby-position: over;
        font-size: inherit;
      }

      .jlex-popup rt {
        font-size: 0.65em;
        color: #4f46e5;
        font-weight: 500;
        user-select: none;
      }

      .jlex-sc-exampleSentence,
      .jlex-sc-example-sentence {
        display: block;
        background: #f8fafc;
        border-left: 3px solid #3b82f6;
        padding: 6px 10px;
        margin: 6px 0;
        border-radius: 0 6px 6px 0;
        font-size: 12.5px;
        color: #1e293b;
      }

      .jlex-sc-example-sentence-a {
        display: block;
        color: #1e293b;
        line-height: 1.8;
      }

      .jlex-sc-example-sentence-b,
      .jlex-sc-exampleSentence [lang="en"],
      .jlex-sc-exampleSentence [lang="vi"],
      .jlex-sc-example-sentence [lang="en"],
      .jlex-sc-example-sentence [lang="vi"] {
        display: block;
        color: #64748b;
        font-style: italic;
        margin-top: 4px;
        font-size: 11.5px;
        line-height: 1.45;
      }

      .jlex-sc-forms,
      .jlex-sc-frequency {
        display: none;
      }

      .jlex-sc-example-keyword {
        font-weight: bold;
        color: #2563eb;
      }

      .jlex-sc-attribution {
        display: block;
        font-size: 11px;
        color: #94a3b8;
        margin-top: 4px;
      }

      .jlex-sc-attribution a {
        color: #94a3b8;
        text-decoration: underline;
      }

      /* Anki Button */
      .jlex-anki-section {
        margin-top: 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .jlex-btn-anki {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        flex: 1;
        padding: 7px 12px;
        font-size: 13px;
        font-weight: 600;
        color: #ffffff;
        background: #2563eb;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.15s ease;
      }

      .jlex-btn-anki:hover {
        background: #1d4ed8;
      }

      .jlex-btn-anki:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .jlex-status-msg {
        font-size: 11px;
        margin-top: 4px;
        text-align: right;
      }
      .jlex-status-success { color: #15803d; }
      .jlex-status-error { color: #b91c1c; }

      /* Audio playing state */
      .jlex-audio-playing {
        color: #2563eb;
        background: #dbeafe;
      }
    `;
    shadowRoot.appendChild(style);
  }

  /**
   * Hide and remove existing popup
   */
  function removePopup() {
    if (currentPopup && currentPopup.parentNode) {
      currentPopup.parentNode.removeChild(currentPopup);
      currentPopup = null;
      activeWordData = null;
    }
  }

  /**
   * Play audio for a word
   */
  function playAudio(word) {
    if (!word) return;

    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    const audioUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&le=jap`;
    const audio = new Audio(audioUrl);
    currentAudio = audio;

    const audioBtn = shadowRoot.querySelector('.jlex-btn-audio');
    if (audioBtn) audioBtn.classList.add('jlex-audio-playing');

    audio.play().catch(() => {
      // Fallback: Web Speech API synthesis
      if ('speechSynthesis' in window) {
        const utter = new SpeechSynthesisUtterance(word);
        utter.lang = 'ja-JP';
        window.speechSynthesis.speak(utter);
      }
    });

    audio.onended = () => {
      if (audioBtn) audioBtn.classList.remove('jlex-audio-playing');
    };
    audio.onerror = () => {
      if (audioBtn) audioBtn.classList.remove('jlex-audio-playing');
    };
  }

  /**
   * Render Popup with word data
   */
  function renderPopup(data, x, y) {
    ensureShadowHost();
    removePopup();

    const popup = document.createElement('div');
    popup.className = 'jlex-popup';

    // Best match item or fallback kanji
    const match = (data.matches && data.matches.length > 0) ? data.matches[0] : null;
    const term = match ? match.term : data.matchedText;
    const reading = match ? match.reading : '';
    const hanviet = match?.hanviet?.text || data.directHanviet?.text || '';
    const defTags = match?.definitionTags || '';

    // Format definitions
    let defsListHtml = '';
    let definitionsPlain = '';
    let definitionsHtmlForAnki = '';

    if (match && match.definitions && match.definitions.length > 0) {
      defsListHtml = match.definitions
        .map((def) => {
          if (typeof def === 'string') return `<li>${escapeHtml(def)}</li>`;
          if (Array.isArray(def)) return `<li>${renderStructuredContent(def)}</li>`;
          if (def && typeof def === 'object') {
            return `<li>${renderStructuredContent(def)}</li>`;
          }
          return `<li>${escapeHtml(String(def))}</li>`;
        })
        .join('');

      definitionsPlain = match.definitions
        .map((d) => (typeof d === 'string' ? d : structuredContentToText(d)))
        .filter(Boolean)
        .join('\n');

      definitionsHtmlForAnki = match.definitions
        .map((d) => (typeof d === 'string' ? escapeHtml(d) : renderStructuredContent(d)))
        .filter(Boolean)
        .join('<br>');
    } else {
      defsListHtml = `<li><em>Không tìm thấy trong từ điển đã nạp.</em></li>`;
    }

    // Save active word data for Anki / Gemini actions
    activeWordData = {
      word: term,
      reading: reading || term,
      hanviet: hanviet,
      definition: definitionsHtmlForAnki || definitionsPlain,
      definitionPlain: definitionsPlain,
      audioUrl: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(term)}&le=jap`,
      aiExample: null
    };

    const viPos = match?.viPos || '';
    const hasExample = Boolean(match?.hasExample || (defsListHtml && (defsListHtml.includes('jlex-sc-example') || defsListHtml.includes('Tatoeba'))));

    popup.innerHTML = `
      <div class="jlex-header">
        <div class="jlex-term-group">
          ${reading ? `<span class="jlex-reading">${escapeHtml(reading)}</span>` : ''}
          <div class="jlex-term-row">
            <span class="jlex-term">${escapeHtml(term)}</span>
            ${hanviet ? `<span class="jlex-badge-hanviet" title="Âm Hán-Việt">[HÁN-VIỆT: ${escapeHtml(hanviet)}]</span>` : ''}
          </div>
        </div>
        <div class="jlex-actions-row">
          <button class="jlex-btn-icon jlex-btn-audio" title="Phát âm">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            </svg>
          </button>
          <button class="jlex-btn-icon jlex-btn-close" title="Đóng">&times;</button>
        </div>
      </div>

      ${viPos ? `<div class="jlex-pos-badge">${escapeHtml(viPos)}</div>` : (defTags ? `<div class="jlex-tags"><span class="jlex-tag">${escapeHtml(defTags)}</span></div>` : '')}

      ${/[\u4e00-\u9faf\u3400-\u4dbf]/.test(term) ? `
      <div class="jlex-strokes-toggle-row" style="margin: 6px 0 8px;">
        <button type="button" class="jlex-btn-toggle-strokes" style="background: none; border: 1px solid #cbd5e1; border-radius: 6px; padding: 3px 8px; font-size: 11.5px; font-weight: 600; color: #2563eb; cursor: pointer;">
          ✍️ Nét viết Kanji
        </button>
        <div class="jlex-strokes-panel" style="display: none; margin-top: 8px; max-height: 220px; overflow-y: auto;">
          <div class="jlex-strokes-loading" style="font-size: 12px; color: #64748b;">Đang tải nét viết...</div>
          <div class="jlex-strokes-content"></div>
        </div>
      </div>
      ` : ''}

      <ol class="jlex-definitions">
        ${defsListHtml}
      </ol>

      <div class="jlex-ai-example-box" style="margin: 10px 0; padding: 10px 12px; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; ${hasExample ? 'display: none;' : ''}">
        <div class="jlex-ai-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 11px; font-weight: 700; color: #7e22ce; text-transform: uppercase; letter-spacing: 0.5px;">✨ Ví dụ AI (Gemini)</span>
          <button type="button" class="jlex-btn-regen-ai" style="display: none; background: none; border: none; font-size: 11px; font-weight: 600; color: #9333ea; cursor: pointer; text-decoration: underline;">🔄 Đổi câu khác</button>
        </div>
        <div class="jlex-ai-content">
          <button type="button" class="jlex-btn-generate-ai" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 12px; background: #ffffff; color: #7e22ce; border: 1px dashed #c084fc; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s ease;">
            <span>✨ Tạo ví dụ bằng AI</span>
          </button>
          <div class="jlex-ai-loading" style="display: none; font-size: 12px; color: #7e22ce; text-align: center; padding: 4px;">
            ⏳ Đang dùng Gemini AI tạo ví dụ...
          </div>
          <div class="jlex-ai-result" style="display: none;">
            <div class="jlex-ai-jp" style="font-size: 14.5px; font-weight: 600; line-height: 1.9; color: #1e293b;"></div>
            <div class="jlex-ai-vi" style="font-size: 12.5px; color: #64748b; font-style: italic; margin-top: 4px; line-height: 1.4;"></div>
          </div>
          <div class="jlex-ai-error" style="display: none; font-size: 11.5px; color: #dc2626; margin-top: 4px; line-height: 1.4;"></div>
        </div>
      </div>

      ${hasExample ? `
      <div class="jlex-ai-toggle-wrap" style="margin: 6px 0 10px;">
        <button type="button" class="jlex-btn-toggle-ai" style="background: none; border: 1px dashed #c084fc; border-radius: 6px; padding: 4px 10px; font-size: 11.5px; font-weight: 600; color: #7e22ce; cursor: pointer; width: 100%; text-align: center;">
          ✨ Tạo thêm câu ví dụ bằng AI (Gemini)
        </button>
      </div>
      ` : ''}

      <div class="jlex-anki-section">
        <button class="jlex-btn-anki">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
          <span>Thêm vào Anki</span>
        </button>
      </div>
      <div class="jlex-status-msg"></div>
    `;

    // AI Example Handler
    const aiBox = popup.querySelector('.jlex-ai-example-box');
    if (aiBox) {
      const btnGen = aiBox.querySelector('.jlex-btn-generate-ai');
      const btnRegen = aiBox.querySelector('.jlex-btn-regen-ai');
      const loadingEl = aiBox.querySelector('.jlex-ai-loading');
      const resultEl = aiBox.querySelector('.jlex-ai-result');
      const jpEl = aiBox.querySelector('.jlex-ai-jp');
      const viEl = aiBox.querySelector('.jlex-ai-vi');
      const errorEl = aiBox.querySelector('.jlex-ai-error');
      const toggleAiBtn = popup.querySelector('.jlex-btn-toggle-ai');

      if (toggleAiBtn) {
        toggleAiBtn.onclick = () => {
          aiBox.style.display = 'block';
          toggleAiBtn.style.display = 'none';
          triggerGenerate(false);
        };
      }

      const triggerGenerate = (force = false) => {
        if (btnGen) btnGen.style.display = 'none';
        if (resultEl) resultEl.style.display = 'none';
        if (errorEl) errorEl.style.display = 'none';
        if (btnRegen) btnRegen.style.display = 'none';
        if (loadingEl) loadingEl.style.display = 'block';

        chrome.runtime.sendMessage(
          {
            type: 'GENERATE_AI_EXAMPLE',
            payload: {
              word: activeWordData.word,
              reading: activeWordData.reading,
              definition: activeWordData.definitionPlain,
              forceRegenerate: force
            }
          },
          (res) => {
            if (loadingEl) loadingEl.style.display = 'none';
            if (res && res.success && res.data) {
              const { ex_furigana, ex_vi } = res.data;
              activeWordData.aiExample = {
                jp: ex_furigana,
                vi: ex_vi
              };
              if (jpEl) jpEl.innerHTML = ex_furigana;
              if (viEl) viEl.textContent = ex_vi;
              if (resultEl) resultEl.style.display = 'block';
              if (btnRegen) btnRegen.style.display = 'inline-block';
            } else {
              const errMsg = res?.error || 'Không thể tạo ví dụ AI.';
              if (errMsg.includes('NO_API_KEY')) {
                if (errorEl) {
                  errorEl.innerHTML = `💡 Chưa có Gemini API Key. <a href="#" class="jlex-link-options" style="color:#2563eb; text-decoration:underline; font-weight:600;">Nhập key miễn phí ↗</a>`;
                  const link = errorEl.querySelector('.jlex-link-options');
                  if (link) {
                    link.onclick = (e) => {
                      e.preventDefault();
                      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
                    };
                  }
                  errorEl.style.display = 'block';
                }
              } else {
                if (errorEl) {
                  errorEl.textContent = `Lỗi: ${errMsg}`;
                  errorEl.style.display = 'block';
                }
                if (btnGen) btnGen.style.display = 'flex';
              }
            }
          }
        );
      };

      if (btnGen) btnGen.onclick = () => triggerGenerate(false);
      if (btnRegen) btnRegen.onclick = () => triggerGenerate(true);

      // Auto-trigger if enabled in settings and dictionary doesn't have examples
      if (!hasExample && settings.autoAiExamples) {
        triggerGenerate(false);
      }
    }

    // Bind event listeners
    popup.querySelector('.jlex-btn-close').onclick = removePopup;
    popup.querySelector('.jlex-btn-audio').onclick = () => playAudio(term);

    // Toggle Kanji Strokes Click
    const toggleStrokesBtn = popup.querySelector('.jlex-btn-toggle-strokes');
    const strokesPanel = popup.querySelector('.jlex-strokes-panel');
    if (toggleStrokesBtn && strokesPanel) {
      toggleStrokesBtn.onclick = () => {
        if (strokesPanel.style.display === 'none') {
          strokesPanel.style.display = 'block';
          toggleStrokesBtn.textContent = 'Ẩn nét viết Kanji';
          const contentEl = strokesPanel.querySelector('.jlex-strokes-content');
          const loadingEl = strokesPanel.querySelector('.jlex-strokes-loading');
          if (!contentEl.innerHTML.trim()) {
            chrome.runtime.sendMessage({
              type: 'GET_KANJI_STROKES',
              payload: { word: term }
            }, (res) => {
              if (loadingEl) loadingEl.style.display = 'none';
              if (res && res.success && Array.isArray(res.data) && res.data.length > 0) {
                contentEl.innerHTML = res.data.map(item => `
                  <div class="jlex-stroke-item" style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; margin-bottom: 8px; text-align: center;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                      <span style="font-size: 15px; font-weight: 700; color: #2563eb;">${escapeHtml(item.char)} - ${escapeHtml(item.hanviet)}</span>
                      <button type="button" class="jlex-btn-replay-stroke" style="background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 5px; cursor: pointer;">🔄 Viết lại</button>
                    </div>
                    ${item.svg ? `<div class="jlex-stroke-diagram" style="width: 130px; height: 130px; margin: 0 auto; display: flex; align-items: center; justify-content: center; cursor: pointer;" title="Bấm vào hình để viết lại nét">${item.svg}</div>` : '<div style="font-size: 12px; color: #94a3b8;">Không có dữ liệu nét vẽ</div>'}
                  </div>
                `).join('');

                contentEl.querySelectorAll('.jlex-btn-replay-stroke').forEach(btn => {
                  btn.onclick = (e) => {
                    const card = e.target.closest('.jlex-stroke-item');
                    const svg = card?.querySelector('svg');
                    if (svg) {
                      const clone = svg.cloneNode(true);
                      svg.parentNode.replaceChild(clone, svg);
                    }
                  };
                });

                contentEl.querySelectorAll('.jlex-stroke-diagram').forEach(box => {
                  box.onclick = () => {
                    const svg = box.querySelector('svg');
                    if (svg) {
                      const clone = svg.cloneNode(true);
                      svg.parentNode.replaceChild(clone, svg);
                    }
                  };
                });
              } else {
                contentEl.innerHTML = '<div style="font-size: 12px; color: #94a3b8;">Không tải được nét viết.</div>';
              }
            });
          }
        } else {
          strokesPanel.style.display = 'none';
          toggleStrokesBtn.textContent = '✍️ Nét viết Kanji';
        }
      };
    }

    // Check if word already exists in Anki
    const ankiBtn = popup.querySelector('.jlex-btn-anki');
    const statusMsg = popup.querySelector('.jlex-status-msg');

    chrome.runtime.sendMessage(
      {
        type: 'CHECK_NOTE_EXISTS',
        payload: { word: activeWordData.word }
      },
      (res) => {
        if (res && res.success && res.data && res.data.exists) {
          ankiBtn.disabled = true;
          ankiBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>✓ Đã có trong Anki</span>
          `;
          ankiBtn.style.background = '#059669';
          ankiBtn.style.cursor = 'not-allowed';
          ankiBtn.style.opacity = '0.85';
        }
      }
    );

    // Anki Click
    ankiBtn.onclick = () => {
      ankiBtn.disabled = true;
      ankiBtn.innerHTML = `<span>⏳ Đang tạo ví dụ AI & lưu Anki...</span>`;
      statusMsg.textContent = '';

      chrome.runtime.sendMessage(
        {
          type: 'ADD_TO_ANKI',
          payload: {
            word: activeWordData.word,
            reading: activeWordData.reading,
            hanviet: activeWordData.hanviet,
            definition: activeWordData.definition,
            example: activeWordData.aiExample ? activeWordData.aiExample.jp : '',
            aiExample: activeWordData.aiExample,
            audioUrl: activeWordData.audioUrl
          }
        },
        (res) => {
          if (res && res.success) {
            ankiBtn.disabled = true;
            ankiBtn.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>✓ Đã thêm vào Anki</span>
            `;
            ankiBtn.style.background = '#059669';
            ankiBtn.style.cursor = 'not-allowed';
            ankiBtn.style.opacity = '0.85';
            statusMsg.className = 'jlex-status-msg jlex-status-success';
            statusMsg.textContent = '✓ Đã tạo ví dụ & lưu vào Anki thành công!';
          } else {
            const errStr = res?.error || '';
            if (errStr.includes('đã tồn tại') || errStr.includes('duplicate') || errStr.includes('đã có')) {
              ankiBtn.disabled = true;
              ankiBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span>✓ Đã có trong Anki</span>
              `;
              ankiBtn.style.background = '#059669';
              ankiBtn.style.cursor = 'not-allowed';
              ankiBtn.style.opacity = '0.85';
              statusMsg.className = 'jlex-status-msg jlex-status-success';
              statusMsg.textContent = 'Từ này đã có sẵn trong Anki!';
            } else {
              ankiBtn.disabled = false;
              ankiBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
                <span>Thêm vào Anki</span>
              `;
              statusMsg.className = 'jlex-status-msg jlex-status-error';
              statusMsg.textContent = `✕ Lỗi Anki: ${errStr || 'Chưa bật AnkiConnect'}`;
            }
          }
        }
      );
    };

    // Position popup properly
    const padding = 12;
    const popupWidth = 360;
    const popupHeight = 320;

    let posX = x + 10;
    let posY = y + 15;

    // Boundary check right
    if (posX + popupWidth > window.innerWidth - padding) {
      posX = window.innerWidth - popupWidth - padding;
    }
    // Boundary check bottom
    if (posY + popupHeight > window.innerHeight - padding) {
      posY = Math.max(padding, y - popupHeight - 15);
    }

    popup.style.left = `${Math.max(padding, posX)}px`;
    popup.style.top = `${Math.max(padding, posY)}px`;

    shadowRoot.appendChild(popup);
    currentPopup = popup;
  }

  /**
   * Helper: Escape HTML special characters
   */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

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

  function formatPosList(content) {
    if (!content) return '';
    const items = Array.isArray(content) ? content : [content];
    const mapped = [];

    items.forEach((item) => {
      if (typeof item !== 'string') return;
      let s = item.toLowerCase().trim();

      if (s.includes('danh từ') || s.includes('noun')) { mapped.push('Noun'); s = s.replace(/danh\s*từ|noun/g, ''); }
      if (s.includes('suru') || s.includes('vs')) { mapped.push('Suru verb'); s = s.replace(/(?:động từ\s+)?suru|vs/g, ''); }
      if (s.includes('chuyển tiếp') || s.includes('tha động từ') || s.includes('ngoại động từ') || s.includes('vt') || s.includes('transitive')) {
        mapped.push('Transitive verb');
        s = s.replace(/chuyển\s*tiếp|tha\s*động\s*từ|ngoại\s*động\s*từ|transitive|vt/g, '');
      }
      if (s.includes('tự động từ') || s.includes('nội động từ') || s.includes('vi') || s.includes('intransitive')) {
        mapped.push('Intransitive verb');
        s = s.replace(/tự\s*động\s*từ|nội\s*động\s*từ|intransitive|vi/g, '');
      }

      const parts = s.split(/[,/•\s]+/).filter(Boolean);
      parts.forEach((token) => {
        const found = POS_ENGLISH_MAP[token];
        if (found) mapped.push(found);
        else if (token.length > 1 && !['and', 'of', 'with', 'for', 'và', 'của', 'với', 'cho'].includes(token)) {
          mapped.push(token.charAt(0).toUpperCase() + token.slice(1));
        }
      });
    });

    return Array.from(new Set(mapped)).join(' • ');
  }

  /**
   * Helper: Render Yomitan / Jitendex structured content to safe HTML
   */
  function renderStructuredContent(node, insideRuby = false) {
    if (node === null || node === undefined) return '';
    if (typeof node === 'string') return escapeHtml(node);
    if (typeof node === 'number') return String(node);

    if (Array.isArray(node)) {
      const hasRt = !insideRuby && node.some((item) => item && typeof item === 'object' && item.tag === 'rt');
      const renderedItems = node.map((item) => renderStructuredContent(item, insideRuby || hasRt)).join(insideRuby ? '' : ' ');
      return hasRt ? `<ruby>${renderedItems}</ruby>` : renderedItems;
    }

    if (typeof node === 'object') {
      if (node.type === 'structured-content' && node.content !== undefined) {
        return renderStructuredContent(node.content, insideRuby);
      }

      // POS badge rendering
      if (node.data && typeof node.data === 'object' && node.data.content === 'partOfSpeech') {
        const posText = formatPosList(node.content);
        return `<span class="jlex-pos-badge" style="display:inline-block; margin-right:6px; margin-bottom:4px;">${escapeHtml(posText)}</span>`;
      }

      // Skip forms and frequency blocks
      if (node.data && typeof node.data === 'object' && (node.data.content === 'forms' || node.data.content === 'frequency')) {
        return '';
      }

      const tag = (node.tag || 'span').toLowerCase();
      const isRuby = tag === 'ruby';
      const innerHtml = node.content !== undefined ? renderStructuredContent(node.content, insideRuby || isRuby) : '';

      let classes = [];
      if (node.data && typeof node.data === 'object' && node.data.content) {
        classes.push(`jlex-sc-${node.data.content}`);
      }

      let attrs = classes.length > 0 ? ` class="${classes.join(' ')}"` : '';
      if (tag === 'a' && node.href) {
        attrs += ` href="${escapeHtml(node.href)}" target="_blank" rel="noopener noreferrer"`;
      }
      if (node.lang) {
        attrs += ` lang="${escapeHtml(node.lang)}"`;
      }
      if (node.title) {
        attrs += ` title="${escapeHtml(node.title)}"`;
      }

      const allowedTags = [
        'ruby', 'rt', 'rp',
        'span', 'div', 'p',
        'ol', 'ul', 'li',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'b', 'strong', 'i', 'em', 'u', 's', 'small',
        'a', 'details', 'summary'
      ];

      if (allowedTags.includes(tag)) {
        return `<${tag}${attrs}>${innerHtml}</${tag}>`;
      }

      return `<span${attrs}>${innerHtml}</span>`;
    }

    return '';
  }

  /**
   * Helper: Convert Yomitan / Jitendex structured content to plain text
   */
  function structuredContentToText(node) {
    if (node === null || node === undefined) return '';
    if (typeof node === 'string') return node;
    if (typeof node === 'number') return String(node);
    if (Array.isArray(node)) {
      return node.map(structuredContentToText).join(' ');
    }
    if (typeof node === 'object') {
      if (node.type === 'structured-content' && node.content !== undefined) {
        return structuredContentToText(node.content);
      }
      if (node.tag === 'rt') {
        return '';
      }
      return structuredContentToText(node.content);
    }
    return '';
  }

  /**
   * Get text node at point and extract text stream
   */
  function getTextAtPoint(x, y) {
    let range;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }

    if (!range || !range.startContainer) return null;

    let textNode = range.startContainer;
    let offset = range.startOffset;

    // If caret resolved to an Element instead of a Text node, traverse to its text node
    if (textNode.nodeType === Node.ELEMENT_NODE) {
      if (textNode.childNodes && textNode.childNodes[offset]) {
        textNode = textNode.childNodes[offset];
        offset = 0;
      } else if (textNode.firstChild) {
        textNode = textNode.firstChild;
        offset = 0;
      }
    }

    while (textNode && textNode.nodeType !== Node.TEXT_NODE && textNode.firstChild) {
      textNode = textNode.firstChild;
    }

    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;

    const text = textNode.nodeValue || '';
    return text.slice(offset, offset + settings.maxScanLength);
  }

  /**
   * Get selected text across normal text and input/textarea fields
   */
  function getSelectedText() {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      const start = active.selectionStart;
      const end = active.selectionEnd;
      if (typeof start === 'number' && typeof end === 'number' && start < end) {
        return active.value.substring(start, end).trim();
      }
    }

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      return sel.toString().trim();
    }

    return '';
  }

  /**
   * Check if text contains Japanese characters (Hiragana, Katakana, Halfwidth, Kanji Joyo/Jinmeiyo/Ext)
   */
  function hasJapanese(str) {
    if (!str || typeof str !== 'string') return false;
    return /[\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F\u4E00-\u9FAF\u3400-\u4DBF\uF900-\uFAFF]/.test(str);
  }

  /**
   * Mousemove + Trigger key handler (Capturing Phase)
   */
  document.addEventListener('mousemove', (e) => {
    if (!settings.enableScan) return;

    // Check trigger key condition
    let isTriggered = false;
    if (settings.triggerKey === 'Shift' && e.shiftKey) isTriggered = true;
    else if (settings.triggerKey === 'Alt' && e.altKey) isTriggered = true;
    else if (settings.triggerKey === 'Ctrl' && (e.ctrlKey || e.metaKey)) isTriggered = true;

    if (!isTriggered) return;

    const textAhead = getTextAtPoint(e.clientX, e.clientY);
    if (!textAhead || !hasJapanese(textAhead)) return;

    if (textAhead === lastLookupQuery) return;
    lastLookupQuery = textAhead;

    chrome.runtime.sendMessage(
      {
        type: 'LOOKUP_TERM',
        payload: { text: textAhead, maxScanLength: settings.maxScanLength }
      },
      (response) => {
        if (response && response.success && (response.data.matches.length > 0 || response.data.directHanviet)) {
          renderPopup(response.data, e.clientX, e.clientY);
        }
      }
    );
  }, true);

  /**
   * Mouseup handler for selected text (Capturing Phase)
   */
  document.addEventListener('mouseup', (e) => {
    // Ignore click inside our own shadow popup
    if (hostElement && e.composedPath().includes(hostElement)) return;

    const selectedText = getSelectedText();
    if (!selectedText || !hasJapanese(selectedText)) return;

    chrome.runtime.sendMessage(
      {
        type: 'LOOKUP_TERM',
        payload: { text: selectedText, maxScanLength: settings.maxScanLength }
      },
      (response) => {
        if (response && response.success && (response.data.matches.length > 0 || response.data.directHanviet)) {
          renderPopup(response.data, e.clientX, e.clientY);
        }
      }
    );
  }, true);

  /**
   * Dismiss on click outside or Escape key (Capturing Phase)
   */
  document.addEventListener('mousedown', (e) => {
    if (currentPopup && hostElement && !e.composedPath().includes(hostElement)) {
      removePopup();
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentPopup) {
      removePopup();
    }
  }, true);
})();
