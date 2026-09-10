/**
 * J-Lexicon AI Options Controller
 */

import { dictDB } from '../lib/db.js';
import { ZipReader } from '../lib/zip-reader.js';

// DOM Elements
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const toastEl = document.getElementById('toast');

// Stats Elements
const statTotalTerms = document.getElementById('stat-total-terms');
const statLastUpdated = document.getElementById('stat-last-updated');
const btnClearDb = document.getElementById('btn-clear-db');

// Auto Download & Local Dict Elements
const btnAutoDownload = document.getElementById('btn-auto-download');
const autoDownloadUrlInput = document.getElementById('auto-download-url');
const btnResetDownloadUrl = document.getElementById('btn-reset-download-url');
const localDictBox = document.getElementById('local-dict-box');
const btnLoadLocalDict = document.getElementById('btn-load-local-dict');

// Dropzone & Progress
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const progressContainer = document.getElementById('import-progress-container');
const progressBar = document.getElementById('import-progress-bar');
const statusText = document.getElementById('import-status-text');

// Gemini Elements
const geminiApiKeyInput = document.getElementById('gemini-api-key');
const btnToggleKey = document.getElementById('btn-toggle-key');
const geminiModelSelect = document.getElementById('gemini-model');
const btnFetchModels = document.getElementById('btn-fetch-models');
const geminiPromptText = document.getElementById('gemini-prompt');
const autoAiExamplesCheckbox = document.getElementById('auto-ai-examples');
const btnSaveGemini = document.getElementById('btn-save-gemini');
const btnTestGemini = document.getElementById('btn-test-gemini');
const geminiTestResult = document.getElementById('gemini-test-result');

// Anki Elements
const ankiUrlInput = document.getElementById('anki-url');
const btnTestAnki = document.getElementById('btn-test-anki');
const ankiTestResult = document.getElementById('anki-test-result');
const ankiInfoCard = document.getElementById('anki-info-card');
const ankiSummaryPill = document.getElementById('anki-summary-pill');
const currentDeckNameBadge = document.getElementById('current-deck-name-badge');

const ankiDeckSelect = document.getElementById('anki-deck-select');
const ankiDeckInput = document.getElementById('anki-deck');
const btnToggleCustomDeck = document.getElementById('btn-toggle-custom-deck');

const ankiModelSelect = document.getElementById('anki-model-select');
const ankiModelInput = document.getElementById('anki-model');
const btnToggleCustomModel = document.getElementById('btn-toggle-custom-model');

const fieldMappingDesc = document.getElementById('field-mapping-desc');
const fieldWord = document.getElementById('field-word');
const fieldReading = document.getElementById('field-reading');
const fieldHanviet = document.getElementById('field-hanviet');
const fieldDefinition = document.getElementById('field-definition');
const fieldExample = document.getElementById('field-example');
const fieldAudio = document.getElementById('field-audio');
const btnSetupLinguist = document.getElementById('btn-setup-linguist');
const linguistSetupResult = document.getElementById('linguist-setup-result');
const btnSaveAnki = document.getElementById('btn-save-anki');

// General Elements
const triggerKeySelect = document.getElementById('trigger-key');
const enableScanCheckbox = document.getElementById('enable-scan');
const maxScanLengthInput = document.getElementById('max-scan-length');
const btnSaveGeneral = document.getElementById('btn-save-general');

/**
 * Initialize page
 */
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  await loadSettings();
  await refreshDbStats();
  setupDropzone();
  checkAndShowLocalDict();

  // Tự động kích hoạt tải nếu mở từ popup qua nút 1-Click
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('autodownload') === '1' || window.location.hash === '#autodownload') {
    const dictTabBtn = document.querySelector('[data-tab="dict-tab"]');
    if (dictTabBtn) dictTabBtn.click();
    setTimeout(() => {
      btnAutoDownload?.click();
    }, 450);
  }
});

/**
 * Tab switching
 */
function setupTabs() {
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      tabContents.forEach((c) => c.classList.remove('active'));

      btn.classList.add('active');
      const tabId = btn.dataset.tab;
      document.getElementById(tabId).classList.add('active');
    });
  });
}

/**
 * Toast Notification
 */
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2500);
}

/**
 * Load settings from storage
 */
