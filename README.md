# J-LEXICON AI - Japanese Dictionary & Anki Bridge Extension

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![AnkiConnect](https://img.shields.io/badge/Anki-Connect%20Integration-blue.svg)](https://foosoft.net/projects/anki-connect/)
[![Gemini AI](https://img.shields.io/badge/Google-Gemini%20AI-orange.svg)](https://ai.google.dev/)
[![Jitendex](https://img.shields.io/badge/Dictionary-Jitendex-purple.svg)](https://jitendex.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Tiện ích mở rộng trình duyệt (Manifest V3) học tiếng Nhật toàn diện:** Tra cứu từ điển chuẩn **Jitendex** ngoại tuyến trên **IndexedDB**, hiển thị âm **Hán-Việt**, phát âm giọng bản xứ **Audio**, xem thứ tự nét viết **KanjiVG (tự viết lại)**, phân tích ngữ cảnh với **Gemini AI** và đồng bộ thẻ học 1-chạm vào **Anki** theo mẫu **Linguist Japanese Vocab** chống trùng lặp.

---

## 📑 Mục Lục
1. [Tính Năng Nổi Bật](#-tính-năng-nổi-bật)
2. [Yêu Cầu Hệ Thống](#-yêu-cầu-hệ-thống)
3. [Hướng Dẫn Cài Đặt Tiện Ích](#-hướng-dẫn-cài-đặt-tiện-ích)
4. [Hướng Dẫn Cấu Hình](#-hướng-dẫn-cấu-hình)
   - [1. Nạp Dữ Liệu Từ Điển Jitendex](#1-nạp-dữ-liệu-từ-điển-jitendex)
   - [2. Cấu Hình Anki & AnkiConnect](#2-cấu-hình-anki--ankiconnect)
   - [3. Cấu Hình Gemini AI (Tùy chọn)](#3-cấu-hình-gemini-ai-tùy-chọn)
5. [Hướng Dẫn Sử Dụng](#-hướng-dẫn-sử-dụng)
6. [Cấu Trúc Thư Mục](#-cấu-trúc-thư-mục)
7. [Xử Lý Sự Cố Thường Gặp (Troubleshooting)](#-xử-lý-sự-cố-thường-gặp)
8. [Giấy Phép & Nguồn Tham Khảo](#-giấy-phép--nguồn-tham-khảo)

---

## 🌟 Tính Năng Nổi Bật

- ⚡ **Tra cứu siêu tốc & không xung đột giao diện:**
  - Nhấn giữ `Shift` và rê chuột qua từ vựng (Hover Scan) hoặc bôi đen văn bản để tra cứu ngay lập tức.
  - Giao diện tra từ hiển thị trong **Shadow DOM**, đảm bảo cô lập 100% CSS, không làm vỡ giao diện của bất kỳ trang web nào (NHK, YouTube, Twitter/X, đọc báo, truyện tranh).
  - Tích hợp bộ giải thuật chia động từ/tính từ (**Deinflector**) tự động khôi phục dạng nguyên thể (ví dụ: `食べた` ➔ `食べる`, `行かない` ➔ `行く`, `美しかった` ➔ `美しい`).

- 📚 **Từ điển lõi Jitendex ngoại tuyến (IndexedDB):**
  - Lưu trữ trực tiếp trong cơ sở dữ liệu IndexedDB của trình duyệt. Tra cứu tốc độ mili-giây hoàn toàn ngoại tuyến (offline) mà không tốn RAM.
  - Hỗ trợ tải tự động 1-click từ GitHub hoặc kéo thả file zip trực tiếp (giải nén in-memory bằng `DecompressionStream`).

- 🀄 **Âm Hán - Việt tích hợp sẵn (>1.600+ chữ Hán):**
  - Tự động bóc tách từng chữ Kanji và hiển thị âm Hán-Việt chuẩn xác dạng huy hiệu (ví dụ: `状況` ➔ `[TRẠNG HUỐNG]`, `日本語` ➔ `[NHẬT BẢN NGỮ]`).

- ✍️ **Sơ đồ nét vẽ Kanji động (KanjiVG Stroke Order Animation):**
  - Mỗi chữ Kanji trong từ vựng đều có sơ đồ nét vẽ chuẩn KanjiVG với màu sắc phân biệt từng nét, lưới tọa độ căn chỉnh.
  - Hiệu ứng nét vẽ tự động viết theo thứ tự (stroke-by-stroke animation) và nút **🔄 Tự viết lại** để người học dễ dàng quan sát và luyện viết theo.

- 🗂️ **Template thẻ Anki Linguist Japanese Vocab chuẩn mực:**
  - Tự động tạo Note Type `Japanese (Linguist)` trong Anki với 1-Click.
  - Mặt trước: Từ vựng, nút phát âm, sơ đồ nét vẽ Kanji tự viết lại.
  - Mặt sau: Phiên âm Furigana, âm Hán-Việt, từ loại tiếng Anh (Noun, Suru verb...), định nghĩa tiếng Anh nguyên bản từ Jitendex, câu ví dụ có Furigana kèm bản dịch tiếng Việt sát nghĩa bên dưới.

- 🛡️ **Cơ chế chống trùng lặp từ vựng trong Anki (Duplicate Prevention):**
  - Tự động kiểm tra xem từ vựng đã tồn tại trong Deck được chọn chưa.
  - Nếu từ vựng đã có trong Anki, nút chuyển sang trạng thái **"Đã có trong Anki"** và khóa lại, ngăn ngừa việc thêm thẻ trùng lặp gây rác bộ thẻ.

- 🤖 **Trí tuệ nhân tạo Gemini AI (Sinh ví dụ ngữ cảnh & Tối ưu hóa tạo thẻ):**
  - **Tự động tạo câu ví dụ khi từ điển thiếu:** Đối với các từ vựng trong Jitendex không có sẵn câu ví dụ, tiện ích hiển thị nút **✨ Tạo ví dụ bằng AI** (hoặc tự động sinh nếu bật tùy chọn). Gemini AI sẽ tạo 01 câu ví dụ tiếng Nhật tự nhiên chuẩn ngữ cảnh kèm Furigana (`<ruby>`) và bản dịch tiếng Việt sát nghĩa.
  - **Nút 🔄 Đổi câu khác:** Cho phép người dùng đổi ngay sang một câu ví dụ khác với ngữ cảnh phong phú, sinh động hơn.
  - **Bộ nhớ đệm (Cache thông minh):** Tự động lưu các câu ví dụ AI đã tạo vào bộ nhớ đệm, giúp tra lại tức thì mà không tiêu tốn lượt gọi API.
  - **Đồng bộ hoàn hảo vào Anki:** Khi lưu thẻ vào Anki, câu ví dụ AI vừa tạo (hoặc tự sinh mới) sẽ được đóng gói chuẩn vào phần Meaning của thẻ Linguist.

- 🔊 **Phát âm từ vựng chuẩn giọng bản xứ:**
  - Tích hợp nghe phát âm tức thì qua giọng đọc tiếng Nhật chuẩn (Youdao CDN + Web Speech API fallback).
  - Tự động tải file âm thanh mp3 về Anki Media (`[sound:...]`) khi thêm thẻ.

- 🚀 **Zero Build Step:**
  - Viết 100% bằng Vanilla JavaScript chuẩn ES Modules. Không yêu cầu build step phức tạp (Webpack, Vite, v.v.), nạp trực tiếp vào trình duyệt sử dụng ngay!

---

## 💻 Yêu Cầu Hệ Thống

| Thành Phần | Yêu Cầu Tối Thiểu | Ghi Chú |
| :--- | :--- | :--- |
| **Trình duyệt** | Chrome 105+, Edge 105+, Brave, Cốc Cốc, Safari 15.4+ | Hỗ trợ Manifest V3 và Web Streams (`DecompressionStream`) |
| **Ứng dụng Anki** | Anki Desktop 2.1.49+ (Khuyên dùng 2.1.54+) | Tải miễn phí tại [apps.ankiweb.net](https://apps.ankiweb.net/) |
| **Add-on Anki** | **AnkiConnect** (Code: `2055492159`) | Cầu nối giao tiếp giữa Extension và Anki |
| **Google Gemini Key** | API Key miễn phí từ [Google AI Studio](https://aistudio.google.com/) | Dùng cho tính năng dịch ví dụ & Furigana khi thêm thẻ |
| **Node.js / Python** | Không bắt buộc | Chỉ cần nếu muốn chạy các script tiện ích trong thư mục `scripts/` |

---

## 🚀 Hướng Dẫn Cài Đặt Tiện Ích

### Cài đặt trên Google Chrome / Brave / Microsoft Edge / Cốc Cốc
1. Tải mã nguồn của repository này về máy tính (hoặc dùng `git clone`).
2. Mở trình duyệt và truy cập vào trang quản lý tiện ích:
   - Chrome / Brave / Cốc Cốc: `chrome://extensions/`
   - Microsoft Edge: `edge://extensions/`
3. Bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
4. Nhấn vào nút **Load unpacked** (Tải tiện ích đã giải nén).
5. Chọn thư mục dự án `anki-migrate-extension`.
6. Biểu tượng **J-Lexicon AI** sẽ xuất hiện trên thanh công cụ của trình duyệt. Bạn nên ghim (pin) tiện ích để tiện sử dụng.

---

## ⚙️ Hướng Dẫn Cấu Hình

Nhấp chuột phải vào biểu tượng tiện ích trên thanh công cụ và chọn **Options** (hoặc mở popup và nhấn icon bánh răng ⚙️).

### 1. Nạp Dữ Liệu Từ Điển Jitendex
> Dữ liệu được nạp vào IndexedDB của trình duyệt. Bạn chỉ cần thực hiện bước này **1 lần duy nhất**.

- **Cách 1 - Tự động 1-Click (Khuyên dùng):**
  - Tại tab **Quản Lý Từ Điển**, bấm nút **"⬇️ TẢI & CÀI ĐẶT JITENDEX (1-CLICK)"**.
  - Tiện ích sẽ tự động tải file zip từ GitHub (`jitendex-yomitan.zip`), giải nén trong bộ nhớ và nạp vào IndexedDB.
- **Cách 2 - Kéo thả file thủ công:**
  - Tải file nén `.zip` từ trang [Jitendex Releases](https://github.com/stephenmk/stephenmk.github.io/releases).
  - Kéo và thả file `.zip` vào vùng **File Dropzone** trên trang cài đặt.
- **Cách 3 - Dùng script Python:**
  - Mở Terminal trong thư mục dự án và chạy:
    ```bash
    python3 scripts/download_jitendex.py
    ```
  - Sau đó mở trang Options, tiện ích sẽ phát hiện thư mục dữ liệu và hiển thị nút nạp.

---

### 2. Cấu Hình Anki & AnkiConnect

#### A. Cài đặt AnkiConnect trên máy tính:
1. Mở phần mềm Anki Desktop trên máy tính.
2. Trên thanh menu, chọn `Tools (Công cụ) > Add-ons (Tiện ích mở rộng) > Get Add-ons... (Tải tiện ích...)`.
3. Nhập mã: `2055492159` và nhấn **OK**.
4. Khởi động lại phần mềm Anki.

#### B. Cấu hình CORS cho AnkiConnect:
1. Trong Anki, vào `Tools > Add-ons`, chọn **AnkiConnect**, nhấn nút **Config**.
2. Đảm bảo cấu hình có dòng `"webCorsOriginList": ["*"]`:
   ```json
   {
     "apiKey": null,
     "apiLogPath": null,
     "webBindAddress": "127.0.0.1",
     "webBindPort": 8765,
     "webCorsOriginList": [
       "*"
     ]
   }
   ```
3. Nhấn **OK** và khởi động lại Anki.

#### C. Thiết lập Note Type & Kết nối trong Extension:
1. Trong trang Cài đặt của Extension, chọn tab **🗂️ Kết Nối Anki**.
2. Nhấn nút **"🔌 Kiểm Tra Kết Nối & Tải Danh Sách Deck"**.
3. Tại phần **Template Thẻ Japanese Vocab**, nhấn nút **"🎨 Cài Đặt Note Type Vào Anki"**. Tiện ích sẽ tự động khởi tạo Note Type `Japanese (Linguist)` chuẩn 5 trường kèm CSS giao diện tuyệt đẹp vào Anki.
4. Chọn **Tên Bộ Thẻ (Deck Name)** bạn muốn lưu thẻ vào.
5. Nhấn **Lưu Cấu Hình Anki**.

---

### 3. Cấu Hình Gemini AI (Tùy chọn)
1. Truy cập [Google AI Studio](https://aistudio.google.com/app/apikey) và đăng nhập tài khoản Google.
2. Nhấn **Create API key** để nhận khóa API miễn phí.
3. Trong tab **✨ Gemini AI** của Extension:
   - Dán API Key vào ô **Gemini API Key**.
   - Nhấn **Quét Model** để lấy danh sách model mà API key hiện tại thực sự được cấp quyền, rồi chọn model bạn muốn ưu tiên.
   - Nhấn **Lưu Cấu Hình Gemini** và bấm **Kiểm Tra Kết Nối AI** để xác nhận.

---

## 📖 Hướng Dẫn Sử Dụng

### 1. Tra cứu trực tiếp trên trang web:
- Mở bất kỳ website có chứa tiếng Nhật (ví dụ: NHK News, truyện tranh, báo chí, diễn đàn).
- **Rê chuột (Hover):** Nhấn giữ phím `Shift` và rê chuột vào từ vựng tiếng Nhật.
- **Bôi đen (Selection):** Quét chọn từ hoặc cụm từ tiếng Nhật bằng chuột.
- Cửa sổ tra từ Shadow DOM sẽ hiển thị tức thì:
  - Từ vựng, Furigana, âm Hán-Việt.
  - Nút loa 🔊 nghe phát âm chuẩn.
  - Từ loại, định nghĩa tiếng Anh nguyên bản từ Jitendex.
  - Trạng thái kiểm tra Anki: Nếu từ đã có trong Anki, nút hiển thị `Đã có trong Anki`; nếu chưa có, nút hiển thị `Thêm vào Anki`.

### 2. Thêm từ vựng vào Anki:
- Nhấn nút **"Thêm vào Anki"**.
- Tiện ích sẽ:
  1. Tự động tải file phát âm mp3 của từ và nhúng vào Anki Media.
  2. Tự động tạo sơ đồ nét vẽ chữ Hán KanjiVG động với hiệu ứng tự viết lại nét cho từng chữ Kanji.
  3. Gọi Gemini AI để bổ sung Furigana `<ruby>` và dịch câu ví dụ sang tiếng Việt sát nghĩa nhất.
  4. Lưu thẻ vào đúng Deck đã chọn theo chuẩn giao diện Linguist.

### 3. Tra cứu nhanh qua Toolbar Popup:
- Nhấp vào biểu tượng Extension trên thanh công cụ.
- Nhập từ tiếng Nhật vào ô tìm kiếm và nhấn Enter để tra nhanh nghĩa và âm Hán-Việt mà không cần mở trang web.

---

## 📁 Cấu Trúc Thư Mục

```text
anki-migrate-extension/
├── manifest.json              # Khai báo cấu hình Extension (Manifest V3)
├── README.md                  # Tài liệu hướng dẫn sử dụng chi tiết
├── .gitignore                 # Danh sách loại trừ cho Git
├── package.json               # Cấu hình dự án & scripts tiện ích
├── assets/
│   └── icons/                 # Bộ biểu tượng tiện ích (16px, 32px, 48px, 128px)
├── background/
│   └── service-worker.js      # Background Service Worker: Quản lý IndexedDB, KanjiVG, Gemini AI, AnkiConnect
├── content/
│   ├── content-script.js      # Logic quét từ, Shadow DOM popup, audio, kiểm tra trùng Anki
│   └── content-style.css      # Định vị host container cho Content Script
├── popup/
│   ├── popup.html             # Giao diện Action Popup trên thanh công cụ
│   ├── popup.js               # Logic tra từ nhanh & hiển thị trạng thái kết nối
│   └── popup.css              # Giao diện Popup
├── options/
│   ├── options.html           # Trang Cài đặt: Nạp từ điển, AnkiConnect, Gemini AI, phím tắt
│   ├── options.js             # Logic cài đặt, nạp Jitendex in-memory, setup Note Type Anki
│   └── options.css            # Giao diện trang Cài đặt hiện đại
├── lib/
│   ├── db.js                  # Module IndexedDB quản lý hàng trăm nghìn từ vựng Jitendex
│   ├── deinflector.js         # Giải thuật khôi phục dạng nguyên thể động từ/tính từ
│   ├── hanviet-lookup.js      # Logic bóc tách Kanji và tra âm Hán-Việt
│   └── zip-reader.js          # Trình giải nén file ZIP bằng DecompressionStream (Zero dependency)
├── data/
│   └── hanviet.json           # Dữ liệu âm Hán-Việt (>1.600+ Kanji thông dụng)
├── dictionaries/
│   └── .gitkeep               # Thư mục chứa từ điển người dùng tải về
└── scripts/
    ├── download_jitendex.py   # Script CLI tải và giải nén Jitendex tự động
    └── build_hanviet.py       # Script CLI tái tạo dữ liệu Hán-Việt
```

---

## 🛠️ Xử Lý Sự Cố Thường Gặp

### 1. Báo lỗi `Không thể kết nối với Anki (AnkiConnect)`:
- Kiểm tra xem phần mềm Anki trên máy tính đã được mở chưa.
- Đảm bảo đã cài đặt add-on AnkiConnect (mã: `2055492159`).
- Kiểm tra cấu hình CORS trong `Tools > Add-ons > AnkiConnect > Config` đã có `"webCorsOriginList": ["*"]` chưa, sau đó khởi động lại Anki.

### 2. Không hiển thị popup khi rê chuột:
- Đảm bảo bạn đang giữ phím `Shift` (hoặc phím bạn đã chọn trong tab **Phím Tắt & Chung**) khi rê chuột.
- Đảm bảo bạn đã nạp từ điển Jitendex thành công (kiểm tra số lượng từ > 0 trong trang Cài đặt).
- Một số trang web hệ thống của trình duyệt như `chrome://extensions` hay Chrome Web Store bị trình duyệt chặn chạy Content Script vì lý do bảo mật. Hãy thử trên các trang web thông thường như `nhk.or.jp` hay `wikipedia.org`.

### 3. Lỗi Gemini API:
- Kiểm tra API Key tại [Google AI Studio](https://aistudio.google.com/) đảm bảo còn hiệu lực.
- Bấm nút "Kiểm Tra Kết Nối AI" trong trang Cài đặt để xem thông báo phản hồi chi tiết.

---

## 📜 Giấy Phép & Nguồn Tham Khảo

Dự án được phát hành theo giấy phép mã nguồn mở **MIT License**.

- **Từ điển tiếng Nhật**: Dữ liệu từ [Jitendex](https://github.com/stephenmk/stephenmk.github.io) (dựa trên JMdict / EDICT của EDRDG).
- **Sơ đồ nét vẽ chữ Hán**: Dữ liệu SVG từ dự án [KanjiVG](https://kanjivg.tagaini.net/) (Creative Commons Attribution-Share Alike 3.0).
- **Cầu nối Anki**: Tiện ích [AnkiConnect](https://foosoft.net/projects/anki-connect/) của FooSoft Productions.
- **Mẫu thẻ Anki**: Dựa trên ý tưởng thiết kế giao diện từ [linguist-anki-bridge](https://github.com/silam741852963/linguist-anki-bridge).
- **Trí tuệ nhân tạo**: Mô hình Google Gemini từ [Google AI Studio](https://ai.google.dev/).
