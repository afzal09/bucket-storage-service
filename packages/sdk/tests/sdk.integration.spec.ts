import 'reflect-metadata';
import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AuthController } from '../../../src/auth/auth.controller';
import { AuthService } from '../../../src/auth/auth.service';
import { SignatureGuard } from '../../../src/auth/guards/signature.guard';
import { EncryptionService } from '../../../src/access-control/encryption.service';
import { PresignedUrlService } from '../../../src/access-control/presigned-url.service';
import { PolicyService } from '../../../src/access-control/policy.service';
import { BucketsController } from '../../../src/buckets/buckets.controller';
import { BucketsService } from '../../../src/buckets/buckets.service';
import { ObjectsController } from '../../../src/objects/objects.controller';
import { ObjectsService } from '../../../src/objects/objects.service';
import { MultipartService } from '../../../src/multipart/multipart.service';
import { S3ErrorFilter } from '../../../src/common/filters/s3-error.filter';
import { NoSuchKeyException } from '../../../src/common/exceptions/s3.exceptions';
import { RequestIdInterceptor } from '../../../src/common/interceptors/request-id.interceptor';
import { controlJsonMiddleware } from '../../../src/common/middleware/control-json.middleware';
import { ObjectStorageClient } from '../src';

describe('SDK against real Nest controllers, guards, JSON middleware and HTTP transport', () => {
  let app: NestExpressApplication;
  let sdk: ObjectStorageClient;
  let endpoint: string;
  let presign: PresignedUrlService;
  const data = new Map<string, any>();
  const deniedActions = new Set<string>();
  const bucket = {
    id: 'bucket-id',
    name: 'assets',
    region: 'us-east-1',
    ownerId: 'test-owner',
    versioningStatus: 'DISABLED',
    defaultEncryption: null,
    lifecycleRules: null,
    corsConfig: null,
    replicationTarget: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const resolve = (key: string) => {
    const object = data.get(key);
    if (!object) throw new NoSuchKeyException(key);
    return object;
  };

  beforeAll(async () => {
    const keys = new Map<string, any>();
    const config = new ConfigService({
      security: { encryptionMasterKey: 'test-master-key', presignedUrlSecret: 'test-presign-key' },
    });
    const encryption = new EncryptionService(config);
    const auth = new AuthService(
      {
        create: async (values) => {
          keys.set(values.accessKeyId, {
            ...values,
            update: async (next) => Object.assign(keys.get(values.accessKeyId), next),
          });
        },
        findOne: async ({ where }) => {
          const record = keys.get(where.accessKeyId);
          return record && (where.active === undefined || record.active === where.active)
            ? record
            : null;
        },
      } as any,
      encryption,
    );
    presign = new PresignedUrlService(config);
    const objects = {
      putObject: async (_bucket, key, stream, headers) => {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        const version = {
          size: bytes.length,
          contentType: headers.contentType,
          checksum: createHash('md5').update(bytes).digest('hex'),
          versionId: randomUUID(),
        };
        data.set(key, { bytes, version, tags: {}, metadata: headers.userMetadata });
        return { key, size: bytes.length, etag: version.checksum, versionId: version.versionId };
      },
      getObjectStream: async (_bucket, key, _version, range) => {
        const { bytes, version } = resolve(key);
        return {
          stream: Readable.from(range ? bytes.subarray(range.start, range.end + 1) : bytes),
          version,
        };
      },
      getObjectMetadata: async (_bucket, key) => resolve(key).version,
      getTags: async (_bucket, key) => resolve(key).tags,
      setTags: async (_bucket, key, tags) => {
        resolve(key).tags = tags;
      },
      deleteObject: async (_bucket, key) => {
        resolve(key);
        data.delete(key);
        return { key, deleteMarker: false };
      },
      listObjects: async (_bucket, query) => ({
        bucket: 'assets',
        isTruncated: false,
        contents: [...data.keys()].filter((key) => key.startsWith(query.prefix || '')),
        commonPrefixes: [],
      }),
      listObjectVersions: async () => ({ bucket: 'assets', versions: [] }),
    };
    const module = await Test.createTestingModule({
      controllers: [AuthController, BucketsController, ObjectsController],
      providers: [
        SignatureGuard,
        { provide: AuthService, useValue: auth },
        { provide: PresignedUrlService, useValue: presign },
        {
          provide: PolicyService,
          useValue: { evaluate: async (_principal, action) => !deniedActions.has(action) },
        },
        {
          provide: BucketsService,
          useValue: {
            findByName: async () => bucket,
            list: async () => [bucket],
            create: async (_name, dto) => ({ ...bucket, region: dto.region }),
            setVersioning: async (_name, status) => ({ ...bucket, versioningStatus: status }),
          },
        },
        { provide: ObjectsService, useValue: objects },
        {
          provide: MultipartService,
          useValue: {
            initiate: async () => ({ uploadId: 'test-upload' }),
            listParts: async () => [],
            storePart: async (_upload, _number, stream) => {
              let size = 0;
              for await (const chunk of stream) size += chunk.length;
              return { size, etag: 'part-etag' };
            },
            complete: async (_upload, parts) => ({
              key: 'file',
              size: 1,
              etag: parts[0].etag,
              versionId: 'version',
            }),
            abort: async () => undefined,
          },
        },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    app.use(controlJsonMiddleware);
    app.useGlobalFilters(new S3ErrorFilter());
    app.useGlobalInterceptors(new RequestIdInterceptor());
    const spec = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Test').setVersion('1').build(),
    );
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    await app.listen(0, '127.0.0.1');
    endpoint = await app.getUrl();
    const credentials = await new ObjectStorageClient({ endpoint }).auth.createAccessKey({
      ownerId: 'test-owner',
    });
    sdk = new ObjectStorageClient({ endpoint, ...credentials });
  });

  afterAll(async () => {
    if (app) await app.close();
  });
  afterEach(() => {
    deniedActions.clear();
    data.clear();
  });

  it('starts with modern wildcard routes and signs streamed JSON object uploads with complex keys', async () => {
    const key = 'folder/a space+?#%/日本語.json';
    const text = '{"hello":"world"}';
    const written = await sdk.objects.put({
      bucket: 'assets',
      key,
      body: Readable.from(text),
      contentType: 'application/json',
      userMetadata: { project: 'sdk' },
    });
    expect(written.size).toBe(Buffer.byteLength(text));
    expect(data.get(key).metadata).toEqual({ project: 'sdk' });
    const result = await sdk.objects.get({ bucket: 'assets', key });
    expect(result.contentType).toMatch(/^application\/json/);
    const chunks: Buffer[] = [];
    for await (const chunk of result.body) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe(text);
    expect(await sdk.objects.head({ bucket: 'assets', key })).toMatchObject({
      contentLength: String(Buffer.byteLength(text)),
      versionId: written.versionId,
    });
    await sdk.objects.delete({ bucket: 'assets', key });
    expect(data.has(key)).toBe(false);
  });

  it('keeps JSON control bodies parsed and query flags signed', async () => {
    expect(await sdk.buckets.create({ bucket: 'assets', region: 'test-region' })).toMatchObject({
      region: 'test-region',
    });
    expect(await sdk.buckets.setVersioning({ bucket: 'assets', status: 'ENABLED' })).toMatchObject({
      versioningStatus: 'ENABLED',
    });
    await sdk.objects.put({ bucket: 'assets', key: 'tags/file.txt', body: 'hello' });
    await sdk.objects.setTags({ bucket: 'assets', key: 'tags/file.txt', tags: { team: 'sdk' } });
    expect(await sdk.objects.getTags({ bucket: 'assets', key: 'tags/file.txt' })).toEqual({
      tags: { team: 'sdk' },
    });
    expect(
      await sdk.objects.list({ bucket: 'assets', prefix: 'tags/', delimiter: '/' }),
    ).toMatchObject({ contents: ['tags/file.txt'] });
  });

  it('supports multipart query dispatch and JSON completion without retrying', async () => {
    const input = { bucket: 'assets', key: 'nested/part-file' };
    const { uploadId } = await sdk.multipart.initiate(input);
    const part = await sdk.multipart.uploadPart({
      ...input,
      uploadId,
      partNumber: 1,
      body: Readable.from('data'),
    });
    expect(part).toEqual({ size: 4, etag: 'part-etag' });
    expect(await sdk.multipart.listParts({ ...input, uploadId })).toEqual({ parts: [] });
    expect(
      await sdk.multipart.complete({
        ...input,
        uploadId,
        parts: [{ partNumber: 1, etag: part.etag }],
      }),
    ).toMatchObject({ etag: part.etag });
    await sdk.multipart.abort({ ...input, uploadId });
  });

  it('uses presigned GET for download and rejects method replay through the real guard', async () => {
    const key = 'presigned/a space+?#%/日本語.txt';
    await sdk.objects.put({ bucket: 'assets', key, body: 'hello' });
    const { url } = await sdk.objects.presign({ bucket: 'assets', key, method: 'GET' });
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello');
    const replay = await fetch(url, { method: 'DELETE' });
    expect(replay.status).toBe(401);
    expect((await replay.json()).error.message).toBe(
      'Presigned URL does not allow this HTTP method',
    );
    expect(data.has(key)).toBe(true);
  });

  it('enforces PUT permission at generation and accepts an actual PUT link', async () => {
    deniedActions.add('PutObject');
    await expect(
      sdk.objects.presign({ bucket: 'assets', key: 'new/file.txt', method: 'PUT' }),
    ).rejects.toMatchObject({ status: 403 });
    deniedActions.clear();
    deniedActions.add('GetObject');
    const { url } = await sdk.objects.presign({
      bucket: 'assets',
      key: 'new/file.txt',
      method: 'PUT',
    });
    const uploaded = await fetch(url, {
      method: 'PUT',
      body: 'uploaded',
      headers: { 'content-type': 'text/plain' },
    });
    expect(uploaded.status).toBe(200);
    await uploaded.json();
    expect(data.get('new/file.txt').bytes.toString()).toBe('uploaded');
    const wrongMethod = await fetch(url);
    expect(wrongMethod.status).toBe(401);
    await wrongMethod.arrayBuffer();
  });

  it('exposes API errors with request IDs', async () => {
    await expect(sdk.objects.get({ bucket: 'assets', key: 'missing' })).rejects.toMatchObject({
      status: 404,
      code: 'NoSuchKey',
      requestId: expect.any(String),
    });
  });

  it('still rejects signatures for altered query parameters', async () => {
    const key = 'file.txt';
    const generated = presign.generate('assets', key, 'GET', 60, {
      ownerId: 'test-owner',
      accessKeyId: 'test-key',
    });
    const url = new URL(generated, endpoint);
    url.searchParams.set('method', 'PUT');
    const response = await fetch(url, { method: 'PUT', body: 'tampered' });
    expect(response.status).toBe(401);
    await response.arrayBuffer();
  });
});