async function loadSettings() {
  const config = await chrome.storage.local.get({
    geminiApiKey: '',
    geminiModel: 'gemini-2.5-flash',
    geminiPrompt: '',
    ankiUrl: 'http://localhost:8765',
    deckName: 'Japanese_Learning',
    modelName: 'Japanese_Model',
    fieldMap: {
      Word: 'Word',
      Reading: 'Reading',
      HanViet: 'HanViet',
      Definition: 'Definition',
      Example: 'Example',
      Audio: 'Audio'
    },
    triggerKey: 'Shift',
    enableScan: true,
    maxScanLength: 16,
    autoAiExamples: true
  });

  // Gemini
  geminiApiKeyInput.value = config.geminiApiKey;
  geminiModelSelect.value = config.geminiModel;
  geminiPromptText.value = config.geminiPrompt;
  if (autoAiExamplesCheckbox) {
    autoAiExamplesCheckbox.checked = config.autoAiExamples !== false;
  }

  // Anki
  ankiUrlInput.value = config.ankiUrl;
  ankiDeckInput.value = config.deckName;
  ankiModelInput.value = config.modelName;

  fieldWord.value = config.fieldMap?.Word || 'Word';
  fieldReading.value = config.fieldMap?.Reading || 'Reading';
  fieldHanviet.value = config.fieldMap?.HanViet || 'HanViet';
  fieldDefinition.value = config.fieldMap?.Definition || 'Definition';
  fieldExample.value = config.fieldMap?.Example || 'Example';
  fieldAudio.value = config.fieldMap?.Audio || 'Audio';

  // Auto-connect to Anki on load to display decks immediately if Anki is running
  chrome.runtime.sendMessage(
    {
      type: 'TEST_ANKI_CONNECTION',
      payload: { ankiUrl: config.ankiUrl, modelName: config.modelName }
    },
    (res) => {
      if (res && res.success) {
        populateAnkiData(res.data, config.deckName, config.modelName);
      }
    }
  );

  // General
  triggerKeySelect.value = config.triggerKey;
  enableScanCheckbox.checked = config.enableScan;
  maxScanLengthInput.value = config.maxScanLength;
}

/**
 * Refresh DB statistics
 */
async function refreshDbStats() {
  chrome.runtime.sendMessage({ type: 'GET_STATS' }, (res) => {
    if (res && res.success) {
      const { totalTerms, lastUpdated } = res.data;
      statTotalTerms.textContent = (totalTerms || 0).toLocaleString('vi-VN');
      statLastUpdated.textContent = lastUpdated
        ? new Date(lastUpdated).toLocaleString('vi-VN')
        : 'Chưa nạp từ điển';
    }
  });
}

/**
 * Toggle Gemini Key visibility
 */
btnToggleKey.addEventListener('click', () => {
  if (geminiApiKeyInput.type === 'password') {
    geminiApiKeyInput.type = 'text';
    btnToggleKey.textContent = '🔒 Ẩn';
  } else {
    geminiApiKeyInput.type = 'password';
    btnToggleKey.textContent = '👁️ Hiện';
  }
});

/**
 * Save Gemini Settings
 */
btnSaveGemini.addEventListener('click', async () => {
  await chrome.storage.local.set({
    geminiApiKey: geminiApiKeyInput.value.trim(),
    geminiModel: geminiModelSelect.value,
    geminiPrompt: geminiPromptText.value.trim(),
    autoAiExamples: autoAiExamplesCheckbox ? autoAiExamplesCheckbox.checked : true
  });
  showToast('Đã lưu cấu hình Gemini AI!');
});

/**
 * Helper to populate gemini model select with available models
 */
function updateModelSelectOptions(availableModels, selectedModel = null) {
  if (!availableModels || availableModels.length === 0) return;
  const currentVal = selectedModel || geminiModelSelect.value;
  geminiModelSelect.innerHTML = '';

  availableModels.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.name;
    opt.textContent = `${m.name} (${m.displayName || 'Khả dụng'})`;
    if (m.name === currentVal) opt.selected = true;
    geminiModelSelect.appendChild(opt);
  });

  // If previous value wasn't in list, select first
  if (!geminiModelSelect.value && availableModels.length > 0) {
    geminiModelSelect.value = availableModels[0].name;
  }
}

/**
 * Fetch Available Models Button
 */
