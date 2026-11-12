# Object Storage System

An S3-shaped object storage service built on NestJS + Sequelize, per the architecture
docs in Notion ("Object Storage System (NestJS)" — HLD/LLD).

## Stack

- **NestJS 12** + Express 5
- **Postgres** (via Sequelize/`@nestjs/sequelize`) for metadata — buckets, objects,
  versions, policies, access keys, audit logs
- **Local disk** for object bytes by default, with an `S3CompatibleStorageAdapter`
  you can switch to for a real durable backend (see `STORAGE_ADAPTER` below)
- **In-process events** (`@nestjs/event-emitter`) for notifications/replication, and
  **`@nestjs/schedule`** for the daily lifecycle sweep — used instead of BullMQ+Redis
  so this runs with zero extra infrastructure. See "Deviations from the LLD" below.

## Setup

```bash
npm install
cp .env.example .env   # edit DB credentials if needed
```

You need a Postgres database reachable with the credentials in `.env`:

```sql
CREATE DATABASE object_storage;
```

Then:

```bash
npm run build
npm run start        # or: npm run dev for watch mode
```

The app listens on `PORT` (default `3000`) and creates its own tables on boot
(`synchronize: true` — fine for dev, swap for real migrations before production).

The copied `.env.example` sets `PORT=4000`; use that port in examples unless you
override it. The fallback when PORT is absent is 3000.

## TypeScript SDK and detailed docs

Install published SDK releases directly from npm:

```bash
npm install @bucket-storage/sdk
```

Use the dependency-free Node.js SDK in [packages/sdk](packages/sdk/README.md) to
sign requests and stream uploads/downloads:

```bash
npm run build:sdk
npm pack ./packages/sdk
```

Install the generated tarball in a consumer with `npm install /path/to/bucket-storage-sdk-0.1.0.tgz`.
The SDK supports buckets/configuration, objects/versions/tags/copy, presigned URLs,
and multipart uploads. It performs no automatic retries and does not follow redirects.
Run its focused regression checks with `npm run test:sdk`.

- [Architecture and implementation reference](docs/ARCHITECTURE.md)
- [Product setup and usage guide](docs/USAGE-GUIDE.md)
- [Complete HTTP contract](docs/API-CONTRACT-SYNC.md)

Object routes use Express 5 named wildcards (`/:bucket/*key`); the signature guard
joins decoded wildcard segments into the full key. JSON object PUTs remain raw
streams. Multipart replacements stage new bytes before saving metadata/deleting
old bytes, and presigned URLs enforce their signed GET or PUT method.

## Authentication

There's no external IdP wired in — `POST /auth/keys` is a bootstrap endpoint that
hands back an access key pair for a given `ownerId`:

```bash
curl -X POST localhost:3000/auth/keys -H 'content-type: application/json' \
  -d '{"ownerId": "afzal"}'
# => { "accessKeyId": "AKIA...", "secretKey": "..." }
```

Every other request must be signed. The scheme is a simplified cousin of AWS SigV4:
HMAC-SHA256 over a canonical request string, using the secret key directly (see
`AuthService` for the exact canonicalization). Header shape:

```
Authorization: OSS-HMAC-SHA256 Credential=<accessKeyId>, SignedHeaders=host, Signature=<hex>
```

`scripts/smoke-test.js` contains a full working reference implementation of the
signing logic in plain Node — steal the `sign()`/`canonicalRequest()` functions for
your own client, or use it directly:

```bash
node dist/main.js &          # in one terminal
node scripts/smoke-test.js   # in another — exercises the whole API
```

## API surface

