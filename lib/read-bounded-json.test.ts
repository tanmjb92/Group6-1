import { describe, expect, it } from 'vitest';
import { readBoundedJson } from './read-bounded-json';

function jsonRequest(body: string): Request {
  return new Request('http://localhost/api/todos/import', {
    method: 'POST',
    body,
  });
}

describe('readBoundedJson', () => {
  it('parses valid JSON within the byte limit', async () => {
    await expect(readBoundedJson(jsonRequest('{"version":1}'))).resolves.toEqual({
      success: true,
      data: { version: 1 },
    });
  });

  it('rejects malformed JSON and invalid UTF-8', async () => {
    await expect(readBoundedJson(jsonRequest('{invalid'))).resolves.toMatchObject({
      success: false,
      status: 400,
      error: 'Invalid JSON format',
    });
    const invalidUtf8 = new Request('http://localhost/api/todos/import', {
      method: 'POST',
      body: new Uint8Array([0xff]),
    });
    await expect(readBoundedJson(invalidUtf8)).resolves.toMatchObject({
      success: false,
      status: 400,
      error: 'Invalid JSON format',
    });
  });

  it('stops reading bodies that exceed the configured byte limit', async () => {
    await expect(readBoundedJson(jsonRequest('{"long":"body"}'), 8)).resolves.toEqual({
      success: false,
      status: 413,
      error: 'Import file is too large',
    });
  });

  it('cancels a body stream when its declared length exceeds the limit', async () => {
    let canceled = false;
    const request = new Request(
      'http://localhost/api/todos/import',
      {
        method: 'POST',
        headers: { 'content-length': '10' },
        body: new ReadableStream({
          cancel() {
            canceled = true;
          },
        }),
        duplex: 'half',
      } as RequestInit & { duplex: 'half' },
    );

    await expect(readBoundedJson(request, 5)).resolves.toMatchObject({
      success: false,
      status: 413,
    });
    expect(canceled).toBe(true);
  });
});
