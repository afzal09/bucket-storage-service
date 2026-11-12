# Object Storage Service usage guide

This guide explains how to run and use the HTTP object storage product in this repository. It follows the current `master` working tree, base commit `80b38457d75bdcaa92a1dcf63ad72bde673d8c70`, read 13 November 2026, including the SDK, routing, multipart replacement, JSON streaming, and presigned-method fixes in this task. See [ARCHITECTURE.md](ARCHITECTURE.md), [API-CONTRACT-SYNC.md](API-CONTRACT-SYNC.md), and the [SDK guide](../packages/sdk/README.md).

**SDK available:** the Node.js/TypeScript client in `packages/sdk/` handles signing and streaming. Express 5 route registration, JSON object PUTs, part replacement recovery, and presigned GET/PUT method enforcement are covered by focused tests. Tests use a temporary HTTP server and metadata fixtures; a real installation still needs PostgreSQL and configured storage.

## Contents

- [What the product does](#what-the-product-does)
- [Install and start](#install-and-start)
- [Configuration reference](#configuration-reference)
- [TypeScript SDK](#typescript-sdk)
- [Signed request client](#signed-request-client)
- [Create credentials and a bucket](#create-credentials-and-a-bucket)
- [Upload, read, inspect, and list objects](#upload-read-inspect-and-list-objects)
- [Versions, deletion, and recovery](#versions-deletion-and-recovery)
- [Tags and metadata](#tags-and-metadata)
- [Share access with policies](#share-access-with-policies)
- [Temporary links](#temporary-links)
- [Multipart uploads](#multipart-uploads)
- [Encryption, retention, and CORS](#encryption-retention-and-cors)
- [Use an upstream S3-compatible byte store](#use-an-upstream-s3-compatible-byte-store)
- [Operator-only notification and replication setup](#operator-only-notification-and-replication-setup)
- [Operate and troubleshoot](#operate-and-troubleshoot)
- [Documentation validation](#documentation-validation)

## What the product does

You create named buckets, store byte payloads under keys such as `public/hello.txt`, read them back, inspect versions, add tags/user metadata, and share authenticated access through policies or signed links. A bucket groups keys and holds configuration; `/` inside a key is a naming convention rather than a real directory. `prefix` and `delimiter` support folder-like listings.

The product has no web management application. `/docs` is Swagger API documentation, not a file browser. The public API is S3-shaped but uses its own signing scheme and JSON contracts; an AWS CLI or ordinary AWS S3 SDK client cannot call it unchanged. The optional S3 backend is a separate concern: the server itself uses an AWS SDK to store bytes upstream.

Capabilities currently exposed through HTTP:

| Need                | Supported workflow                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Credentials         | Create a pair for an owner; revoke a known access key. No key-list or secret-recovery route.                                      |
| Buckets             | Create/list/delete and read/write policy, versioning, lifecycle, encryption, stored CORS configuration.                           |
| Objects             | PUT/GET/HEAD/DELETE, copy, tags, latest/historical versions, prefix/delimiter listing.                                            |
| Large uploads       | Initiate, upload/list parts, complete, abort.                                                                                     |
| Temporary sharing   | Generate relative presigned URLs and use them before expiry.                                                                      |
| Background behavior | Daily lifecycle sweep, in-process object events, webhook/replication listeners. Notification/replication setup has no HTTP route. |

An owner ID is the account boundary. Access keys identify credentials, buckets belong to owner IDs, and object policy principals name owner IDs. The bootstrap endpoint accepts the owner string directly and is intended for the current development/demo identity model.

## Install and start

Work from the repository root. The checkout does not declare a Node engine range; Node 24.22.1 and npm 11.19.1 were available for the documentation checks. PostgreSQL is the installed database driver/default. There is no checked-in Docker/Compose deployment or migration command.

Object routes now use Express 5 named wildcards. Their adapter normalization can be checked without a database:

```bash
node -e 'const {ExpressAdapter}=require("@nestjs/platform-express"); console.log(new ExpressAdapter().normalizePath("/:bucket/*key"));'
```

The adapter accepts `/:bucket/*key`; [SignatureGuard](../src/auth/guards/signature.guard.ts) rejoins decoded wildcard arrays into the full key. The focused SDK integration specs start these routes and Swagger discovery. A successful build alone does not establish real database connectivity; configure the environment and database below for full service startup.

1. Install locked dependencies and create the environment file on a fresh checkout:

   ```bash
   npm ci
   cp .env.example .env
   ```

   Keep an existing `.env` if you have already configured one. Edit it with the database credentials for your installation; this guide does not read or copy private `.env` values.

2. With PostgreSQL running, create the configured database using an appropriate administrative connection:

   ```bash
   createdb -h localhost -p 5432 -U postgres object_storage
   ```

   The equivalent SQL is `CREATE DATABASE object_storage;`. The app does not create the database itself. It synchronizes tables/models at startup using the configured database account.

3. Build and run:

   ```bash
   npm run build
   npm run start:prod
   ```

   For rebuild/watch development use `npm run dev`. `npm run start` invokes `nest start`. There is **no `start:dev` script** in the current package despite the older README example.

4. The copied example sets port **4000**. Visit `http://localhost:4000/docs` or fetch the generated spec:

   ```bash
   curl http://localhost:4000/docs-json
   ```

   If you leave PORT unset, use port 3000. There is no explicit health endpoint; an authenticated root listing is a better product-level read check than treating the docs page as a storage check.

Starting against a new database creates schema automatically (`synchronize: true`). This is not a versioned migration workflow. Stop the process using Ctrl-C in the serving terminal.

## Configuration reference

Source: [configuration.ts](../src/config/configuration.ts). Restart the application after environment changes.

| Variable                 | Default/fallback                 | Meaning                                                                                                                                                                     |
| ------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                   | `3000`; example file uses `4000` | HTTP listening port.                                                                                                                                                        |
| `DB_DIALECT`             | `postgres`                       | Sequelize dialect. SQLite is an optional code path, not installed by default.                                                                                               |
| `DB_HOST`                | `localhost`                      | Database host.                                                                                                                                                              |
| `DB_PORT`                | `5432`                           | Database port, parsed as integer.                                                                                                                                           |
| `DB_USERNAME`            | `postgres`                       | Database account.                                                                                                                                                           |
| `DB_PASSWORD`            | Development fallback in source   | Supply your local database password; no secret is reproduced here.                                                                                                          |
| `DB_NAME`                | `object_storage`                 | Existing database name.                                                                                                                                                     |
| `DB_STORAGE`             | `./data/metadata.sqlite`         | Used only for SQLite.                                                                                                                                                       |
| `STORAGE_ADAPTER`        | `local`                          | Exact `s3` selects S3 adapter; every other value selects local.                                                                                                             |
| `STORAGE_LOCAL_ROOT`     | `./data/blobs`                   | Blob directory, relative to process working directory if relative. Persist this directory alongside database metadata.                                                      |
| `S3_ENDPOINT`            | Unset                            | Optional compatible endpoint; setting it enables path-style access.                                                                                                         |
| `S3_BUCKET`              | Unset                            | One existing upstream bucket for all logical bucket bytes.                                                                                                                  |
| `S3_ACCESS_KEY_ID`       | Unset                            | Upstream credential; when absent, SDK default credential handling is used.                                                                                                  |
| `S3_SECRET_ACCESS_KEY`   | Unset                            | Matching upstream secret.                                                                                                                                                   |
| `S3_REGION`              | `us-east-1`                      | Upstream S3 region.                                                                                                                                                         |
| `ENCRYPTION_MASTER_KEY`  | Insecure development fallback    | Master material for access-key secrets and wrapped per-object encryption keys; normalized with SHA256. Use one stable value across restarts/replicas serving the same data. |
| `PRESIGNED_URL_SECRET`   | Insecure development fallback    | Global HMAC secret for presigned links; changing it invalidates existing links.                                                                                             |
| `REQUEST_SIGNING_SECRET` | Development placeholder          | Loaded but unused; API requests use generated per-access-key secrets.                                                                                                       |

Generate replacement secret material for a **new installation**, then put it into the relevant environment variables:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Changing an established encryption master key without migrating wrapped records breaks old access-key authentication and encrypted reads. There is no automatic key-rotation mechanism. Secrets and database backups must be retained together to restore encrypted data.

To experiment with SQLite, install `sqlite3` separately, set `DB_DIALECT=sqlite` and `DB_STORAGE`, and use a fresh metadata file. The repository checks here did not exercise SQLite/native bindings or cross-dialect behavior.

## TypeScript SDK

The supported Node.js/TypeScript package is [@bucket-storage/sdk](../packages/sdk/README.md). It handles request signing, typed operations, streaming uploads/downloads, multipart calls, and structured errors. Requires Node.js 22+ and no runtime dependencies on Nest/Sequelize.

The package is configured for public npm releases under the `bucket-storage` organization, with an SDK-local MIT license. After a version is published, consumers install it directly with `npm install @bucket-storage/sdk`; no repository download is needed. The [publishing guide](../packages/sdk/README.md#publishing) covers manual authentication and the prepared GitHub Actions/OIDC release workflow. A package directory by itself does not publish to npm or GitHub Packages.

From the repository root, build and pack it:

```bash
npm run build:sdk
npm pack ./packages/sdk
```

Install the generated tarball in a consumer with `npm install /absolute/path/to/bucket-storage-sdk-0.1.0.tgz`. After saving credentials from bootstrap, use:

```typescript
import { ObjectStorageClient } from '@bucket-storage/sdk';

const storage = new ObjectStorageClient({
  endpoint: 'http://localhost:4000',
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  secretKey: process.env.OSS_SECRET_KEY,
});

await storage.objects.put({
  bucket: 'demo-assets',
  key: 'sdk/hello.json',
  body: Buffer.from('{"message":"hello"}'),
  contentType: 'application/json',
});
const result = await storage.objects.get({ bucket: 'demo-assets', key: 'sdk/hello.json' });
for await (const chunk of result.body) process.stdout.write(chunk);
```

The client uses one transport attempt per operation and rejects redirects. There is no automatic mutation retry, background multipart cleanup, or automatic pagination. Callers choose cancellation using AbortSignal and must consume/destroy downloaded streams. Server limitations such as multipart encryption bypass and encrypted-copy behavior still apply. The following plain JavaScript helper remains a reference implementation for raw HTTP examples; the package guide contains the full SDK method inventory and recovery guidance.

## Signed request client

Use this small Node client for the examples. It calculates the repository's custom HMAC for each exact method/path/query. Save the following as **`/tmp/oss-client.cjs`**. This is a documentation example, not a change to the application or its existing smoke script.

```javascript
const { createHmac } = require('node:crypto');
const { readFile } = require('node:fs/promises');

async function request(method, target, options = {}) {
  const base = process.env.OSS_BASE_URL || 'http://localhost:4000';
  const url = new URL(target, base);
  const headers = Object.fromEntries(
    Object.entries(options.headers || {}).map(([name, value]) => [
      name.toLowerCase(),
      String(value),
    ]),
  );
  headers.host = url.host;

  let payload = options.raw;
  if (options.json !== undefined) {
    payload = JSON.stringify(options.json);
    headers['content-type'] = 'application/json';
  }

  if (!options.unsigned) {
    const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
    const secretKey = process.env.OSS_SECRET_KEY;
    if (!accessKeyId || !secretKey) {
      throw new Error('Export OSS_ACCESS_KEY_ID and OSS_SECRET_KEY first');
    }
    const query = Object.fromEntries(url.searchParams.entries());
    const signedHeaders = ['host'];
    const canonicalQuery = Object.keys(query)
      .sort()
      .map((key) => `${key}=${query[key]}`)
      .join('&');
    const canonicalHeaders = signedHeaders
      .slice()
      .sort()
      .map((name) => `${name}:${(headers[name] || '').trim()}`)
      .join('\n');
    const canonical = [
      method.toUpperCase(),
      url.pathname,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders.slice().sort().join(';'),
    ].join('\n');
    const signature = createHmac('sha256', secretKey).update(canonical).digest('hex');
    headers.authorization =
      `OSS-HMAC-SHA256 Credential=${accessKeyId}, ` +
      `SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;
  }

  const response = await fetch(url, {
    method: method.toUpperCase(),
    headers,
    body: payload,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || '';
  const body =
    bytes.length && contentType.includes('application/json')
      ? JSON.parse(bytes.toString('utf8'))
      : bytes;
  if (!response.ok) {
    const detail = Buffer.isBuffer(body) ? body.toString('utf8') : JSON.stringify(body);
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }
  return { status: response.status, headers: response.headers, body };
}

module.exports = { request };

if (require.main === module) {
  (async () => {
    const [method, target, input, contentType] = process.argv.slice(2);
    if (!method || !target) {
      throw new Error('Usage: node oss-client.cjs METHOD PATH [JSON or @FILE] [CONTENT_TYPE]');
    }
    const options = {};
    if (method.toUpperCase() === 'POST' && target === '/auth/keys') {
      options.unsigned = true;
    }
    if (input !== undefined) {
      if (input.startsWith('@')) {
        options.raw = await readFile(input.slice(1));
        options.headers = { 'content-type': contentType || 'application/octet-stream' };
      } else {
        options.json = JSON.parse(input);
      }
    } else if (contentType) {
      options.headers = { 'content-type': contentType };
    }
    const result = await request(method, target, options);
    console.error(`HTTP ${result.status}`);
    if (method.toUpperCase() === 'HEAD') {
      console.log(JSON.stringify(Object.fromEntries(result.headers), null, 2));
    } else if (Buffer.isBuffer(result.body)) {
      process.stdout.write(result.body);
    } else {
      console.log(JSON.stringify(result.body, null, 2));
    }
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
```

The helper buffers requests/files/responses for simple demonstration. It is not a streaming large-file client. Use one value per query key; repeated query keys, complex Unicode/URI normalization, redirects to other paths, and nested query objects are outside this example. It signs `host` like the repository's existing smoke script and leaves body/other headers unsigned, matching current server capability.

For programmatic use, `require('/tmp/oss-client.cjs').request` returns `{ status, headers, body }`. `body` is parsed JSON when response Content-Type is JSON, otherwise a Buffer. The helper throws on non-2xx responses. If you upload raw JSON bytes as octet-stream, they download as a Buffer; if metadata is later changed to a JSON type, this example helper would parse a JSON response based on that type.

## Create credentials and a bucket

Set the server origin for the client. This helper does not read the app's `.env` automatically.

```bash
export OSS_BASE_URL=http://localhost:4000
node /tmp/oss-client.cjs POST /auth/keys '{"ownerId":"demo-owner"}'
```

The server returns a new accessKeyId and secretKey. Save the actual response values; the secret cannot be retrieved again. Set them in your current shell:

```bash
export OSS_ACCESS_KEY_ID='paste-returned-access-key-id'
export OSS_SECRET_KEY='paste-returned-secret-key'
```

Create a fresh bucket and list your buckets:

```bash
node /tmp/oss-client.cjs PUT /demo-assets '{"region":"us-east-1"}'
node /tmp/oss-client.cjs GET /
```

Creation returns a complete bucket row with UUID, owner, region, timestamps, default DISABLED versioning, and nullable configuration fields. Creation is not an idempotent success: reusing an existing name yields 409. Names are global across owners and must be 3–63 lowercase letters/digits/hyphens, start/end alphanumeric. Avoid `docs`, `docs-json`, and `docs-yaml`, which overlap documentation resources.

Keep one owner identity for a walkthrough. Calling bootstrap again for the same owner creates another credential for that owner rather than a new bucket namespace. The open bootstrap route does not prove control of an owner ID; deployments that need verified identity must supply that integration.

## Upload, read, inspect, and list objects

Create a small file with exactly five bytes, upload it, inspect headers, and download:

```bash
printf hello > /tmp/oss-hello.txt
node /tmp/oss-client.cjs PUT /demo-assets/public/hello.txt @/tmp/oss-hello.txt text/plain
node /tmp/oss-client.cjs HEAD /demo-assets/public/hello.txt
node /tmp/oss-client.cjs GET /demo-assets/public/hello.txt > /tmp/oss-downloaded.txt
cmp /tmp/oss-hello.txt /tmp/oss-downloaded.txt
```

PUT returns key, MD5 etag (`5d41402abc4b2a76b9719d911017c592` for `hello`), public version ID, and size 5. Save the version ID for later historical reads. HEAD returns Content-Length, Content-Type, ETag, and x-amz-version-id; it does not emit user metadata headers. Object bytes do not live in a readable `public/hello.txt` directory on disk: the server generates an opaque pointer and shards files below the configured root.

List objects and simulate a folder view:

```bash
node /tmp/oss-client.cjs GET /demo-assets
node /tmp/oss-client.cjs GET '/demo-assets?prefix=public%2F'
node /tmp/oss-client.cjs GET '/demo-assets?prefix=public%2F&delimiter=%2F'
```

List results contain `contents`, `commonPrefixes`, and `isTruncated`, with `nextMarker` only when truncated. Default page size is 1000 raw object rows. If truncated, URL-encode and resubmit nextMarker as `marker` with the same filters. Grouping occurs after pagination, so a page may contain fewer visible entries than raw rows. Avoid `maxKeys` over HTTP in this implementation: raw query strings are not converted before the service's numeric limit calculation. `%` and `_` in prefix are SQL wildcards rather than safely escaped literal characters.

For an unencrypted range read, use the helper programmatically:

```bash
node <<'NODE'
const { request } = require('/tmp/oss-client.cjs');
(async () => {
  const result = await request('GET', '/demo-assets/public/hello.txt', {
    headers: { range: 'bytes=0-1' },
  });
  console.log(result.status, result.body.toString('utf8'));
})().catch((error) => { console.error(error); process.exitCode = 1; });
NODE
```

Expected here: status 206, body `he`. Range support is limited to numeric start/end syntax, with no complete 416/multiple/suffix handling. There is no Content-Range header. Encrypted objects return full plaintext even when controller chooses 206; use complete reads for them.

### Copy an object

For a plain source, set the copy-source header and use the destination path:

```bash
node <<'NODE'
const { request } = require('/tmp/oss-client.cjs');
(async () => {
  const result = await request('PUT', '/demo-assets/public/copied.txt', {
    headers: { 'x-amz-copy-source': '/demo-assets/public/hello.txt' },
  });
  console.log(result.body);
})().catch((error) => { console.error(error); process.exitCode = 1; });
NODE
```

The caller needs source GetObject and destination PutObject permissions. Copy creates a new destination version, preserves content type/user metadata, and omits tags. For an encrypted source use download then ordinary upload: direct server copy reads stored ciphertext and does not preserve plaintext semantics.

## Versions, deletion, and recovery

Enable delete-marker behavior before experimenting with deletion:

```bash
node /tmp/oss-client.cjs PUT '/demo-assets?versioning=' '{"status":"ENABLED"}'
printf 'hello again' > /tmp/oss-hello-v2.txt
node /tmp/oss-client.cjs PUT /demo-assets/public/hello.txt @/tmp/oss-hello-v2.txt text/plain
node /tmp/oss-client.cjs GET '/demo-assets?versions=&prefix=public%2Fhello.txt'
```

Version listing returns all versions and markers, newest first within each key, with `isLatest`/`isDeleteMarker`. It is unpaginated. Use the public `versionId` from these entries, not a database UUID from an internal latest-pointer column. All writes retain version rows even when status is DISABLED/SUSPENDED; enabling versioning primarily changes bare DELETE behavior.

Read a particular historical version, replacing the placeholder with an actual non-marker ID:

```bash
node /tmp/oss-client.cjs GET '/demo-assets/public/hello.txt?versionId=PASTE_PUBLIC_VERSION_ID'
```

Create a marker, then inspect history:

```bash
node /tmp/oss-client.cjs DELETE /demo-assets/public/hello.txt
node /tmp/oss-client.cjs GET '/demo-assets?versions=&prefix=public%2Fhello.txt'
```

Latest GET/HEAD now returns 404 and ordinary object listing hides the key. A GET with an older non-marker versionId still works. To restore the previous latest, delete the marker using the marker's public version ID:

```bash
node /tmp/oss-client.cjs DELETE '/demo-assets/public/hello.txt?versionId=PASTE_MARKER_VERSION_ID'
```

Explicit deletion is permanent for that version/marker. Its response reports `deleteMarker: false` even when the removed row was a marker. The server recalculates latest from remaining creation timestamps.

`PUT ?versioning=` with `{"status":"SUSPENDED"}` changes subsequent bare DELETE to destroy all version rows, rather than insert a marker. That path deletes only the latest blob, potentially leaving historical byte files orphaned. Keep the demo bucket for the remaining examples; perform the following optional cleanup only after finishing the walkthrough. To remove a versioned bucket cleanly through current APIs, enumerate all versions and delete **each explicit version ID**, including markers, before deleting the bucket. Keep versioning enabled while doing that cleanup; there is no bulk-delete endpoint.

```bash
node /tmp/oss-client.cjs DELETE /demo-assets
```

The last command succeeds only after every object row has gone; otherwise 409 BucketNotEmpty. It does not recursively delete contents. A missing object or missing multipart upload returns 404, while revoking a nonexistent access key is a no-op.

## Tags and metadata

User metadata is supplied **on upload**, using `x-amz-meta-*`, and appears in object/version listings. It is separate from object tags. There is no metadata-only PATCH operation.

```bash
node <<'NODE'
const { request } = require('/tmp/oss-client.cjs');
(async () => {
  const result = await request('PUT', '/demo-assets/public/metadata.txt', {
    raw: Buffer.from('metadata example'),
    headers: { 'content-type': 'text/plain', 'x-amz-meta-project': 'demo' },
  });
  console.log(result.body);
})().catch((error) => { console.error(error); process.exitCode = 1; });
NODE
node /tmp/oss-client.cjs POST '/demo-assets/public/metadata.txt?tagging=' '{"tags":{"team":"demo","retention":"standard"}}'
node /tmp/oss-client.cjs GET '/demo-assets/public/metadata.txt?tagging='
```

Setting tags replaces the whole map; `{"tags":{}}` clears it. Tag operations always select latest non-marker and ignore versionId. GET tagging returns `{ tags: {...} }`; POST tagging returns `{}` with HTTP 201. An object with tags can have completely different metadata. Copy/replication do not preserve tags.

## Share access with policies

Owners can replace a bucket's entire statement set:

```bash
node /tmp/oss-client.cjs PUT '/demo-assets?policy=' '{"statements":[{"principal":"reader-owner","action":"GetObject","resourcePattern":"demo-assets/public/*","effect":"ALLOW"}]}'
node /tmp/oss-client.cjs GET '/demo-assets?policy='
```

The reader must create/sign with a key for `reader-owner`. Use a separate shell for those credentials to avoid accidentally changing the walkthrough owner. GET policy returns full policy rows as an array, rather than a statements wrapper. `{"statements":[]}` clears all policies.

Policies match exact owner IDs, exact action strings or `*`, and resource patterns using `*`. Relevant actions are GetObject, PutObject, DeleteObject, GetObjectTagging, and PutObjectTagging. A wildcard principal still needs a signed request. Matching DENY overrides ALLOW for nonowners; owners/root always bypass policy statements. Policy replacement removes existing rows before insertion, without rollback preservation on failure.

Current bucket config reads except policy, ordinary object listings, and version listings require authentication but do **not** check bucket ownership or a listing policy. Bucket mutations/policy reads enforce ownership. Take this distinction into account when deciding who can reach an instance: object read policy and listing visibility are separate behaviors in current code.

## Temporary links

Generate a link for an existing readable object:

```bash
node /tmp/oss-client.cjs GET '/demo-assets/public/metadata.txt?presign=GET&expiresIn=900'
```

Response is `{ url: '/demo-assets/public/metadata.txt?...' }`. To generate and fetch a link without manually copying it, use:

```bash
node <<'NODE'
const { request } = require('/tmp/oss-client.cjs');
(async () => {
  const generated = await request('GET', '/demo-assets/public/metadata.txt?presign=GET&expiresIn=900');
  const base = process.env.OSS_BASE_URL || 'http://localhost:4000';
  const response = await fetch(new URL(generated.body.url, base));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  process.stdout.write(Buffer.from(await response.arrayBuffer()));
})().catch((error) => { console.error(error); process.exitCode = 1; });
NODE
```

For a recipient using curl/browser, prepend OSS_BASE_URL to the returned relative URL and preserve its `?method=...&expires=...&ownerId=...&accessKeyId=...&signature=...` query exactly. No Authorization header is needed for the link request. Do not append filters, reorder parameters, or change the encoded values. The link embeds identity and is authorized against current object policy on use.

Generate `presign=PUT` to upload raw bytes to a path, including a new key. PUT-link generation checks PutObject permission; GET links check GetObject. The actual request method must equal the signed method, so HEAD cannot reuse a GET link. JSON object PUT is supported. Existing links still do not consult access-key revocation. Server expiry defaults to 3600 for absent/zero/nonnumeric input with no maximum bound; the SDK additionally requires a positive finite lifetime when supplied.

## Multipart uploads

Multipart is a staged workflow on the same object path, not a separate multipart/form-data request. Keep bucket/key/upload ID consistent and send raw bytes for each part. At completion, all submitted parts except last must be at least **5 MiB**. Save each returned etag exactly.

The following self-contained example uploads 6 MiB plus 1 MiB to `large.bin`, lists parts, completes, and inspects the final size. It buffers data in the example client; it demonstrates protocol rather than memory-efficient large-file streaming.

```bash
node <<'NODE'
const { request } = require('/tmp/oss-client.cjs');
(async () => {
  const path = '/demo-assets/large.bin';
  const initiated = await request('POST', `${path}?uploads=`);
  const uploadId = initiated.body.uploadId;
  const query = `uploadId=${encodeURIComponent(uploadId)}`;
  let completed = false;
  try {
    const first = await request('PUT', `${path}?${query}&partNumber=1`, {
      raw: Buffer.alloc(6 * 1024 * 1024, 'a'),
      headers: { 'content-type': 'application/octet-stream' },
    });
    const second = await request('PUT', `${path}?${query}&partNumber=2`, {
      raw: Buffer.alloc(1024 * 1024, 'b'),
      headers: { 'content-type': 'application/octet-stream' },
    });
    console.log('Stored parts:', (await request('GET', `${path}?${query}`)).body);
    const result = await request('POST', `${path}?${query}`, {
      json: { parts: [
        { partNumber: 1, etag: first.body.etag },
        { partNumber: 2, etag: second.body.etag },
      ] },
    });
    completed = true;
    console.log('Completed:', result.body);
    const metadata = await request('HEAD', path);
    console.log('Final bytes:', metadata.headers.get('content-length'));
  } catch (error) {
    console.error('Inspect object state if completion may have partially succeeded');
    throw error;
  } finally {
    if (!completed) {
      await request('DELETE', `${path}?${query}`).catch((error) => {
        console.error('Abort result:', error.message);
      });
    }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
NODE
```

Expected final length: **7,340,032 bytes**. Completion responds 201 with the usual key/etag/versionId/size. Its etag is a single MD5 of concatenated bytes. Send part descriptors once each in ascending order; server checks count and etags but does not enforce uniqueness/ordering. Completion removes session/parts, so a repeated completion normally yields NoSuchUpload.

To inspect or abort an unfinished session manually:

```bash
node /tmp/oss-client.cjs GET '/demo-assets/large.bin?uploadId=PASTE_UPLOAD_ID'
node /tmp/oss-client.cjs DELETE '/demo-assets/large.bin?uploadId=PASTE_UPLOAD_ID'
```

List-parts returns internal row IDs/pointers as well as number/etag/size; use public uploadId for subsequent requests. An aborted session cannot be resumed. There is no automatic cleanup of abandoned sessions.

Current multipart limits affect recovery and deployment decisions:

- Sequential replacement now stages a new pointer before metadata publication and old-byte cleanup. Failed staging attempts preserve the prior part where metadata did not save; old cleanup can still fail after replacement succeeds. Concurrent replacement is not serialized. The SDK does not automatically retry mutations; inspect listed parts and object state before a manual retry.
- Completion bypasses bucket default encryption. Do not rely on bucket encryption for multipart payloads in this version.
- Completion/cleanup is not atomic. An error can occur after final object creation; check version state before replaying.
- Upload IDs are looked up independently of the authorized path's bucket/key. Keep them private and never deliberately substitute another upload's ID.

## Encryption, retention, and CORS

### Bucket encryption

Configure future ordinary uploads:

```bash
node /tmp/oss-client.cjs PUT '/demo-assets?encryption=' '{"algorithm":"SSE_S3"}'
node /tmp/oss-client.cjs GET '/demo-assets?encryption='
```

Then ordinary PUT/GET remains the same to the caller. The service encrypts whole payloads using AES-256-GCM with per-object random keys, wrapped under the configured master secret. The recorded size/checksum describe plaintext. Existing objects are unchanged, large encrypted uploads/downloads buffer in memory, and range reads are full reads. SSE_KMS accepts an optional key label but uses the same local implementation; it does not contact a KMS. There is no dedicated supported disable/reset route or key rotation workflow.

### Retention and storage labels

Configure rules as a bare array, then read them back:

```bash
node /tmp/oss-client.cjs PUT '/demo-assets?lifecycle=' '[{"id":"public-retention","prefix":"public/","transitionAfterDays":30,"targetStorageClass":"INFREQUENT_ACCESS","expireAfterDays":365}]'
node /tmp/oss-client.cjs GET '/demo-assets?lifecycle='
```

The daily 02:00 sweep uses the server process timezone, not the client/browser timezone. It evaluates latest non-marker version age in fractional days. Expiry wins over transition within a rule. Transitions change metadata only; ARCHIVE does not require a restore operation. Historical versions are not automatically expired. Expiration currently fails to repoint latest when older versions remain, so use retention carefully with retained history and inspect the architecture's [lifecycle trace](ARCHITECTURE.md#lifecycle).

To remove effective rules:

```bash
node /tmp/oss-client.cjs PUT '/demo-assets?lifecycle=' '[]'
```

No HTTP route manually triggers the sweep. Multiple API replicas each schedule their own sweep; there is no leader election.

### Stored CORS settings

```bash
node /tmp/oss-client.cjs PUT '/demo-assets?cors=' '[{"allowedOrigins":["http://localhost:5173"],"allowedMethods":["GET","PUT","HEAD"],"allowedHeaders":["authorization","content-type"]}]'
node /tmp/oss-client.cjs GET '/demo-assets?cors='
```

These settings are stored and returned, but not enforced. Global `enableCors()` determines actual browser behavior. Empty array clears stored settings. If browser JavaScript needs response headers beyond those exposed by global middleware, there is no implemented bucket exposeHeaders setting to rely on.

## Use an upstream S3-compatible byte store

Create/provision the upstream bucket independently, then set the server environment:

```dotenv
STORAGE_ADAPTER=s3
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=object-storage-blobs
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=replace-with-upstream-access-key
S3_SECRET_ACCESS_KEY=replace-with-upstream-secret
```

For AWS-style endpoint selection, omit S3_ENDPOINT; configure the actual region/bucket/credentials or available default SDK credentials. Restart the server. Continue using the product's generated keys and custom signer at its own URL: upstream credentials belong to the adapter, not the public API.

All application buckets share the single upstream byte bucket, with opaque pointers as object keys. The adapter buffers each write and concatenated upload in process memory; it does not use upstream multipart-copy concatenation or send metadata storage classes upstream. This documentation task did not test a live upstream endpoint.

Changing STORAGE_ADAPTER or local root does not migrate old payloads. Existing database pointers will be read from the newly selected backend, where they may not exist. Preserve/copy bytes with matching pointers as part of a separately planned migration rather than assuming the setting moves them.

## Operator-only notification and replication setup

These features have model/service implementations but no public configuration endpoint. The following are optional **manual operator examples**, not steps executed by this guide or required for basic use. Use an authorized DB connection and known bucket names; a metadata edit bypasses API ownership checks and is not an audited API mutation.

### Webhooks

Provision a listener and insert a synthetic configuration row, replacing the URL with a reachable receiver:

```sql
INSERT INTO notification_configs
  (id, "bucketName", events, "webhookUrl", "createdAt", "updatedAt")
VALUES
  ('99999999-9999-4999-8999-111111111111', 'demo-assets',
   '["ObjectCreated","ObjectRemoved"]'::json,
   'http://localhost:8080/object-events', NOW(), NOW());
```

Normal writes/removals emit events. The receiver gets a JSON POST such as:

```json
{
  "type": "ObjectCreated",
  "bucketName": "demo-assets",
  "key": "public/hello.txt",
  "versionId": "33333333-3333-4333-8333-333333333333",
  "size": 5
}
```

Removal events omit size. The server sends no webhook signature/event ID. Network exceptions retry up to three attempts, with 1s and 2s waits; HTTP 500/404 responses are currently considered delivered because response.ok is not checked. There is no durable delivery queue, timeout setting, or replay endpoint. Lifecycle expiration does not publish removal events.

### Replication

First create a destination bucket through the normal API, then set the source's target:

```bash
node /tmp/oss-client.cjs PUT /demo-replica '{"region":"us-east-1"}'
```

```sql
UPDATE buckets
SET "replicationTarget" = 'demo-replica', "updatedAt" = NOW()
WHERE name = 'demo-assets';
```

Subsequent ObjectCreated events copy the specific source version's stream to a new destination version, preserving content type/user metadata. No backfill occurs; deletes and tags do not replicate. Destination normal upload encryption applies. Delivery is in-process and failure logs do not trigger a retry. Configure no self-target or cycle: destination writes generate new creation events and there is no loop guard.

Disable future replication by setting target to SQL NULL. Neither this DB setting nor events provide a complete disaster-recovery system or ownership-enforcing replication policy.

## Operate and troubleshoot

### Existing smoke script

[scripts/smoke-test.js](../scripts/smoke-test.js) demonstrates signing and common API flows, including two-part completion. It is a mutating demonstration that prints responses, not an assertion suite, and hardcodes `http://localhost:3000`, host `localhost:3000`, owner `afzal`, and bucket `my-test-bucket`. A second run can conflict with existing state, and it leaves data/credentials behind.

If you deliberately use it in a disposable environment, start the app with an overriding port in one terminal and run the script in another:

```bash
PORT=3000 npm run start:prod
```

```bash
node scripts/smoke-test.js
```

This documentation task did not run that mutating script or create product data.

### Inspect outcomes

Errors caught before streaming have `{ error: { code, message, requestId? } }`; use request ID where present to correlate application/audit data. Guard rejections can omit it. Mutation audit rows are written asynchronously and are not proof that a streamed transfer finished. There is no audit-query endpoint. An operator can inspect recent rows through SQL:

```sql
SELECT actor, action, resource, result, "requestId", "createdAt"
FROM audit_logs
ORDER BY "createdAt" DESC
LIMIT 50;
```

The global limiter starts at 100 requests and refills 20 per second per effective key; due to guard ordering that is normally IP, and state is per process. On 429, slow/retry later. The exposed code is TOO_MANY_REQUESTS, not the guard's internal SlowDown string.

| Symptom                                           | What to inspect/do                                                                                                                                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database connection/startup failure               | Check server availability, DB name, port, role/password, and schema privileges; database must already exist.                                                                                                                             |
| Client connection refused                         | Confirm process is running and align OSS_BASE_URL with PORT; copied example uses 4000, old smoke script 3000.                                                                                                                            |
| SignatureDoesNotMatch                             | Use the exact method/path/query/host; decoded query values and sort rules must match. Check active credentials and unchanged master key. Signing a different path in Swagger will fail.                                                  |
| JSON upload is changed or parsed by the client    | Server PUT preserves JSON bytes. The demo helper parses downloaded JSON by MIME; use SDK objects.get and consume its raw Node Readable when byte-for-byte JSON retrieval matters.                                                        |
| Object 404 after delete                           | Latest may be marker. Inspect versions; read a historical ID or delete marker explicitly to restore.                                                                                                                                     |
| Object 404/omitted after lifecycle expiry         | Latest pointer may still reference an expired version while history remains. Inspect versions and use explicit historical reads; no automatic repair endpoint exists.                                                                    |
| BucketNotEmpty but ordinary listing looks empty   | Inspect all versions/delete markers; hidden parent rows still count. Delete each public version ID.                                                                                                                                      |
| maxKeys causes 500 or unexpected page             | Omit it; runtime query-to-number conversion is missing. Use default limit plus marker.                                                                                                                                                   |
| Multipart InvalidPart                             | Submit all parts, once each, with exact etags and ascending numbers; non-last parts need 5 MiB.                                                                                                                                          |
| Multipart concatenate cannot find a file          | Inspect part rows, storage configuration, and prior failures. Sequential same-number replacement no longer deletes its new blob; data written by the older bug may need upload restart. Inspect object state if completion may have run. |
| Presigned URL invalid after handling              | Preserve exact returned query/order; prepend correct origin; check expiry and presign secret. Revocation alone does not expire links.                                                                                                    |
| Range returns entire encrypted file with 206      | Implemented whole-object decryption ignores range. Use full GET.                                                                                                                                                                         |
| Copy of encrypted object is unreadable            | Server copy reads ciphertext. Download plaintext and upload instead.                                                                                                                                                                     |
| Configured CORS/archive/KMS behavior seems absent | CORS and class transitions are stored metadata; KMS is locally simulated. Read their actual semantics above.                                                                                                                             |
| Webhook missing or HTTP 500 not retried           | Check configured bucket/event types/reachable URL. Only thrown fetch errors retry; in-memory work is lost on restart.                                                                                                                    |
| Duplicate lifecycle/replication work              | Tasks/listeners run per API instance with no shared locks/deduplication; replication cycles are unguarded.                                                                                                                               |

### Data and credential lifecycle

Retain PostgreSQL metadata, active blob backend contents, and the encryption master secret together. Metadata alone cannot reconstruct payload bytes; payloads alone do not contain owner/key/version mappings. A database dump includes encrypted access-key material and wrapped data-key references. There is no coordinated backup/quiescing script, restore verification command, orphan-byte garbage collector, or migration runner here.

Revoke an unused API key with another active credential of the same owner:

```bash
node /tmp/oss-client.cjs DELETE /auth/keys/PASTE_ACCESS_KEY_TO_REVOKE
```

There is no owner delete, account recovery, or key-list route. Revoke the walkthrough's current key only after any intended bucket/object cleanup; you will need another active key to continue signed requests. Presigned links persist until their own expiry/global-secret change and current policy checks.

## Documentation validation

Checks run for the SDK and server changes:

| Check                                           | Result                                                                                                                                                                                                                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build` and `npm run typecheck`         | Passed for server source.                                                                                                                                                                                                                                                         |
| `npm run build:sdk` and `npm run typecheck:sdk` | Passed for the independent SDK package.                                                                                                                                                                                                                                           |
| `npm run test:sdk`                              | 35 tests passed across four explicitly named Jest specs with --runInBand. Includes live loopback HTTP, in-memory metadata fixtures, and actual temporary local storage; no PostgreSQL/S3 needed. Sandbox initially denied the listener with EPERM, then the permitted run passed. |
| `npm run lint`                                  | Existing ESLint command is unavailable: executable/dependency/configuration absent. No source changes were made by lint.                                                                                                                                                          |
| Full Jest suite                                 | Not run; only the four relevant paths were selected.                                                                                                                                                                                                                              |

Tests cover complex-key signing, raw JSON uploads and control parsing, streaming/cancellation option forwarding, nonretrying HTTP/network failures, redirect rejection, part replacement/failure cleanup, and presigned method checks through the guard. Download streams remain unbuffered in the SDK. The full AppModule with a live PostgreSQL database, upstream S3, webhook delivery, and the mutating smoke script were not exercised.

The SDK was packed and installed offline into an isolated consumer directory. CommonJS require, ESM named imports, strict TypeScript consumer compilation against the packed declarations, structured errors, and one-attempt mutation behavior passed. Package contents contain only README/package metadata and the compiled SDK/declarations/maps; no server classes or runtime package dependencies are included.

The files are formatted and local links/anchors, JSON examples, and contract TypeScript shapes are checked. All eight Mermaid diagrams passed parsing and SVG rendering with Mermaid 9.2.2 in temporary headless Chrome during the persistence-diagram follow-up. The persistence diagram was also visually inspected. Unique-key attributes use quoted comments because this version supports PK/FK markers but not UK. Validation dependencies were installed only in a temporary directory; repository dependencies are unchanged. A baseline of all three existing guides was saved before updating; unrelated query/state/error details remain. These checks did not publish an npm release; committing and pushing repository changes are separate from registry publication.
