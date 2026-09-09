#!/usr/bin/env python3
"""
scripts/download_jitendex.py
Tự động tải và giải nén bộ từ điển Jitendex mới nhất từ GitHub vào thư mục dự án.

Sử dụng:
    python3 scripts/download_jitendex.py
    hoặc:
    npm run setup:dict
"""

import os
import sys
import zipfile
import urllib.request
import json
import ssl

DEFAULT_URL = "https://github.com/stephenmk/stephenmk.github.io/releases/latest/download/jitendex-yomitan.zip"

# Xác định thư mục gốc dự án (thư mục cha của scripts/)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DEST_DIR = os.path.join(PROJECT_ROOT, "dictionaries")
DEST_ZIP = os.path.join(DEST_DIR, "jitendex-yomitan.zip")
EXTRACT_DIR = os.path.join(DEST_DIR, "jitendex")

def report_progress(block_num, block_size, total_size):
    downloaded = block_num * block_size
    if total_size > 0:
        percent = min(100, downloaded * 100 // total_size)
        mb_down = downloaded / (1024 * 1024)
        mb_total = total_size / (1024 * 1024)
        bar_len = 30
        filled = int(bar_len * percent // 100)
        bar = '█' * filled + '░' * (bar_len - filled)
        sys.stdout.write(f"\r📥 Đang tải Jitendex: [{bar}] {percent}% ({mb_down:.1f}/{mb_total:.1f} MB)")
        sys.stdout.flush()
    else:
        sys.stdout.write(f"\r📥 Đã tải: {downloaded / (1024 * 1024):.1f} MB...")
        sys.stdout.flush()

def main():
    target_url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL

    os.makedirs(DEST_DIR, exist_ok=True)

    print("=========================================================")
    print("🚀 BẮT ĐẦU TẢI TỰ ĐỘNG TỪ ĐIỂN JITENDEX")
    print(f"🔗 Nguồn: {target_url}")
    print(f"📁 Thư mục lưu: {DEST_ZIP}")
    print(f"📂 Thư mục giải nén: {EXTRACT_DIR}")
    print("=========================================================")

    # Bỏ qua lỗi SSL local issuer trên macOS python CLI
    ssl_context = ssl._create_unverified_context() if hasattr(ssl, '_create_unverified_context') else None
    https_handler = urllib.request.HTTPSHandler(context=ssl_context) if ssl_context else urllib.request.HTTPSHandler()

    # Thiết lập User-Agent giả lập trình duyệt để tránh lỗi 403 từ GitHub
    opener = urllib.request.build_opener(https_handler)
    opener.addheaders = [
        ('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    ]
    urllib.request.install_opener(opener)

    try:
        urllib.request.urlretrieve(target_url, DEST_ZIP, reporthook=report_progress)
        print("\n\n✓ Tải file zip thành công!")
    except Exception as e:
        print(f"\n✕ Lỗi khi tải file: {e}")
        print("\nGợi ý:")
        print("1. Kiểm tra kết nối mạng Internet của bạn.")
        print("2. Hoặc bạn có thể tải thủ công file zip tại: https://github.com/Jitendex/Jitendex/releases/latest")
        print(f"   và đặt file vào: {DEST_ZIP}")
        return

    print(f"📦 Đang giải nén vào thư mục: {EXTRACT_DIR}...")
    os.makedirs(EXTRACT_DIR, exist_ok=True)
    try:
        with zipfile.ZipFile(DEST_ZIP, 'r') as zip_ref:
            zip_ref.extractall(EXTRACT_DIR)
        
        extracted_files = os.listdir(EXTRACT_DIR)
        term_files = [f for f in extracted_files if "term_bank" in f]
        print(f"✓ Đã giải nén thành công {len(extracted_files)} files (gồm {len(term_files)} file term_bank)!")
        print("\n🎉 HOÀN TẤT CÀI ĐẶT DỮ LIỆU!")
        print("👉 Bây giờ bạn có thể:")
        print("   1. Mở trang Cài đặt (Options) của tiện ích: Tiện ích sẽ tự động phát hiện thư mục này và có nút 'Nạp Ngay Vào Tiện Ích'.")
        print("   2. Hoặc kéo file dictionaries/jitendex-yomichan.zip thả vào trang Cài đặt!")
    except Exception as e:
        print(f"✕ Lỗi khi giải nén: {e}")

if __name__ == "__main__":
    main()
