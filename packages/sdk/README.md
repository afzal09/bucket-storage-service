# @bucket-storage/sdk

TypeScript/Node.js client for this repository's custom object storage HTTP API. Requires **Node.js 22+**, uses native fetch/crypto/streams, and has no runtime package dependencies. It does not implement AWS Signature Version 4.

## Install

Install published releases from the public npm registry:

```bash
npm install @bucket-storage/sdk
```

The SDK source stays in `packages/sdk/` of the [service repository](https://github.com/afzal09/bucket-storage-service/tree/master/packages/sdk). Consumers receive the compiled SDK, TypeScript declarations/source maps, README, and MIT license; they do not need the server repository or its dependencies.

## Build from source

From the service repository root:

```bash
npm ci
npm run build:sdk
npm pack ./packages/sdk
```

Install the resulting `bucket-storage-sdk-0.1.0.tgz` in your consumer:

```bash
npm install /absolute/path/to/bucket-storage-sdk-0.1.0.tgz
```

Packing creates a local tarball without publishing. CommonJS `require()` and ESM/TypeScript named imports are supported; TypeScript declarations ship with the build. TypeScript consumers should include Node type definitions (`@types/node`) in their own project. Developers can also build first and install the local folder with `npm install /absolute/path/to/repository/packages/sdk`.

## Connect and upload

```typescript
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ObjectStorageClient } from '@bucket-storage/sdk';

const storage = new ObjectStorageClient({
  endpoint: 'http://localhost:4000',
  accessKeyId: process.env.STORAGE_ACCESS_KEY,
  secretKey: process.env.STORAGE_SECRET_KEY,
});

await storage.buckets.create({ bucket: 'assets', region: 'us-east-1' });
const uploaded = await storage.objects.put({
  bucket: 'assets',
  key: 'images/photo.jpg',
  body: createReadStream('./photo.jpg'),
  contentType: 'image/jpeg',
  userMetadata: { project: 'demo' },
});

const downloaded = await storage.objects.get({
  bucket: 'assets',
  key: uploaded.key,
  versionId: uploaded.versionId,
});
await pipeline(downloaded.body, createWriteStream('./downloaded.jpg'));
```

`endpoint` is an HTTP(S) origin with no path prefix, query, fragment, or embedded credentials. Credentials must be supplied as a pair. Creating a client without credentials is allowed for the bootstrap operation:

```typescript
const bootstrap = new ObjectStorageClient({ endpoint: 'http://localhost:4000' });
const credentials = await bootstrap.auth.createAccessKey({ ownerId: 'demo-owner' });
const storage = new ObjectStorageClient({ endpoint: 'http://localhost:4000', ...credentials });
```

Save the secret from that response; there is no secret recovery API. Bootstrap currently trusts the supplied owner ID. All other SDK methods require credentials. The client does not load `.env` or consult AWS credential providers.

## Operations

All methods take a single named-input object; optional request `signal` is supported everywhere. Timestamp values remain ISO strings; database BIGINT sizes remain `number | string` where the API can emit either. Metadata Content-Length is preserved as text.

| Group             | Methods and input                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth`            | `createAccessKey({ ownerId })`, `revokeAccessKey({ accessKeyId })`                                                                                                                                                             |
| `buckets`         | `create({ bucket, region })`, `list()`, `delete({ bucket })`                                                                                                                                                                   |
| Bucket policy     | `setPolicy({ bucket, statements })`, `getPolicy({ bucket })`                                                                                                                                                                   |
| Bucket versioning | `setVersioning({ bucket, status })`, `getVersioning({ bucket })`                                                                                                                                                               |
| Bucket lifecycle  | `setLifecycle({ bucket, rules })`, `getLifecycle({ bucket })`                                                                                                                                                                  |
| Bucket encryption | `setEncryption({ bucket, config })`, `getEncryption({ bucket })`                                                                                                                                                               |
| Stored CORS       | `setCors({ bucket, rules })`, `getCors({ bucket })`                                                                                                                                                                            |
| `objects`         | `put({ bucket, key, body, contentType?, userMetadata? })`, `get({ bucket, key, versionId?, range? })`, `head({ bucket, key, versionId? })`, `delete({ bucket, key, versionId? })`                                              |
| Object listing    | `list({ bucket, prefix?, delimiter?, marker? })`, `listVersions({ bucket, prefix? })`                                                                                                                                          |
| Object copy       | `copy({ bucket, key, sourceBucket, sourceKey })`                                                                                                                                                                               |
| Object tags       | `setTags({ bucket, key, tags })`, `getTags({ bucket, key })`                                                                                                                                                                   |
| Temporary links   | `presign({ bucket, key, method, expiresIn? })`                                                                                                                                                                                 |
| `multipart`       | `initiate({ bucket, key, contentType? })`, `uploadPart({ bucket, key, uploadId, partNumber, body })`, `listParts({ bucket, key, uploadId })`, `complete({ bucket, key, uploadId, parts })`, `abort({ bucket, key, uploadId })` |

Bucket configuration methods live on `storage.buckets`, and object methods on `storage.objects`. Versioning setter accepts ENABLED or SUSPENDED. Lifecycle/CORS setters send the required bare arrays; policy setter sends a statements wrapper. Read policy returns rows. Get-tags returns `{ tags }`; part listing returns `{ parts }`, including the server's internal row fields. Mutations with no useful response return `void` after consuming the body.

Uploads accept strings, Uint8Array/Buffer, Node Readable, web ReadableStream, or byte AsyncIterable. Downloads return a **Node Readable** with status, contentType, contentLength, etag, versionId, and requestId when headers exist. Always consume or destroy the stream. JSON object uploads can use `contentType: 'application/json'`; the server keeps object PUT bodies raw. Control messages are serialized automatically.

Object path segments are encoded, preserving slash-separated keys, spaces, Unicode, literal percent signs, `?`, and `#`. Empty keys and `.`/`..` segments are rejected because URL normalization would otherwise change the target. Copy uses the API's literal copy-source header, whose values must be representable as HTTP headers; it is not an encoded source-URL contract.

## Listing and versions

```typescript
let marker: string | undefined;
do {
  const page = await storage.objects.list({ bucket: 'assets', prefix: 'images/', marker });
  console.log(page.contents, page.commonPrefixes);
  marker = page.isTruncated ? page.nextMarker : undefined;
} while (marker);

const versions = await storage.objects.listVersions({ bucket: 'assets', prefix: 'images/' });
console.log(versions.versions);
```

The SDK intentionally does not expose `maxKeys`: server query strings currently inflate its lookahead fetch instead of undergoing numeric conversion. Listing defaults to 1000 raw rows and delimiter grouping occurs after pagination. `versionId` always means the public version ID, never the internal database PK. All PUTs create versions regardless of bucket versioning status; bare DELETE under ENABLED creates a marker. Explicit version deletion is permanent.

## Presigned links

```typescript
const { url } = await storage.objects.presign({
  bucket: 'assets',
  key: 'images/photo.jpg',
  method: 'GET',
  expiresIn: 900,
});
const response = await fetch(url);
```

Unlike the raw API's relative path, the SDK returns an absolute URL on its configured origin. Preserve it exactly. GET links allow GET; PUT links allow PUT. HEAD against a GET link is rejected. Generation checks GetObject or PutObject permission respectively; actual use still checks current policy. The SDK requires a positive finite expiry when provided; the server otherwise defaults to 3600 seconds. Key revocation does not independently revoke existing links. The SDK generates links through the signed API, not by knowing the server's global presign secret.

## Multipart uploads

```typescript
const object = { bucket: 'assets', key: 'large.bin' };
const { uploadId } = await storage.multipart.initiate(object);
const session = { ...object, uploadId };

const first = await storage.multipart.uploadPart({
  ...session,
  partNumber: 1,
  body: Buffer.alloc(5 * 1024 * 1024, 'a'),
});
const last = await storage.multipart.uploadPart({
  ...session,
  partNumber: 2,
  body: Buffer.from('last'),
});
const result = await storage.multipart.complete({
  ...session,
  parts: [
    { partNumber: 1, etag: first.etag },
    { partNumber: 2, etag: last.etag },
  ],
});
```

There is no hidden chunking, parallelism, cleanup, or retry loop. Submit unique positive part numbers in ascending order; the SDK rejects empty/duplicate/out-of-order completion lists. Server requires at least 5 MiB for every non-last part at completion. Use `abort(session)` to explicitly discard an unfinished upload.

Sequentially uploading an existing part now stages a new pointer before publishing metadata and removing old bytes. Completion/abort still are not transactional or safely replayable; cleanup can fail after object creation. Inspect object/version/part state before a manual retry. Concurrent replacement is not serialized and can leave unreferenced bytes. Multipart completion still bypasses bucket default encryption.

## Errors, cancellation, and retries

```typescript
import { ObjectStorageError } from '@bucket-storage/sdk';

try {
  const object = await storage.objects.get({
    bucket: 'assets',
    key: 'images/photo.jpg',
    signal: AbortSignal.timeout(30_000),
  });
  await pipeline(object.body, createWriteStream('./downloaded.jpg'));
} catch (error) {
  if (error instanceof ObjectStorageError) {
    console.error(error.status, error.code, error.message, error.requestId);
  } else {
    throw error;
  }
}
```

HTTP failures throw ObjectStorageError with the API error code/message when present; non-JSON or bodyless HEAD errors fall back to `HTTP_<status>` and the request-ID header. Transport, cancellation, and download-stream errors retain their underlying error. No default timeout is imposed; callers can supply AbortSignal, which also governs subsequent stream reading.

**No operations are automatically retried**, including 429/5xx responses and connection failures. Redirects are returned as errors rather than followed, preventing implicit mutation replay. Reusing a consumed Readable for a manual retry will not recreate its contents; open a fresh stream. A custom `fetch` option can provide instrumentation but should not introduce mutation retries either.

Other server limitations remain: range on encrypted objects returns the full plaintext, encrypted server-side copy reads ciphertext, stored CORS/class transitions are metadata only, and SSE_KMS is local simulation. The SDK does not hide or repair those behaviors. See repository `docs/USAGE-GUIDE.md` and `docs/API-CONTRACT-SYNC.md` for the complete product contract.

## Development checks

From the repository root:

```bash
npm run build:sdk
npm run typecheck:sdk
npm run test:sdk
```

The focused Jest command names four explicit specs and uses `--runInBand`. SDK specs live in `packages/sdk/tests/`; server regression specs live alongside their services in `src/multipart/tests/` and `src/access-control/tests/`. NestJS 12's ESM dependencies require Jest's VM-module support; the script supplies the flag. HTTP integration tests bind a temporary loopback port with in-memory model/service fixtures; multipart regressions use temporary local files. They do not require PostgreSQL or an upstream S3 service. The package has no dependency on server classes at runtime.

## Publishing

The npm organization is `bucket-storage`; the package is `@bucket-storage/sdk` and uses the MIT license. `publishConfig` selects public npmjs.com visibility/registry. Publishing this nested package leaves the root server package private. This does not publish to GitHub Packages or populate that registry's Packages section.

For a first/manual publication, use an npm account with publishing access to the organization and complete npm's required authentication:

```bash
npm login --registry=https://registry.npmjs.org/
npm run typecheck:sdk
npm run test:sdk
npm pack ./packages/sdk --dry-run
npm publish ./packages/sdk --access public
```

The prepack lifecycle builds the SDK. Only `dist/`, README, LICENSE, and npm's package metadata are distributed. Do not publish the repository root. Never put npm credentials into package files or tracked `.npmrc` files.

For subsequent releases, this repository provides `.github/workflows/publish-sdk.yml`. Configure an npm trusted publisher on the package's npm settings with:

- Provider: GitHub Actions, using GitHub-hosted runners.
- GitHub owner: `afzal09` (separate from the npm organization).
- Repository: `bucket-storage-service`.
- Workflow filename: `publish-sdk.yml`.
- Allow direct `npm publish`; current npm settings may otherwise permit staged publishing only.

The workflow uses Node 24 and OIDC, without storing an npm publishing token. npm requires at least npm 11.5.1/Node 22.14 for trusted publishing. A new trusted-publisher configuration must complete a successful publication within two days; configure it close to the next release. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for account-side setup.

Update the SDK version, commit/push its source and release configuration, then push a matching tag such as `sdk-v0.1.1`, or run the workflow manually with the exact version. The workflow checks version/tag agreement, server/SDK builds and focused tests before publishing. Prerelease versions use npm's `next` tag; ordinary versions use `latest`. Published versions cannot be overwritten: use a new version for every release.
