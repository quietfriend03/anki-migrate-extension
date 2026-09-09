/**
 * Zero-dependency ZIP file reader for J-Lexicon AI
 * Uses browser's native DecompressionStream('deflate-raw') to extract JSON files from Jitendex .zip
 */

export class ZipReader {
  /**
   * Parse a ZIP file and extract JSON text contents
   * @param {Blob|File|ArrayBuffer} input 
   * @returns {Promise<Array<{ name: string, readAsText: () => Promise<string>, readAsJson: () => Promise<any> }>>}
   */
  static async readZip(input) {
    let arrayBuffer;
    if (input instanceof ArrayBuffer) {
      arrayBuffer = input;
    } else if (input instanceof Blob || input instanceof File) {
      arrayBuffer = await input.arrayBuffer();
    } else {
      throw new Error('Invalid input for ZipReader: expected File, Blob, or ArrayBuffer');
    }

    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);

    // 1. Locate End of Central Directory (EOCD) signature: 0x06054b50
    let eocdOffset = -1;
    for (let i = arrayBuffer.byteLength - 22; i >= Math.max(0, arrayBuffer.byteLength - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset === -1) {
      throw new Error('Not a valid ZIP archive (EOCD signature not found)');
    }

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);

    const files = [];
    let currentOffset = cdOffset;

    // 2. Iterate Central Directory headers: 0x02014b50
    for (let i = 0; i < totalEntries; i++) {
      if (currentOffset + 46 > arrayBuffer.byteLength) break;
      const sig = view.getUint32(currentOffset, true);
      if (sig !== 0x02014b50) break;

      const method = view.getUint16(currentOffset + 10, true); // 0 = store, 8 = deflate
      const compressedSize = view.getUint32(currentOffset + 20, true);
      const uncompressedSize = view.getUint32(currentOffset + 24, true);
      const fileNameLength = view.getUint16(currentOffset + 28, true);
      const extraFieldLength = view.getUint16(currentOffset + 30, true);
      const commentLength = view.getUint16(currentOffset + 32, true);
      const localHeaderOffset = view.getUint32(currentOffset + 42, true);

      const fileNameBytes = bytes.subarray(currentOffset + 46, currentOffset + 46 + fileNameLength);
      const fileName = new TextDecoder('utf-8').decode(fileNameBytes);

      currentOffset += 46 + fileNameLength + extraFieldLength + commentLength;

      // Skip directory entries
      if (fileName.endsWith('/')) continue;

      // Function to extract and decompress file data
      const getData = async () => {
        // Read local file header to find data offset
        const localSig = view.getUint32(localHeaderOffset, true);
        if (localSig !== 0x04034b50) {
          throw new Error(`Invalid local header for ${fileName}`);
        }
        const localNameLen = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const compressedData = bytes.subarray(dataStart, dataStart + compressedSize);

        if (method === 0) {
          // Stored without compression
          return compressedData;
        } else if (method === 8) {
          // Deflated: decompress with DecompressionStream
          if (typeof DecompressionStream === 'undefined') {
            throw new Error('DecompressionStream is not supported in this browser version');
          }
          const ds = new DecompressionStream('deflate-raw');
          const writer = ds.writable.getWriter();
          writer.write(compressedData);
          writer.close();

          const response = new Response(ds.readable);
          const buf = await response.arrayBuffer();
          return new Uint8Array(buf);
        } else {
          throw new Error(`Unsupported compression method: ${method}`);
        }
      };

      files.push({
        name: fileName,
        compressedSize,
        uncompressedSize,
        readAsText: async () => {
          const raw = await getData();
          return new TextDecoder('utf-8').decode(raw);
        },
        readAsJson: async () => {
          const raw = await getData();
          const text = new TextDecoder('utf-8').decode(raw);
          return JSON.parse(text);
        }
      });
    }

    return files;
  }
}
