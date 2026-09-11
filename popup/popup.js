/**
 * J-Lexicon AI Popup Script
 */

const quickSearchInput = document.getElementById('quick-search-input');
const btnQuickSearch = document.getElementById('btn-quick-search');
const searchResults = document.getElementById('search-results');
const btnOpenOptions = document.getElementById('btn-open-options');
const toggleHoverScan = document.getElementById('toggle-hover-scan');

const pillDict = document.getElementById('pill-dict');
const dictCount = document.getElementById('dict-count');
const pillAnki = document.getElementById('pill-anki');
const ankiStatus = document.getElementById('anki-status');
const dictEmptyBanner = document.getElementById('dict-empty-banner');
const btnPopupInstallDict = document.getElementById('btn-popup-install-dict');

let autoAiExamples = true;

document.addEventListener('DOMContentLoaded', async () => {
  // Open options button
  btnOpenOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 1-Click install button in popup
  if (btnPopupInstallDict) {
    btnPopupInstallDict.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html?autodownload=1') });
    });
  }

  // Load toggle state
  const config = await chrome.storage.local.get({ enableScan: true, ankiUrl: 'http://localhost:8765', autoAiExamples: true });
  toggleHoverScan.checked = config.enableScan === true || config.enableScan === 'true';
  autoAiExamples = config.autoAiExamples !== false;

  toggleHoverScan.addEventListener('change', async () => {
    const isEnabled = toggleHoverScan.checked;
    await chrome.storage.local.set({ enableScan: isEnabled });

    // Broadcast immediately to all open tabs so current pages update in real-time
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
      console.warn('[Popup] Broadcast error:', e);
    }
  });

  // Check Dictionary status
  chrome.runtime.sendMessage({ type: 'GET_STATS' }, (res) => {
    if (res && res.success) {
      const count = res.data.totalTerms || 0;
      if (count > 0) {
        pillDict.className = 'status-pill online';
        dictCount.textContent = `${count.toLocaleString('vi-VN')} từ`;
        if (dictEmptyBanner) dictEmptyBanner.style.display = 'none';
      } else {
        pillDict.className = 'status-pill offline';
        dictCount.textContent = 'Chưa nạp từ điển';
        if (dictEmptyBanner) dictEmptyBanner.style.display = 'block';
      }
    } else {
      pillDict.className = 'status-pill offline';
      dictCount.textContent = 'Lỗi DB';
      if (dictEmptyBanner) dictEmptyBanner.style.display = 'block';
    }
  });

  // Check Anki status
  chrome.runtime.sendMessage(
    { type: 'TEST_ANKI_CONNECTION', payload: { ankiUrl: config.ankiUrl } },
    (res) => {
      if (res && res.success) {
        pillAnki.className = 'status-pill online';
        ankiStatus.textContent = 'Anki: Kết nối';
      } else {
        pillAnki.className = 'status-pill offline';
        ankiStatus.textContent = 'Anki: Ngắt kết nối';
      }
    }
  );

  // Quick search
  btnQuickSearch.addEventListener('click', executeSearch);
  quickSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') executeSearch();
  });
});

async function executeSearch() {
  const query = quickSearchInput.value.trim();
  if (!query) return;

  searchResults.innerHTML = '<div style="text-align: center; color: #64748b; padding: 12px;">Đang tìm kiếm...</div>';

  chrome.runtime.sendMessage(
    { type: 'LOOKUP_TERM', payload: { text: query, maxScanLength: 16 } },
    (res) => {
      if (!res || !res.success) {
        searchResults.innerHTML = `<div style="color: #ef4444; padding: 8px;">Lỗi: ${res?.error || 'Không tìm được'}</div>`;
        return;
      }

      const data = res.data;
      if ((!data.matches || data.matches.length === 0) && !data.directHanviet) {
        searchResults.innerHTML = '<div style="color: #64748b; padding: 8px;">Không tìm thấy kết quả trong từ điển.</div>';
        return;
      }

      renderResults(data);
    }
  );
}