btnFetchModels.addEventListener('click', () => {
  const apiKey = geminiApiKeyInput.value.trim();
  if (!apiKey) {
    showResult(geminiTestResult, false, 'Vui lòng nhập Gemini API Key trước khi quét model.');
    return;
  }

  btnFetchModels.disabled = true;
  btnFetchModels.textContent = '⏳ Đang quét...';

  let isHandled = false;
  const timeoutId = setTimeout(() => {
    if (!isHandled) {
      isHandled = true;
      btnFetchModels.disabled = false;
      btnFetchModels.textContent = '🔄 Quét Model';
      showResult(geminiTestResult, false, '✕ Quá thời gian quét model. Vui lòng thử lại.');
    }
  }, 12000);

  chrome.runtime.sendMessage(
    {
      type: 'LIST_GEMINI_MODELS',
      payload: { apiKey }
    },
    async (res) => {
      if (isHandled) return;
      isHandled = true;
      clearTimeout(timeoutId);

      btnFetchModels.disabled = false;
      btnFetchModels.textContent = '🔄 Quét Model';

      if (chrome.runtime.lastError) {
        showResult(geminiTestResult, false, `✕ Lỗi Service Worker: ${chrome.runtime.lastError.message}`);
        return;
      }

      if (res && res.success && res.data && res.data.length > 0) {
        updateModelSelectOptions(res.data);
        await chrome.storage.local.set({ geminiModel: geminiModelSelect.value });
        showResult(geminiTestResult, true, `✓ Đã tìm thấy ${res.data.length} model khả dụng cho API Key của bạn. Đã chọn: "${geminiModelSelect.value}".`);
      } else {
        showResult(geminiTestResult, false, `✕ Không thể lấy danh sách model: ${res?.error || 'Kiểm tra lại API Key'}`);
      }
    }
  );
});

/**
 * Test Gemini Connection
 */
btnTestGemini.addEventListener('click', () => {
  const apiKey = geminiApiKeyInput.value.trim();
  if (!apiKey) {
    showResult(geminiTestResult, false, 'Vui lòng nhập Gemini API Key trước.');
    return;
  }

  btnTestGemini.disabled = true;
  btnTestGemini.textContent = 'Đang kiểm tra...';
  geminiTestResult.style.display = 'none';

  let isHandled = false;
  const timeoutId = setTimeout(() => {
    if (!isHandled) {
      isHandled = true;
      btnTestGemini.disabled = false;
      btnTestGemini.textContent = 'Kiểm Tra Kết Nối AI';
      showResult(geminiTestResult, false, '✕ Quá thời gian phản hồi (Timeout). Vui lòng thử lại hoặc tải lại extension.');
    }
  }, 12000);

  chrome.runtime.sendMessage(
    {
      type: 'TEST_GEMINI_CONNECTION',
      payload: { apiKey, model: geminiModelSelect.value }
    },
    async (res) => {
      if (isHandled) return;
      isHandled = true;
      clearTimeout(timeoutId);

      btnTestGemini.disabled = false;
      btnTestGemini.textContent = 'Kiểm Tra Kết Nối AI';

      if (chrome.runtime.lastError) {
        showResult(geminiTestResult, false, `✕ Lỗi kết nối Service Worker: ${chrome.runtime.lastError.message}`);
        return;
      }

      if (res && res.success) {
        const { response, usedModel, availableModels } = res.data;
        if (availableModels && availableModels.length > 0) {
          updateModelSelectOptions(availableModels, usedModel);
          await chrome.storage.local.set({ geminiModel: usedModel });
        }
        showResult(geminiTestResult, true, `✓ Kết nối Gemini thành công với model "${usedModel}"! AI phản hồi: "${response}"`);
      } else {
        showResult(geminiTestResult, false, `✕ Kết nối thất bại: ${res?.error || 'Lỗi không xác định'}`);
      }
    }
  );
});

/**
 * Populate Anki Decks and Models into Select Dropdowns & Info Card
 */
