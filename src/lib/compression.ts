import { gzipSync, gunzipSync } from 'zlib'

/**
 * Compress a JSON-serializable object into a gzipped Buffer.
 * Typically achieves 5-10x compression on JSON data.
 */
export function compressJson(obj: unknown): Buffer {
  return gzipSync(JSON.stringify(obj))
}

/**
 * Decompress a Buffer into a parsed JSON object.
 * Falls back to raw JSON parse for backward compatibility with uncompressed data.
 */
export function decompressJson<T = any>(buf: Buffer | Uint8Array): T {
  const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  try {
    // Try gzip decompression first (new compressed format)
    return JSON.parse(gunzipSync(buffer).toString('utf-8'))
  } catch {
    // Fallback: raw JSON parse (uncompressed legacy data)
    return JSON.parse(buffer.toString('utf-8'))
  }
}
