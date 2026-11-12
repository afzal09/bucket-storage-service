import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { ObjectStorageError } from './errors';
import type {
  AccessKey,
  Bucket,
  BucketInput,
  ClientOptions,
  CompletedPart,
  CopyResult,
  CorsRule,
  DeleteResult,
  DownloadInput,
  DownloadResult,
  EncryptionConfig,
  HeadResult,
  LifecycleRule,
  ListObjectsInput,
  ListObjectsResult,
  ListVersionsResult,
  ObjectInput,
  PartRow,
  PolicyRow,
  PolicyStatement,
  PutResult,
  RequestOptions,
  StringMap,
  UploadBody,
  UploadInput,
  UploadSessionInput,
  VersionInput,
  VersioningStatus,
} from './types';

type Query = Record<string, string | number | undefined>;
interface SendOptions extends RequestOptions {
  query?: Query;
  headers?: Record<string, string>;
  json?: unknown;
  body?: UploadBody;
  unsigned?: boolean;
}

/** Node.js client. Every call makes one transport attempt; redirects are not followed. */
export class ObjectStorageClient {
  private readonly endpoint: URL;
  private readonly accessKeyId?: string;
  private readonly secretKey?: string;
  private readonly transport: typeof globalThis.fetch;

  constructor(options: ClientOptions) {
    this.endpoint = new URL(options.endpoint);
    if (
      !['http:', 'https:'].includes(this.endpoint.protocol) ||
      this.endpoint.pathname !== '/' ||
      this.endpoint.search ||
      this.endpoint.hash ||
      this.endpoint.username ||
      this.endpoint.password
    ) {
      throw new TypeError(
        'endpoint must be an HTTP(S) origin without credentials, path, query, or fragment',
      );
    }
    if (Boolean(options.accessKeyId) !== Boolean(options.secretKey)) {
      throw new TypeError('accessKeyId and secretKey must be supplied together');
    }
    this.accessKeyId = options.accessKeyId;
    this.secretKey = options.secretKey;
    this.transport = options.fetch || globalThis.fetch;
  }

  readonly auth = {
    createAccessKey: (input: RequestOptions & { ownerId: string }): Promise<AccessKey> =>
      this.json('POST', '/auth/keys', {
        json: { ownerId: input.ownerId },
        unsigned: true,
        signal: input.signal,
      }),
    revokeAccessKey: async (input: RequestOptions & { accessKeyId: string }): Promise<void> => {
      await this.empty('DELETE', `/auth/keys/${encodeURIComponent(input.accessKeyId)}`, input);
    },
  };

  readonly buckets = {
    create: (input: BucketInput & { region: string }): Promise<Bucket> =>
      this.json('PUT', this.bucketPath(input.bucket), {
        json: { region: input.region },
        signal: input.signal,
      }),
    list: (input: RequestOptions = {}): Promise<Bucket[]> => this.json('GET', '/', input),
    delete: (input: BucketInput): Promise<void> =>
      this.empty('DELETE', this.bucketPath(input.bucket), input),
    setPolicy: async (input: BucketInput & { statements: PolicyStatement[] }): Promise<void> => {
      await this.empty('PUT', this.bucketPath(input.bucket), {
        query: { policy: '' },
        json: { statements: input.statements },
        signal: input.signal,
      });
    },
    getPolicy: (input: BucketInput): Promise<PolicyRow[]> =>
      this.json('GET', this.bucketPath(input.bucket), {
        query: { policy: '' },
        signal: input.signal,
      }),
    setVersioning: (
      input: BucketInput & { status: Exclude<VersioningStatus, 'DISABLED'> },
    ): Promise<Bucket> =>
      this.json('PUT', this.bucketPath(input.bucket), {
        query: { versioning: '' },
        json: { status: input.status },
        signal: input.signal,
      }),
    getVersioning: (input: BucketInput): Promise<{ status: VersioningStatus }> =>
      this.json('GET', this.bucketPath(input.bucket), {
        query: { versioning: '' },
        signal: input.signal,
      }),
    setLifecycle: (input: BucketInput & { rules: LifecycleRule[] }): Promise<Bucket> =>
      this.json('PUT', this.bucketPath(input.bucket), {
        query: { lifecycle: '' },
        json: input.rules,
        signal: input.signal,
      }),
    getLifecycle: (input: BucketInput): Promise<{ rules: LifecycleRule[] }> =>
      this.json('GET', this.bucketPath(input.bucket), {
        query: { lifecycle: '' },
        signal: input.signal,
      }),
    setEncryption: (input: BucketInput & { config: EncryptionConfig }): Promise<Bucket> =>
      this.json('PUT', this.bucketPath(input.bucket), {
        query: { encryption: '' },
        json: input.config,
        signal: input.signal,
      }),
    getEncryption: (input: BucketInput): Promise<EncryptionConfig | Record<string, never>> =>
      this.json('GET', this.bucketPath(input.bucket), {
        query: { encryption: '' },
        signal: input.signal,
      }),
    setCors: (input: BucketInput & { rules: CorsRule[] }): Promise<Bucket> =>
      this.json('PUT', this.bucketPath(input.bucket), {
        query: { cors: '' },
        json: input.rules,
        signal: input.signal,
      }),
    getCors: (input: BucketInput): Promise<{ rules: CorsRule[] }> =>
      this.json('GET', this.bucketPath(input.bucket), {
        query: { cors: '' },
        signal: input.signal,
      }),
  };

