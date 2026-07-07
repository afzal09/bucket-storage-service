import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { createHmac, randomBytes } from 'crypto';
import { AccessKey } from './entities/access-key.entity';
import { EncryptionService } from '../access-control/encryption.service';
import { Principal } from '../common/interfaces/principal.interface';
import { SignatureInvalidException, AccessDeniedException } from '../common/exceptions/s3.exceptions';

export interface SignableRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
}

const AUTH_SCHEME = 'OSS-HMAC-SHA256';

/**
 * A deliberately simplified cousin of AWS SigV4: one HMAC pass over a
 * canonical request string, keyed directly by the account's secret, rather
 * than SigV4's derived per-date/per-region signing key. That extra
 * derivation step defends against secret-key compromise from a single
 * leaked signature; worth adding before this is exposed outside a trusted
 * network, but not required to prove the request-signing flow end to end.
 */
@Injectable()
export class AuthService {
  constructor(
    @InjectModel(AccessKey) private readonly accessKeyModel: typeof AccessKey,
    private readonly encryptionService: EncryptionService,
  ) {}

  async generateAccessKey(ownerId: string): Promise<{ accessKeyId: string; secretKey: string }> {
    const accessKeyId = `AKIA${randomBytes(8).toString('hex').toUpperCase()}`;
    const secretKey = randomBytes(24).toString('base64url');

    await this.accessKeyModel.create({
      ownerId,
      accessKeyId,
      secretKeyEncrypted: this.encryptionService.encryptWithMasterKey(secretKey),
      active: true,
    } as any);

    // secretKey is only ever returned here — like AWS, we never display it again.
    return { accessKeyId, secretKey };
  }

  async revokeAccessKey(accessKeyId: string, requester: Principal): Promise<void> {
    const record = await this.accessKeyModel.findOne({ where: { accessKeyId } });
    if (!record) return; // idempotent — nothing to revoke
    if (!requester.isRoot && record.ownerId !== requester.ownerId) {
      throw new AccessDeniedException('Cannot revoke an access key you do not own');
    }
    await record.update({ active: false });
  }

  async verifySignature(request: SignableRequest): Promise<Principal> {
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith(AUTH_SCHEME)) {
      throw new SignatureInvalidException('Missing or malformed Authorization header');
    }

    const { accessKeyId, signedHeaders, signature } = this.parseAuthHeader(authHeader);

    const record = await this.accessKeyModel.findOne({ where: { accessKeyId, active: true } });
    if (!record) {
      throw new SignatureInvalidException('Unknown or inactive access key');
    }

    const secretKey = this.encryptionService.decryptWithMasterKey(record.secretKeyEncrypted);
    const canonicalRequest = this.buildCanonicalRequest(request, signedHeaders);
    const expected = this.computeSignature(canonicalRequest, secretKey);

    if (expected !== signature) {
      throw new SignatureInvalidException();
    }

    return { ownerId: record.ownerId, accessKeyId: record.accessKeyId };
  }

  private buildCanonicalRequest(request: SignableRequest, signedHeaders: string[]): string {
    const sortedQuery = Object.keys(request.query)
      .sort()
      .map((k) => `${k}=${request.query[k]}`)
      .join('&');

    const canonicalHeaders = signedHeaders
      .sort()
      .map((h) => `${h}:${(request.headers[h] || '').trim()}`)
      .join('\n');

    return [
      request.method.toUpperCase(),
      request.path,
      sortedQuery,
      canonicalHeaders,
      signedHeaders.sort().join(';'),
    ].join('\n');
  }

  private computeSignature(canonicalRequest: string, secretKey: string): string {
    return createHmac('sha256', secretKey).update(canonicalRequest).digest('hex');
  }

  private parseAuthHeader(header: string): { accessKeyId: string; signedHeaders: string[]; signature: string } {
    // Format: "OSS-HMAC-SHA256 Credential=<id>, SignedHeaders=<h1;h2>, Signature=<sig>"
    const parts = header.slice(AUTH_SCHEME.length).trim().split(',').map((p) => p.trim());
    const map: Record<string, string> = {};
    for (const part of parts) {
      const [k, v] = part.split('=');
      map[k] = v;
    }
    if (!map['Credential'] || !map['SignedHeaders'] || !map['Signature']) {
      throw new SignatureInvalidException('Authorization header missing required fields');
    }
    return {
      accessKeyId: map['Credential'],
      signedHeaders: map['SignedHeaders'].split(';'),
      signature: map['Signature'],
    };
  }
}