function populateAnkiData(data, currentDeck = null, currentModel = null) {
  const { version, decks = [], models = [], modelFields = [] } = data;
  if (decks.length === 0 && models.length === 0) return;

  // Show Info Card
  ankiInfoCard.style.display = 'block';
  ankiSummaryPill.textContent = `${decks.length} Bộ Thẻ • ${models.length} Loại Thẻ`;

  // 1. Populate Deck Select Dropdown
  ankiDeckSelect.innerHTML = '';
  decks.forEach((deck) => {
    const opt = document.createElement('option');
    opt.value = deck;
    opt.textContent = deck;
    ankiDeckSelect.appendChild(opt);
  });

  const selectedDeck = currentDeck || ankiDeckInput.value || decks[0] || '';
  if (selectedDeck && decks.includes(selectedDeck)) {
    ankiDeckSelect.value = selectedDeck;
    ankiDeckInput.value = selectedDeck;
  } else if (decks.length > 0) {
    ankiDeckSelect.value = decks[0];
    ankiDeckInput.value = decks[0];
  }
  currentDeckNameBadge.textContent = ankiDeckSelect.value;

  // 2. Populate Model Select Dropdown
  ankiModelSelect.innerHTML = '';
  models.forEach((model) => {
    const opt = document.createElement('option');
    opt.value = model;
    opt.textContent = model;
    ankiModelSelect.appendChild(opt);
  });

  const selectedModel = currentModel || ankiModelInput.value || models[0] || '';
  if (selectedModel && models.includes(selectedModel)) {
    ankiModelSelect.value = selectedModel;
    ankiModelInput.value = selectedModel;
  } else if (models.length > 0) {
    ankiModelSelect.value = models[0];
    ankiModelInput.value = models[0];
  }

  // 3. Show model fields info if available
  if (modelFields && modelFields.length > 0) {
    updateFieldMappingInfo(selectedModel, modelFields);
  }
}

function updateFieldMappingInfo(modelName, fields) {
  if (!fields || fields.length === 0) {
    fieldMappingDesc.textContent = `Tên các trường tương ứng trong Loại Thẻ ${modelName}:`;
    return;
  }
  fieldMappingDesc.innerHTML = `Các trường phát hiện trong Loại Thẻ <strong>${escapeHtml(modelName)}</strong>: <span style="color:#2563eb; font-weight:600;">[${fields.map(escapeHtml).join(', ')}]</span>`;
}

// Deck Select change
ankiDeckSelect.addEventListener('change', () => {
  ankiDeckInput.value = ankiDeckSelect.value;
  currentDeckNameBadge.textContent = ankiDeckSelect.value;
});

// Model Select change -> fetch its fields
ankiModelSelect.addEventListener('change', () => {
  ankiModelInput.value = ankiModelSelect.value;
  chrome.runtime.sendMessage(
    {
      type: 'GET_ANKI_MODEL_FIELDS',
      payload: { ankiUrl: ankiUrlInput.value.trim() || 'http://localhost:8765', modelName: ankiModelSelect.value }
    },
    (res) => {
      if (res && res.success && res.data) {
        updateFieldMappingInfo(ankiModelSelect.value, res.data);
      }
    }
  );
});

// Toggle custom input for Deck
btnToggleCustomDeck.addEventListener('click', () => {
  if (ankiDeckInput.style.display === 'none') {
    ankiDeckInput.style.display = 'block';
    ankiDeckSelect.style.display = 'none';
    btnToggleCustomDeck.textContent = '📋 Chọn từ danh sách';
  } else {
    ankiDeckInput.style.display = 'none';
    ankiDeckSelect.style.display = 'block';
    btnToggleCustomDeck.textContent = '✏️ Nhập tên khác';
  }
});

// Toggle custom input for Model
btnToggleCustomModel.addEventListener('click', () => {
  if (ankiModelInput.style.display === 'none') {
    ankiModelInput.style.display = 'block';
    ankiModelSelect.style.display = 'none';
    btnToggleCustomModel.textContent = '📋 Chọn từ danh sách';
  } else {
    ankiModelInput.style.display = 'none';
    ankiModelSelect.style.display = 'block';
    btnToggleCustomModel.textContent = '✏️ Nhập tên khác';
  }
});

/**
 * Save Anki Settings
 */