function renderResults(data) {
  searchResults.innerHTML = '';

  const matches = data.matches || [];
  if (matches.length === 0 && data.directHanviet) {
    // Only kanji hanviet found
    const card = document.createElement('div');
    card.className = 'result-card';
    card.innerHTML = `
      <div class="result-header">
        <div>
          <span class="result-term">${escapeHtml(data.matchedText)}</span>
          <span class="result-hanviet">${escapeHtml(data.directHanviet.text)}</span>
        </div>
      </div>
      <p style="color: #64748b; font-size: 11px;">Chưa nạp nghĩa từ vựng này trong từ điển. Bạn có thể mở Options để nạp thêm Jitendex.</p>
    `;
    searchResults.appendChild(card);
    return;
  }

  matches.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'result-card';

    const hanviet = item.hanviet?.text || '';
    const defs = item.definitions || [];
    const defsHtml = defs
      .slice(0, 3)
      .map((d) => `<li>${typeof d === 'string' ? escapeHtml(d) : renderStructuredContent(d)}</li>`)
      .join('');
    const defsPlain = defs
      .map((d) => (typeof d === 'string' ? d : structuredContentToText(d)))
      .filter(Boolean)
      .join('\n');
    const defsHtmlForAnki = defs
      .map((d) => (typeof d === 'string' ? escapeHtml(d) : renderStructuredContent(d)))
      .filter(Boolean)
      .join('<br>');

    const viPos = item.viPos || '';
    const hasExample = Boolean(item.hasExample || (defsHtml && (defsHtml.includes('jlex-sc-example') || defsHtml.includes('Tatoeba'))));

    card.innerHTML = `
      <div class="result-header">
        <div>
          <span class="result-term">${escapeHtml(item.term)}</span>
          ${item.reading ? `<span class="result-reading">【${escapeHtml(item.reading)}】</span>` : ''}
          ${hanviet ? `<span class="result-hanviet">[HÁN-VIỆT: ${escapeHtml(hanviet)}]</span>` : ''}
        </div>
        <button class="icon-btn btn-audio" title="Phát âm">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          </svg>
        </button>
      </div>

      ${viPos ? `<div class="result-pos-badge">${escapeHtml(viPos)}</div>` : ''}

      <ol class="result-defs">
        ${defsHtml}
      </ol>

      ${/[\u4e00-\u9faf\u3400-\u4dbf]/.test(item.term) ? `
      <div class="strokes-toggle-row" style="margin: 6px 0 10px;">
        <button type="button" class="btn-toggle-strokes" style="background: none; border: 1px solid #cbd5e1; border-radius: 6px; padding: 3px 8px; font-size: 11.5px; font-weight: 600; color: #2563eb; cursor: pointer;">
          ✍️ Nét viết Kanji
        </button>
        <div class="strokes-panel" style="display: none; margin-top: 8px; max-height: 220px; overflow-y: auto;">
          <div class="strokes-loading" style="font-size: 12px; color: #64748b;">Đang tải nét viết...</div>
          <div class="strokes-content"></div>
        </div>
      </div>
      ` : ''}

      <div class="ai-example-box" style="margin: 8px 0 10px; padding: 10px; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; ${hasExample ? 'display: none;' : ''}">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 11px; font-weight: 700; color: #7e22ce; text-transform: uppercase;">✨ Ví dụ AI (Gemini)</span>
          <button type="button" class="btn-regen-ai" style="display: none; background: none; border: none; font-size: 11px; font-weight: 600; color: #9333ea; cursor: pointer; text-decoration: underline;">🔄 Đổi câu khác</button>
        </div>
        <div class="ai-content-wrap">
          <button type="button" class="btn-generate-ai" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 10px; background: #ffffff; color: #7e22ce; border: 1px dashed #c084fc; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
            <span>✨ Tạo ví dụ bằng AI</span>
          </button>
          <div class="ai-loading" style="display: none; font-size: 12px; color: #7e22ce; text-align: center; padding: 4px;">
            ⏳ Đang dùng Gemini AI tạo ví dụ...
          </div>
          <div class="ai-result" style="display: none;">
            <div class="ai-jp" style="font-size: 14px; font-weight: 600; line-height: 1.8; color: #1e293b;"></div>
            <div class="ai-vi" style="font-size: 12px; color: #64748b; font-style: italic; margin-top: 4px; line-height: 1.4;"></div>
          </div>
          <div class="ai-error" style="display: none; font-size: 11px; color: #dc2626; margin-top: 4px;"></div>
        </div>
      </div>

      ${hasExample ? `
      <div class="ai-toggle-wrap" style="margin: 6px 0 10px;">
        <button type="button" class="btn-toggle-ai-ex" style="background: none; border: 1px dashed #c084fc; border-radius: 6px; padding: 4px 10px; font-size: 11.5px; font-weight: 600; color: #7e22ce; cursor: pointer; width: 100%; text-align: center;">
          ✨ Tạo thêm câu ví dụ bằng AI (Gemini)
        </button>
      </div>
      ` : ''}

      <div class="result-btn-row">
        <button class="btn-act btn-act-primary btn-add-anki" style="flex: 1;">⭐ Thêm vào Anki</button>
      </div>
    `;

    // Audio click
    card.querySelector('.btn-audio').onclick = () => {
      const audioUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(item.term)}&le=jap`;
      new Audio(audioUrl).play().catch(() => {
        if ('speechSynthesis' in window) {
          const u = new SpeechSynthesisUtterance(item.term);
          u.lang = 'ja-JP';
          window.speechSynthesis.speak(u);
        }
      });
    };

    // Toggle Kanji Strokes Click
    const toggleStrokesBtn = card.querySelector('.btn-toggle-strokes');
    const strokesPanel = card.querySelector('.strokes-panel');
    if (toggleStrokesBtn && strokesPanel) {
      toggleStrokesBtn.onclick = () => {
        if (strokesPanel.style.display === 'none') {
          strokesPanel.style.display = 'block';
          toggleStrokesBtn.textContent = 'Ẩn nét viết Kanji';
          const contentEl = strokesPanel.querySelector('.strokes-content');
          const loadingEl = strokesPanel.querySelector('.strokes-loading');
          if (!contentEl.innerHTML.trim()) {
            chrome.runtime.sendMessage({
              type: 'GET_KANJI_STROKES',
              payload: { word: item.term }
            }, (res) => {
              if (loadingEl) loadingEl.style.display = 'none';
              if (res && res.success && Array.isArray(res.data) && res.data.length > 0) {
                contentEl.innerHTML = res.data.map(k => `
                  <div class="stroke-item-card" style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; margin-bottom: 8px; text-align: center;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                      <span style="font-size: 15px; font-weight: 700; color: #2563eb;">${escapeHtml(k.char)} - ${escapeHtml(k.hanviet)}</span>
                      <button type="button" class="btn-replay-stroke" style="background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 5px; cursor: pointer;">🔄 Viết lại</button>
                    </div>
                    ${k.svg ? `<div class="stroke-diagram-box" style="width: 130px; height: 130px; margin: 0 auto; display: flex; align-items: center; justify-content: center; cursor: pointer;" title="Bấm vào hình để viết lại nét">${k.svg}</div>` : '<div style="font-size: 12px; color: #94a3b8;">Không có dữ liệu nét vẽ</div>'}
                  </div>
                `).join('');

                contentEl.querySelectorAll('.btn-replay-stroke').forEach(btn => {
                  btn.onclick = (e) => {
                    const itemCard = e.target.closest('.stroke-item-card');
                    const svg = itemCard?.querySelector('svg');
                    if (svg) {
                      const clone = svg.cloneNode(true);
                      svg.parentNode.replaceChild(clone, svg);
                    }
                  };
                });

                contentEl.querySelectorAll('.stroke-diagram-box').forEach(box => {
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

    // AI Example Handler
    const aiBox = card.querySelector('.ai-example-box');
    if (aiBox) {
      const btnGen = aiBox.querySelector('.btn-generate-ai');
      const btnRegen = aiBox.querySelector('.btn-regen-ai');
      const loadingEl = aiBox.querySelector('.ai-loading');
      const resultEl = aiBox.querySelector('.ai-result');
      const jpEl = aiBox.querySelector('.ai-jp');
      const viEl = aiBox.querySelector('.ai-vi');
      const errorEl = aiBox.querySelector('.ai-error');

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
              word: item.term,
              reading: item.reading,
              definition: defsPlain,
              forceRegenerate: force
            }
          },
          (res) => {
            if (loadingEl) loadingEl.style.display = 'none';
            if (res && res.success && res.data) {
              const { ex_furigana, ex_vi } = res.data;
              item.aiExample = {
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
                  errorEl.innerHTML = `💡 Chưa có Gemini API Key. <a href="#" class="link-open-options" style="color:#2563eb; text-decoration:underline; font-weight:600;">Nhập key miễn phí ↗</a>`;
                  const link = errorEl.querySelector('.link-open-options');
                  if (link) {
                    link.onclick = (e) => {
                      e.preventDefault();
                      chrome.runtime.openOptionsPage();
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

      const toggleAiBtn = card.querySelector('.btn-toggle-ai-ex');
      if (toggleAiBtn) {
        toggleAiBtn.onclick = () => {
          aiBox.style.display = 'block';
          toggleAiBtn.style.display = 'none';
          triggerGenerate(false);
        };
      }

      if (!hasExample && autoAiExamples) {
        triggerGenerate(false);
      }
    }

    // Anki Click
    const btnAddAnki = card.querySelector('.btn-add-anki');

    // Check if word already exists in Anki
    chrome.runtime.sendMessage(
      {
        type: 'CHECK_NOTE_EXISTS',
        payload: { word: item.term, reading: item.reading }
      },
      (res) => {
        if (res && res.success && res.data && res.data.exists) {
          btnAddAnki.disabled = true;
          btnAddAnki.textContent = '✓ Đã có trong Anki';
          btnAddAnki.style.background = '#059669';
          btnAddAnki.style.cursor = 'not-allowed';
          btnAddAnki.style.opacity = '0.85';
        }
      }
    );

    btnAddAnki.onclick = () => {
      btnAddAnki.disabled = true;
      btnAddAnki.textContent = '⏳ Đang tạo ví dụ & lưu...';

      chrome.runtime.sendMessage(
        {
          type: 'ADD_TO_ANKI',
          payload: {
            word: item.term,
            reading: item.reading,
            hanviet: hanviet,
            definition: defsHtmlForAnki || defsPlain,
            example: item.aiExample ? item.aiExample.jp : '',
            aiExample: item.aiExample,
            audioUrl: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(item.term)}&le=jap`
          }
        },
        (res) => {
          if (res && res.success) {
            btnAddAnki.disabled = true;
            btnAddAnki.textContent = '✓ Đã thêm vào Anki';
            btnAddAnki.style.background = '#059669';
            btnAddAnki.style.cursor = 'not-allowed';
            btnAddAnki.style.opacity = '0.85';
          } else {
            const errStr = res?.error || '';
            if (errStr.includes('đã tồn tại') || errStr.includes('duplicate') || errStr.includes('đã có')) {
              btnAddAnki.disabled = true;
              btnAddAnki.textContent = '✓ Đã có trong Anki';
              btnAddAnki.style.background = '#059669';
              btnAddAnki.style.cursor = 'not-allowed';
              btnAddAnki.style.opacity = '0.85';
            } else {
              btnAddAnki.disabled = false;
              btnAddAnki.textContent = '⭐ Thêm vào Anki';
              alert(`Lỗi Anki: ${errStr || 'Chưa bật AnkiConnect'}`);
            }
          }
        }
      );
    };

    searchResults.appendChild(card);
  });
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

    if (node.data && typeof node.data === 'object' && node.data.content === 'partOfSpeech') {
      const posText = formatPosList(node.content);
      return `<span class="result-pos-badge" style="display:inline-block; margin-right:6px; margin-bottom:4px;">${escapeHtml(posText)}</span>`;
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

function structuredContentToText(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) {
    return node.map(structuredContentToText).join('');
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
