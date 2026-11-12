import { Readable } from 'node:stream';
import { ObjectStorageClient, ObjectStorageError } from '../src';

describe('SDK transport behavior', () => {
  const credentials = { accessKeyId: 'synthetic-key', secretKey: 'synthetic-secret' };
  const client = (transport: jest.Mock) =>
    new ObjectStorageClient({
      endpoint: 'http://localhost:4000',
      ...credentials,
      fetch: transport,
    });

  it.each([429, 500, 503])(
    'does not retry a mutation after HTTP %s and exposes server error fields',
    async (status) => {
      const fetch = jest.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: 'TestFailure', message: 'try manually', requestId: 'test-request' },
            }),
            { status },
          ),
      );
      const sdk = client(fetch);
      await expect(
        sdk.objects.put({ bucket: 'assets', key: 'file.txt', body: Readable.from('hello') }),
      ).rejects.toMatchObject({
        name: 'ObjectStorageError',
        status,
        code: 'TestFailure',
        requestId: 'test-request',
        message: 'try manually',
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retry transport failures or consume a stream twice', async () => {
    const error = new TypeError('connection lost');
    const fetch = jest.fn(async () => {
      throw error;
    });
    await expect(
      client(fetch).objects.put({
        bucket: 'assets',
        key: 'file.txt',
        body: Readable.from('hello'),
      }),
    ).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not follow redirects which could replay a mutation', async () => {
    const fetch = jest.fn(
      async () => new Response(null, { status: 307, headers: { location: '/other' } }),
    );
    await expect(
      client(fetch).objects.delete({ bucket: 'assets', key: 'file.txt' }),
    ).rejects.toBeInstanceOf(ObjectStorageError);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns a download stream without buffering it', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const fetch = jest.fn(
      async () => new Response(stream, { headers: { 'content-type': 'application/octet-stream' } }),
    );
    const result = await client(fetch).objects.get({ bucket: 'assets', key: 'file.bin' });
    expect(result.body).toBeInstanceOf(Readable);
    controller!.enqueue(Buffer.from('first'));
    controller!.close();
    const chunks: Buffer[] = [];
    for await (const chunk of result.body) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('first');
  });

  it('passes a streaming upload and cancellation signal directly to fetch', async () => {
    const fetch = jest.fn(async () => new Response('{}', { status: 200 }));
    const body = Readable.from('data');
    const controller = new AbortController();
    await client(fetch).objects.put({
      bucket: 'assets',
      key: 'file.txt',
      body,
      signal: controller.signal,
    });
    expect(fetch.mock.calls[0][1]).toMatchObject({
      body,
      duplex: 'half',
      signal: controller.signal,
    });
  });

  it('falls back to status/header for non-JSON and HEAD errors', async () => {
    const fetch = jest.fn(
      async () => new Response(null, { status: 404, headers: { 'x-request-id': 'header-id' } }),
    );
    await expect(
      client(fetch).objects.head({ bucket: 'assets', key: 'missing' }),
    ).rejects.toMatchObject({ code: 'HTTP_404', requestId: 'header-id', status: 404 });
  });

  it('rejects dot segments before URL normalization can target another object', async () => {
    const fetch = jest.fn();
    expect(() =>
      client(fetch).objects.put({ bucket: 'assets', key: 'folder/../other', body: 'data' }),
    ).toThrow('dot path segments');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects unsupported endpoint components and incomplete credentials', () => {
    expect(() => new ObjectStorageClient({ endpoint: 'http://localhost:4000/api' })).toThrow(
      'origin',
    );
    expect(
      () => new ObjectStorageClient({ endpoint: 'http://user:password@localhost:4000' }),
    ).toThrow('origin');
    expect(
      () => new ObjectStorageClient({ endpoint: 'http://localhost:4000', accessKeyId: 'key' }),
    ).toThrow('together');
  });

  it('rejects invalid multipart completion order before transport', () => {
    const fetch = jest.fn();
    expect(() =>
      client(fetch).multipart.complete({
        bucket: 'assets',
        key: 'file',
        uploadId: 'upload',
        parts: [
          { partNumber: 2, etag: 'a' },
          { partNumber: 1, etag: 'b' },
        ],
      }),
    ).toThrow('ascending');
    expect(fetch).not.toHaveBeenCalled();
  });
});