btnSaveAnki.addEventListener('click', async () => {
  const chosenDeck = ankiDeckInput.style.display !== 'none'
    ? ankiDeckInput.value.trim()
    : ankiDeckSelect.value || ankiDeckInput.value.trim() || 'Japanese_Learning';

  const chosenModel = ankiModelInput.style.display !== 'none'
    ? ankiModelInput.value.trim()
    : ankiModelSelect.value || ankiModelInput.value.trim() || 'Japanese_Model';

  await chrome.storage.local.set({
    ankiUrl: ankiUrlInput.value.trim(),
    deckName: chosenDeck,
    modelName: chosenModel,
    fieldMap: {
      Word: fieldWord.value.trim() || 'Word',
      Reading: fieldReading.value.trim() || 'Reading',
      HanViet: fieldHanviet.value.trim() || 'HanViet',
      Definition: fieldDefinition.value.trim() || 'Definition',
      Example: fieldExample.value.trim() || 'Example',
      Audio: fieldAudio.value.trim() || 'Audio'
    }
  });

  currentDeckNameBadge.textContent = chosenDeck;
  showToast(`Đã lưu cấu hình Anki! Bộ thẻ: "${chosenDeck}"`);
});

/**
 * Test Anki Connection
 */
btnTestAnki.addEventListener('click', () => {
  const ankiUrl = ankiUrlInput.value.trim() || 'http://localhost:8765';
  btnTestAnki.disabled = true;
  btnTestAnki.textContent = 'Đang kết nối Anki...';
  ankiTestResult.style.display = 'none';

  chrome.runtime.sendMessage(
    {
      type: 'TEST_ANKI_CONNECTION',
      payload: { ankiUrl, modelName: ankiModelSelect.value || ankiModelInput.value }
    },
    (res) => {
      btnTestAnki.disabled = false;
      btnTestAnki.textContent = '🔌 Kiểm Tra Kết Nối & Tải Danh Sách Deck';

      if (res && res.success) {
        const { version, decks, models } = res.data;
        showResult(
          ankiTestResult,
          true,
          `✓ Kết nối AnkiConnect thành công (Phiên bản: ${version})! Tìm thấy ${decks.length} Decks và ${models.length} Note Types.`
        );

        populateAnkiData(res.data);
      } else {
        showResult(
          ankiTestResult,
          false,
          `✕ Không thể kết nối AnkiConnect: ${res?.error || 'Đảm bảo Anki đang mở và AnkiConnect plugin đã cài đặt.'}`
        );
      }
    }
  );
});

/**
 * Save General Settings
 */
btnSaveGeneral.addEventListener('click', async () => {
  await chrome.storage.local.set({
    triggerKey: triggerKeySelect.value,
    enableScan: enableScanCheckbox.checked,
    maxScanLength: parseInt(maxScanLengthInput.value, 10) || 16
  });
  showToast('Đã lưu cài đặt phím tắt!');
});

/**
 * Setup Japanese (Linguist) note type in Anki
 */
btnSetupLinguist.addEventListener('click', async () => {
  const ankiUrl = ankiUrlInput.value.trim() || 'http://127.0.0.1:8765';
  btnSetupLinguist.disabled = true;
  btnSetupLinguist.textContent = 'Đang thiết lập...';
  showResult(linguistSetupResult, true, 'Đang gửi mẫu template Linguist sang AnkiConnect...');

  chrome.runtime.sendMessage(
    {
      type: 'SETUP_LINGUIST_ANKI_MODEL',
      payload: { ankiUrl }
    },
    async (res) => {
      btnSetupLinguist.disabled = false;
      btnSetupLinguist.textContent = '🎨 Cài Đặt Note Type Vào Anki';

      if (res && res.success) {
        showResult(
          linguistSetupResult,
          true,
          `✓ ${res.message || 'Đã cài đặt thành công Note Type "Japanese (Linguist)"!'}`
        );

        // Auto update input and field mappings
        ankiModelInput.value = 'Japanese (Linguist)';
        fieldWord.value = 'Expression';
        fieldReading.value = 'Expression';
        fieldDefinition.value = 'Meaning';
        fieldHanviet.value = 'Kanji';
        fieldExample.value = 'Example';
        fieldAudio.value = 'Audio';

        // Auto save to chrome.storage
        await chrome.storage.local.set({
          ankiModel: 'Japanese (Linguist)',
          ankiFieldWord: 'Expression',
          ankiFieldReading: 'Expression',
          ankiFieldDefinition: 'Meaning',
          ankiFieldHanviet: 'Kanji',
          ankiFieldExample: 'Example',
          ankiFieldAudio: 'Audio'
        });

        // Trigger connection test to refresh dropdown models and fields
        btnTestAnki.click();
        showToast('Đã thiết lập xong Japanese (Linguist)!');
      } else {
        showResult(
          linguistSetupResult,
          false,
          `✕ Lỗi thiết lập: ${res?.error || 'Không kết nối được Anki. Hãy chắc chắn Anki đang chạy và bật AnkiConnect!'}`
        );
      }
    }
  );
});

