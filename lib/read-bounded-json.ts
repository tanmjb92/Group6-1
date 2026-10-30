import { MAX_IMPORT_BODY_BYTES } from './import-limits';

export type BoundedJsonResult =
  | { success: true; data: unknown }
  | { success: false; status: 400 | 413; error: string };

export async function readBoundedJson(
  request: Request,
  maxBytes = MAX_IMPORT_BODY_BYTES,
): Promise<BoundedJsonResult> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    return { success: false, status: 413, error: 'Import file is too large' };
  }

  const reader = request.body?.getReader();
  if (!reader) return { success: false, status: 400, error: 'Invalid JSON format' };

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        return { success: false, status: 413, error: 'Import file is too large' };
      }
      chunks.push(value);
    }
  } catch {
    return { success: false, status: 400, error: 'Invalid JSON format' };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { success: true, data: JSON.parse(text) as unknown };
  } catch {
    return { success: false, status: 400, error: 'Invalid JSON format' };
  }
}