  readonly objects = {
    put: (input: UploadInput): Promise<PutResult> => {
      const headers: Record<string, string> = {
        'content-type': input.contentType || 'application/octet-stream',
      };
      for (const [name, value] of Object.entries(input.userMetadata || {}))
        headers[`x-amz-meta-${name}`] = value;
      return this.json('PUT', this.objectPath(input), {
        body: input.body,
        headers,
        signal: input.signal,
      });
    },
    get: async (input: DownloadInput): Promise<DownloadResult> => {
      const headers: Record<string, string> = {};
      if (input.range) {
        const { start, end } = input.range;
        if (
          !Number.isSafeInteger(start) ||
          start < 0 ||
          (end !== undefined && (!Number.isSafeInteger(end) || end < start))
        ) {
          throw new TypeError(
            'range must have a nonnegative integer start and an end at least as large as start',
          );
        }
        headers.range = `bytes=${start}-${end ?? ''}`;
      }
      const response = await this.send('GET', this.objectPath(input), {
        query: { versionId: input.versionId },
        headers,
        signal: input.signal,
      });
      return {
        ...this.responseHeaders(response),
        body: response.body
          ? Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>)
          : Readable.from([]),
      };
    },
    head: async (input: VersionInput): Promise<HeadResult> => {
      const response = await this.send('HEAD', this.objectPath(input), {
        query: { versionId: input.versionId },
        signal: input.signal,
      });
      return this.responseHeaders(response);
    },
    delete: (input: VersionInput): Promise<DeleteResult> =>
      this.json('DELETE', this.objectPath(input), {
        query: { versionId: input.versionId },
        signal: input.signal,
      }),
    list: (input: ListObjectsInput): Promise<ListObjectsResult> =>
      this.json('GET', this.bucketPath(input.bucket), {
        query: { prefix: input.prefix, delimiter: input.delimiter, marker: input.marker },
        signal: input.signal,
      }),
    listVersions: (input: BucketInput & { prefix?: string }): Promise<ListVersionsResult> =>
      this.json('GET', this.bucketPath(input.bucket), {
        query: { versions: '', prefix: input.prefix },
        signal: input.signal,
      }),
    copy: (
      input: ObjectInput & { sourceBucket: string; sourceKey: string },
    ): Promise<CopyResult> => {
      this.objectPath({ bucket: input.sourceBucket, key: input.sourceKey });
      return this.json('PUT', this.objectPath(input), {
        headers: { 'x-amz-copy-source': `/${input.sourceBucket}/${input.sourceKey}` },
        signal: input.signal,
      });
    },
    getTags: (input: ObjectInput): Promise<{ tags: StringMap }> =>
      this.json('GET', this.objectPath(input), { query: { tagging: '' }, signal: input.signal }),
    setTags: (input: ObjectInput & { tags: StringMap }): Promise<void> =>
      this.empty('POST', this.objectPath(input), {
        query: { tagging: '' },
        json: { tags: input.tags },
        signal: input.signal,
      }),
    presign: async (
      input: ObjectInput & { method: 'GET' | 'PUT'; expiresIn?: number },
    ): Promise<{ url: string }> => {
      if (input.method !== 'GET' && input.method !== 'PUT')
        throw new TypeError('method must be GET or PUT');
      if (
        input.expiresIn !== undefined &&
        (!Number.isFinite(input.expiresIn) || input.expiresIn <= 0)
      ) {
        throw new TypeError('expiresIn must be a positive finite number');
      }
      const result = await this.json<{ url: string }>('GET', this.objectPath(input), {
        query: { presign: input.method, expiresIn: input.expiresIn },
        signal: input.signal,
      });
      const url = new URL(result.url, this.endpoint);
      if (url.origin !== this.endpoint.origin)
        throw new Error('Server returned a presigned URL for a different origin');
      return { url: url.href };
    },
  };

  readonly multipart = {
    initiate: (input: ObjectInput & { contentType?: string }): Promise<{ uploadId: string }> =>
      this.json('POST', this.objectPath(input), {
        query: { uploads: '' },
        headers: input.contentType ? { 'content-type': input.contentType } : undefined,
        signal: input.signal,
      }),
    uploadPart: (
      input: UploadSessionInput & { partNumber: number; body: UploadBody },
    ): Promise<{ etag: string; size: number }> => {
      if (!Number.isInteger(input.partNumber) || input.partNumber < 1)
        throw new TypeError('partNumber must be a positive integer');
      return this.json('PUT', this.objectPath(input), {
        query: { uploadId: input.uploadId, partNumber: input.partNumber },
        body: input.body,
        headers: { 'content-type': 'application/octet-stream' },
        signal: input.signal,
      });
    },
    listParts: (input: UploadSessionInput): Promise<{ parts: PartRow[] }> =>
      this.json('GET', this.objectPath(input), {
        query: { uploadId: input.uploadId },
        signal: input.signal,
      }),
    complete: (input: UploadSessionInput & { parts: CompletedPart[] }): Promise<PutResult> => {
      let previous = 0;
      for (const part of input.parts) {
        if (!Number.isInteger(part.partNumber) || part.partNumber <= previous) {
          throw new TypeError('parts must have unique positive part numbers in ascending order');
        }
        previous = part.partNumber;
      }
      if (!input.parts.length) throw new TypeError('parts must not be empty');
      return this.json('POST', this.objectPath(input), {
        query: { uploadId: input.uploadId },
        json: { parts: input.parts },
        signal: input.signal,
      });
    },
    abort: (input: UploadSessionInput): Promise<void> =>
      this.empty('DELETE', this.objectPath(input), {
        query: { uploadId: input.uploadId },
        signal: input.signal,
      }),
  };

  private bucketPath(bucket: string): string {
    if (!bucket || bucket === '.' || bucket === '..' || bucket.includes('/'))
      throw new TypeError('bucket must be a nonempty bucket name');
    return `/${encodeURIComponent(bucket)}`;
  }

  private objectPath(input: { bucket: string; key: string }): string {
    if (!input.key || input.key.split('/').some((segment) => segment === '.' || segment === '..')) {
      throw new TypeError('key must be nonempty and must not contain dot path segments');
    }
    return `${this.bucketPath(input.bucket)}/${input.key.split('/').map(encodeURIComponent).join('/')}`;
  }

  private async json<T>(method: string, path: string, options: SendOptions): Promise<T> {
    const response = await this.send(method, path, options);
    return (await response.json()) as T;
  }

  private async empty(method: string, path: string, options: SendOptions): Promise<void> {
    const response = await this.send(method, path, options);
    await response.arrayBuffer();
  }

  private responseHeaders(response: Response): HeadResult {
    const header = (name: string) => response.headers.get(name) ?? undefined;
    return {
      status: response.status,
      contentType: header('content-type'),
      contentLength: header('content-length'),
      etag: header('etag'),
      versionId: header('x-amz-version-id'),
      requestId: header('x-request-id'),
    };
  }

  private async send(method: string, path: string, options: SendOptions): Promise<Response> {
    const url = new URL(path, this.endpoint);
    for (const [name, value] of Object.entries(options.query || {})) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    const headers = new Headers(options.headers);
    headers.set('host', url.host);
    let body: unknown = options.body;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      headers.set('content-type', 'application/json');
    }
    if (!options.unsigned) {
      if (!this.accessKeyId || !this.secretKey)
        throw new TypeError('This operation requires accessKeyId and secretKey');
      const query = Object.fromEntries(url.searchParams);
      const canonicalQuery = Object.keys(query)
        .sort()
        .map((name) => `${name}=${query[name]}`)
        .join('&');
      const canonical = [method, url.pathname, canonicalQuery, `host:${url.host}`, 'host'].join(
        '\n',
      );
      const signature = createHmac('sha256', this.secretKey).update(canonical).digest('hex');
      headers.set(
        'authorization',
        `OSS-HMAC-SHA256 Credential=${this.accessKeyId}, SignedHeaders=host, Signature=${signature}`,
      );
    }
    const init: RequestInit & { duplex?: 'half' } = {
      method,
      headers,
      signal: options.signal,
      redirect: 'manual',
      body: body as BodyInit | undefined,
    };
    if (body !== undefined && typeof body !== 'string' && !(body instanceof Uint8Array))
      init.duplex = 'half';
    const response = await this.transport(url, init);
    if (!response.ok) {
      let details: { code?: unknown; message?: unknown; requestId?: unknown } | undefined;
      const text = await response.text();
      try {
        details = JSON.parse(text)?.error;
      } catch {
        /* Non-JSON upstream/HEAD errors use the HTTP fallback. */
      }
      throw new ObjectStorageError(
        typeof details?.message === 'string'
          ? details.message
          : `HTTP ${response.status} ${response.statusText}`.trim(),
        response.status,
        typeof details?.code === 'string' ? details.code : `HTTP_${response.status}`,
        typeof details?.requestId === 'string'
          ? details.requestId
          : (response.headers.get('x-request-id') ?? undefined),
      );
    }
    return response;
  }
}