| Route                                     | Purpose                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `PUT /:bucket`                            | Create bucket, or configure it via `?policy` / `?versioning` / `?lifecycle` / `?encryption` / `?cors` |
| `GET /`                                   | List buckets                                                                                          |
| `GET /:bucket`                            | List objects, or read config via the same `?` subresources, or `?versions`                            |
| `DELETE /:bucket`                         | Delete bucket (must be empty)                                                                         |
| `PUT /:bucket/:key`                       | Upload object (or copy, via `x-amz-copy-source` header)                                               |
| `GET /:bucket/:key`                       | Download object (`Range` supported), or `?tagging` / `?presign=GET\|PUT`                              |
| `HEAD /:bucket/:key`                      | Object metadata only                                                                                  |
| `DELETE /:bucket/:key`                    | Delete (soft delete-marker if versioning is enabled)                                                  |
| `POST /:bucket/:key?uploads`              | Initiate multipart upload                                                                             |
| `PUT /:bucket/:key?partNumber=&uploadId=` | Upload a part                                                                                         |
| `POST /:bucket/:key?uploadId=`            | Complete multipart upload                                                                             |
| `DELETE /:bucket/:key?uploadId=`          | Abort multipart upload                                                                                |

## Configuration (`.env`)

| Var                                                                         | Purpose                                                                                                 |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `DB_DIALECT`, `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` | Postgres connection                                                                                     |
| `STORAGE_ADAPTER`                                                           | `local` (default) or `s3`                                                                               |
| `STORAGE_LOCAL_ROOT`                                                        | Where local-disk blobs live                                                                             |
| `S3_*`                                                                      | Only used when `STORAGE_ADAPTER=s3` — points at any S3-compatible endpoint (AWS, MinIO, etc.)           |
| `REQUEST_SIGNING_SECRET`                                                    | Unused placeholder — actual signing keys are per-access-key, generated at `/auth/keys`                  |
| `ENCRYPTION_MASTER_KEY`                                                     | Wraps per-object data keys for SSE_S3/SSE_KMS-style encryption. **Change this in any real deployment.** |
| `PRESIGNED_URL_SECRET`                                                      | Signs presigned URLs                                                                                    |

## Deviations from the reviewed LLD

A few things came up during implementation that the design doc didn't anticipate —
noted here rather than silently diverging:

1. **Subresource routing.** `?versioning`, `?policy`, `?lifecycle`, etc. can't be
   separate `@Put()` handlers on the same path — NestJS/Express route on method +
   path, not query string. Each verb has one handler that dispatches internally.
2. **HEAD requests.** Express resolves `HEAD` against whatever's registered for
   `GET` on the same route, so a separate `@Head()` handler on an identical path is
   silently unreachable. HEAD is now handled inside `getObject` by checking
   `req.method`.
3. **Multipart shares the object route space too.** `?uploads`/`?uploadId`/
   `?partNumber` collide with plain object CRUD for the same reason as (1), so
   `MultipartService` is called from `ObjectsController` rather than from its own
   controller.
4. **BucketsModule ⇄ ObjectsModule ⇄ MultipartModule form a real cycle** (bucket
   subresource routes need object-listing logic; object routes need multipart
   dispatch; multipart needs both). Resolved with `forwardRef()` on every edge in
   the cycle — see the module files for exactly which edges.
5. **Access key secrets are encrypted, not hashed.** The original sketch had
   `secretKeyHash`, but HMAC verification is symmetric — the server needs the raw
   secret back to recompute a client's signature, so a one-way hash can't work here
   the way a login password hash would. Stored via `EncryptionService` instead.
6. **BullMQ/Redis swapped for `@nestjs/event-emitter` + `@nestjs/schedule`.** Keeps
   the whole thing runnable with just Postgres — no Redis to stand up for a v1. The
   `EventPublisherService` interface is the seam if you want to swap in a real queue
   later.
7. **Encrypted objects are buffered, not streamed through a cipher.** AES-GCM's
   auth tag can't be verified against an arbitrary byte range, so `Range` reads are
   not honored on encrypted objects in this version — documented in
   `ObjectsService`.

## What's not here yet

- Real migrations (currently `sequelize.sync()` on boot)
- A second storage adapter tested against a live S3/MinIO endpoint (the code path
  exists in `S3CompatibleStorageAdapter` but wasn't exercised beyond a syntax check)
- Rate limiting, encryption, and policy evaluation are all functional but
  intentionally simple — read the inline comments before hardening for production
  traffic