/**
 * Clear Database
 */
btnClearDb.addEventListener('click', async () => {
  if (!confirm('Bạn có chắc chắn muốn XÓA TOÀN BỘ dữ liệu từ điển trong IndexedDB không?')) return;

  chrome.runtime.sendMessage({ type: 'CLEAR_DATABASE' }, async (res) => {
    if (res && res.success) {
      await refreshDbStats();
      showToast('Đã xóa sạch từ điển!');
      progressContainer.style.display = 'none';
    } else {
      alert(`Lỗi khi xóa DB: ${res?.error}`);
    }
  });
});

/**
 * -------------------------------------------------------------
 * AUTO-DOWNLOAD JITENDEX FROM GITHUB (1-CLICK)
 * -------------------------------------------------------------
 */
const DEFAULT_JITENDEX_URL = 'https://github.com/stephenmk/stephenmk.github.io/releases/latest/download/jitendex-yomitan.zip';

if (btnResetDownloadUrl && autoDownloadUrlInput) {
  btnResetDownloadUrl.addEventListener('click', () => {
    autoDownloadUrlInput.value = DEFAULT_JITENDEX_URL;
  });
}

if (btnAutoDownload) {
  btnAutoDownload.addEventListener('click', async () => {
    const downloadUrl = (autoDownloadUrlInput?.value || DEFAULT_JITENDEX_URL).trim();
    if (!downloadUrl) {
      alert('Vui lòng nhập URL file zip từ điển.');
      return;
    }

    const confirmed = confirm(
      `Bắt đầu tải và nạp tự động từ điển Jitendex?\n\n` +
      `Nguồn tải: ${downloadUrl}\n\n` +
      `Quá trình tải (~60MB) và nạp dữ liệu sẽ chạy trực tiếp trong trình duyệt (thường mất 1 - 3 phút tùy tốc độ mạng).`
    );
    if (!confirmed) return;

    btnAutoDownload.disabled = true;
    btnAutoDownload.textContent = '⏳ Đang kết nối...';
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    statusText.textContent = 'Đang kết nối tới máy chủ GitHub...';

    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Máy chủ phản hồi HTTP ${response.status} (${response.statusText}).`);
      }

      const contentLength = +(response.headers.get('Content-Length') || 0);
      const reader = response.body.getReader();
      let receivedLength = 0;
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedLength += value.length;

        if (contentLength > 0) {
          const pct = Math.min(100, Math.round((receivedLength / contentLength) * 100));
          const mbRec = (receivedLength / (1024 * 1024)).toFixed(1);
          const mbTot = (contentLength / (1024 * 1024)).toFixed(1);
          progressBar.style.width = `${Math.round(pct * 0.4)}%`; // 0% - 40% cho tải về
          statusText.textContent = `📥 Đang tải Jitendex: ${pct}% (${mbRec}/${mbTot} MB)...`;
        } else {
          const mbRec = (receivedLength / (1024 * 1024)).toFixed(1);
          statusText.textContent = `📥 Đang tải Jitendex: ${mbRec} MB đã nhận...`;
        }
      }

      statusText.textContent = '📦 Đang tổng hợp dữ liệu file zip...';
      progressBar.style.width = '42%';
      const blob = new Blob(chunks, { type: 'application/zip' });

      statusText.textContent = '🔍 Đang giải nén file zip Jitendex...';
      progressBar.style.width = '46%';
      const extractedFiles = await ZipReader.readZip(blob);

      statusText.textContent = `✓ Đã giải nén ${extractedFiles.length} tệp. Đang nạp vào IndexedDB...`;
      await importExtractedFiles(extractedFiles);

      await refreshDbStats();
      showToast('Tải và cài đặt tự động Jitendex thành công!');
    } catch (err) {
      console.error('Auto download error:', err);
      statusText.textContent = `✕ Lỗi tải tự động: ${err.message}`;
      alert(
        `Không thể tải tự động từ điển: ${err.message}\n\n` +
        `Gợi ý:\n` +
        `1. Bạn có thể mở terminal và chạy lệnh: "python3 scripts/download_jitendex.py"\n` +
        `2. Hoặc tải file zip thủ công từ github.com/Jitendex/Jitendex/releases và kéo thả vào ô bên dưới.`
      );
    } finally {
      btnAutoDownload.disabled = false;
      btnAutoDownload.textContent = '🌐 Bắt Đầu Tải & Cài Đặt';
    }
  });
}

/**
 * -------------------------------------------------------------
 * CHECK & LOAD LOCAL PROJECT DICTIONARY (dictionaries/jitendex)
 * -------------------------------------------------------------
 */
async function checkAndShowLocalDict() {
  if (!localDictBox) return;
  try {
    const checkUrl = chrome.runtime.getURL('dictionaries/jitendex/index.json');
    const res = await fetch(checkUrl, { method: 'HEAD' });
    if (res.ok) {
      localDictBox.style.display = 'block';
    }
  } catch (_) {
    // Thư mục chưa có dữ liệu tải sẵn
  }
}

if (btnLoadLocalDict) {
  btnLoadLocalDict.addEventListener('click', async () => {
    btnLoadLocalDict.disabled = true;
    btnLoadLocalDict.textContent = '⏳ Đang quét tệp...';
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    statusText.textContent = 'Đang đọc dữ liệu từ thư mục dictionaries/jitendex/...';

    try {
      // 1. Đọc index.json
      let dictTitle = 'Jitendex';
      try {
        const idxRes = await fetch(chrome.runtime.getURL('dictionaries/jitendex/index.json'));
        if (idxRes.ok) {
          const idxJson = await idxRes.json();
          if (idxJson?.title) dictTitle = idxJson.title;
        }
      } catch (_) {}

      // 2. Tự động duyệt term_bank_*.json
      const termFiles = [];
      let i = 1;
      while (true) {
        try {
          const termRes = await fetch(chrome.runtime.getURL(`dictionaries/jitendex/term_bank_${i}.json`));
          if (!termRes.ok) break;
          const data = await termRes.json();
          termFiles.push({ name: `term_bank_${i}.json`, data });
          i++;
        } catch (_) {
          break;
        }
      }

      // 3. Tự động duyệt kanji_bank_*.json
      const kanjiFiles = [];
      let k = 1;
      while (true) {
        try {
          const kanjiRes = await fetch(chrome.runtime.getURL(`dictionaries/jitendex/kanji_bank_${k}.json`));
          if (!kanjiRes.ok) break;
          const data = await kanjiRes.json();
          kanjiFiles.push({ name: `kanji_bank_${k}.json`, data });
          k++;
        } catch (_) {
          break;
        }
      }

      if (termFiles.length === 0) {
        throw new Error('Không tìm thấy file term_bank_*.json trong dictionaries/jitendex/. Hãy chắc chắn rằng bạn đã giải nén dữ liệu.');
      }

      const totalFiles = termFiles.length + kanjiFiles.length;
      let completedFiles = 0;

      for (let idx = 0; idx < termFiles.length; idx++) {
        const item = termFiles[idx];
        statusText.textContent = `Đang nạp ${item.name} (${idx + 1}/${termFiles.length})...`;
        await dictDB.insertTermsBatch(item.data, dictTitle, (processed, total) => {
          const filePct = (processed / total) * 100;
          const overallPct = ((completedFiles + filePct / 100) / totalFiles) * 100;
          progressBar.style.width = `${Math.min(100, Math.round(overallPct))}%`;
          statusText.textContent = `${item.name}: ${processed.toLocaleString()} / ${total.toLocaleString()} từ...`;
        });
        completedFiles++;
      }

      for (let idx = 0; idx < kanjiFiles.length; idx++) {
        const item = kanjiFiles[idx];
        statusText.textContent = `Đang nạp ${item.name}...`;
        await dictDB.insertKanjiBatch(item.data, dictTitle);
        completedFiles++;
        progressBar.style.width = `${Math.min(100, Math.round((completedFiles / totalFiles) * 100))}%`;
      }

      statusText.textContent = `✓ Đã nạp thành công toàn bộ dữ liệu từ ${dictTitle}!`;
      await refreshDbStats();
      showToast('Nạp dữ liệu từ thư mục dự án thành công!');
    } catch (err) {
      console.error('Local load error:', err);
      statusText.textContent = `✕ Lỗi nạp từ thư mục: ${err.message}`;
    } finally {
      btnLoadLocalDict.disabled = false;
      btnLoadLocalDict.textContent = '⚡ Nạp Ngay Vào Tiện Ích';
    }
  });
}

/**
 * Setup Dropzone & File Importer
 */
function setupDropzone() {
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await processFiles(files);
    }
  });

  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      await processFiles(files);
    }
  });
}

/**
 * Process uploaded files (ZIP or JSONs)
 */
async function processFiles(files) {
  progressContainer.style.display = 'block';
  progressBar.style.width = '0%';
  statusText.textContent = 'Đang đọc file...';

  try {
    const zipFile = files.find((f) => f.name.endsWith('.zip'));

    if (zipFile) {
      statusText.textContent = `Đang giải nén ${zipFile.name}...`;
      const extractedFiles = await ZipReader.readZip(zipFile);
      await importExtractedFiles(extractedFiles);
    } else {
      // Process individual JSON files
      const jsonFiles = files.filter((f) => f.name.endsWith('.json'));
      if (jsonFiles.length === 0) {
        throw new Error('Vui lòng chọn file .zip hoặc file .json của Jitendex.');
      }

      const fileObjects = jsonFiles.map((file) => ({
        name: file.name,
        readAsJson: async () => {
          const text = await file.text();
          return JSON.parse(text);
        }
      }));

      await importExtractedFiles(fileObjects);
    }

    await refreshDbStats();
    showToast('Nạp dữ liệu Jitendex thành công!');
  } catch (err) {
    console.error('Import error:', err);
    statusText.textContent = `✕ Lỗi nạp dữ liệu: ${err.message}`;
  }
}

/**
 * Import files into IndexedDB
 */
async function importExtractedFiles(fileObjects) {
  // 1. Check index.json if present
  let dictTitle = 'Jitendex';
  const indexFile = fileObjects.find((f) => f.name.endsWith('index.json') || f.name === 'index.json');
  if (indexFile) {
    try {
      const meta = await indexFile.readAsJson();
      if (meta && meta.title) dictTitle = meta.title;
    } catch (_) {}
  }

  // 2. Filter term bank files
  const termFiles = fileObjects.filter((f) => f.name.includes('term_bank'));
  const kanjiFiles = fileObjects.filter((f) => f.name.includes('kanji_bank'));

  if (termFiles.length === 0 && kanjiFiles.length === 0) {
    // If user dropped generic json array of terms
    const jsonFiles = fileObjects.filter((f) => f.name.endsWith('.json') && !f.name.includes('index.json'));
    if (jsonFiles.length > 0) {
      termFiles.push(...jsonFiles);
    }
  }

  const totalFiles = termFiles.length + kanjiFiles.length;
  if (totalFiles === 0) {
    throw new Error('Không tìm thấy dữ liệu term_bank hoặc kanji_bank trong file.');
  }

  let completedFiles = 0;

  // Import terms
  for (let i = 0; i < termFiles.length; i++) {
    const file = termFiles[i];
    statusText.textContent = `Đang nạp file ${file.name} (${i + 1}/${termFiles.length})...`;

    const data = await file.readAsJson();
    if (Array.isArray(data)) {
      await dictDB.insertTermsBatch(data, dictTitle, (processed, total) => {
        const filePct = (processed / total) * 100;
        const overallPct = ((completedFiles + filePct / 100) / totalFiles) * 100;
        progressBar.style.width = `${Math.min(100, Math.round(overallPct))}%`;
        statusText.textContent = `File ${file.name}: ${processed.toLocaleString()}/${total.toLocaleString()} từ...`;
      });
    }
    completedFiles++;
  }

  // Import kanji
  for (let i = 0; i < kanjiFiles.length; i++) {
    const file = kanjiFiles[i];
    statusText.textContent = `Đang nạp Kanji bank: ${file.name}...`;
    const data = await file.readAsJson();
    if (Array.isArray(data)) {
      await dictDB.insertKanjiBatch(data, dictTitle);
    }
    completedFiles++;
    progressBar.style.width = `${Math.min(100, Math.round((completedFiles / totalFiles) * 100))}%`;
  }

  statusText.textContent = `✓ Đã nạp thành công toàn bộ dữ liệu từ ${dictTitle}!`;
}

/**
 * Show Alert Box Helper
 */
function showResult(el, isSuccess, text) {
  el.style.display = 'block';
  el.className = `alert-box ${isSuccess ? 'success' : 'error'}`;
  el.textContent = text;
}
