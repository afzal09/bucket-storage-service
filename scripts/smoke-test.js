const crypto = require('crypto');

const BASE = 'http://localhost:3000';

function canonicalRequest(method, path, query, headers, signedHeaders) {
  const sortedQuery = Object.keys(query).sort().map((k) => `${k}=${query[k]}`).join('&');
  const canonicalHeaders = signedHeaders.slice().sort().map((h) => `${h}:${(headers[h] || '').trim()}`).join('\n');
  return [method.toUpperCase(), path, sortedQuery, canonicalHeaders, signedHeaders.slice().sort().join(';')].join('\n');
}

function sign(method, path, query, headers, signedHeaders, secretKey) {
  const cr = canonicalRequest(method, path, query, headers, signedHeaders);
  return crypto.createHmac('sha256', secretKey).update(cr).digest('hex');
}

async function req(method, path, { query = {}, headers = {}, body, accessKeyId, secretKey, raw } = {}) {
  const signedHeaders = ['host'];
  const allHeaders = { host: 'localhost:3000', ...headers };

  let finalBody;
  if (raw !== undefined) {
    finalBody = raw;
  } else if (body !== undefined) {
    finalBody = JSON.stringify(body);
    allHeaders['content-type'] = 'application/json';
  }

  if (accessKeyId && secretKey) {
    const signature = sign(method, path, query, allHeaders, signedHeaders, secretKey);
    allHeaders['authorization'] = `OSS-HMAC-SHA256 Credential=${accessKeyId}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;
  }

  const qs = new URLSearchParams(query).toString();
  const url = `${BASE}${path}${qs ? '?' + qs : ''}`;
  const res = await fetch(url, { method, headers: allHeaders, body: finalBody });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

async function main() {
  console.log('--- 1. Bootstrap access key ---');
  let r = await req('POST', '/auth/keys', { body: { ownerId: 'afzal' } });
  console.log(r.status, r.body);
  const { accessKeyId, secretKey } = r.body;

  console.log('\n--- 2. Create bucket ---');
  r = await req('PUT', '/my-test-bucket', { body: { region: 'us-east-1' }, accessKeyId, secretKey });
  console.log(r.status, r.body);

  console.log('\n--- 3. List buckets ---');
  r = await req('GET', '/', { accessKeyId, secretKey });
  console.log(r.status, r.body);

  console.log('\n--- 4. PUT object (plain text body) ---');
  r = await req('PUT', '/my-test-bucket/hello.txt', {
    raw: 'Hello, object storage!',
    headers: { 'content-type': 'text/plain' },
    accessKeyId,
    secretKey,
  });
  console.log(r.status, r.body);

  console.log('\n--- 5. GET object ---');
  r = await req('GET', '/my-test-bucket/hello.txt', { accessKeyId, secretKey });
  console.log(r.status, r.body);

  console.log('\n--- 6. HEAD object ---');
  r = await req('HEAD', '/my-test-bucket/hello.txt', { accessKeyId, secretKey });
  console.log(r.status, [...r.headers.entries()]);

  console.log('\n--- 7. List objects ---');
  r = await req('GET', '/my-test-bucket', { accessKeyId, secretKey });
  console.log(r.status, r.body);

  console.log('\n--- 8. Enable versioning ---');
  r = await req('PUT', '/my-test-bucket', { query: { versioning: '' }, body: { status: 'ENABLED' }, accessKeyId, secretKey });
  console.log(r.status, r.body);

  console.log('\n--- 9. Overwrite object (creates v2) ---');
  r = await req('PUT', '/my-test-bucket/hello.txt', {
    raw: 'Hello again, v2!',
    headers: { 'content-type': 'text/plain' },
    accessKeyId,
    secretKey,
  });
  console.log(r.status, r.body);

  console.log('\n--- 10. List object versions ---');
  r = await req('GET', '/my-test-bucket', { query: { versions: '' }, accessKeyId, secretKey });
  console.log(r.status, JSON.stringify(r.body, null, 2));

  console.log('\n--- 11. Delete object (soft delete marker expected) ---');
  r = await req('DELETE', '/my-test-bucket/hello.txt', { accessKeyId, secretKey });
  console.log(r.status, r.body);

  console.log('\n--- 12. GET after delete (should 404) ---');
  r = await req('GET', '/my-test-bucket/hello.txt', { accessKeyId, secretKey });
  console.log(r.status, r.body);

  console.log('\n--- 13. Set bucket policy for cross-account read ---');
  r = await req('PUT', '/my-test-bucket', {
    query: { policy: '' },
    body: { statements: [{ principal: 'other-owner', action: 'GetObject', effect: 'ALLOW' }] },
    accessKeyId,
    secretKey,
  });
  console.log(r.status, r.body);

  console.log('\n--- 14. Multipart: initiate ---');
  r = await req('POST', '/my-test-bucket/bigfile.bin', { query: { uploads: '' }, accessKeyId, secretKey });
  console.log(r.status, r.body);
  const uploadId = r.body.uploadId;

  console.log('\n--- 15. Multipart: upload part 1 (6MB) ---');
  const part1 = Buffer.alloc(6 * 1024 * 1024, 'a');
  r = await req('PUT', '/my-test-bucket/bigfile.bin', { query: { partNumber: '1', uploadId }, raw: part1, accessKeyId, secretKey });
  console.log(r.status, r.body);
  const etag1 = r.body.etag;

  console.log('\n--- 16. Multipart: upload part 2 (last, 1MB) ---');
  const part2 = Buffer.alloc(1 * 1024 * 1024, 'b');
  r = await req('PUT', '/my-test-bucket/bigfile.bin', { query: { partNumber: '2', uploadId }, raw: part2, accessKeyId, secretKey });
  console.log(r.status, r.body);
  const etag2 = r.body.etag;

  console.log('\n--- 17. Multipart: complete ---');
  r = await req('POST', '/my-test-bucket/bigfile.bin', {
    query: { uploadId },
    body: { parts: [{ partNumber: 1, etag: etag1 }, { partNumber: 2, etag: etag2 }] },
    accessKeyId,
    secretKey,
  });
  console.log(r.status, r.body);

  console.log('\n--- 18. HEAD the completed multipart object ---');
  r = await req('HEAD', '/my-test-bucket/bigfile.bin', { accessKeyId, secretKey });
  console.log(r.status, [...r.headers.entries()].filter(([k]) => k === 'content-length'));

  console.log('\n--- 19. Presigned URL ---');
  r = await req('GET', '/my-test-bucket/hello.txt', { query: { presign: 'GET', expiresIn: '3600' }, accessKeyId, secretKey });
  console.log(r.status, r.body);
}

main().catch((e) => { console.error(e); process.exit(1); });
