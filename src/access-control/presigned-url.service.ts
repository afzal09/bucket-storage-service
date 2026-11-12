import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { Principal } from '../common/interfaces/principal.interface';
import { SignatureInvalidException } from '../common/exceptions/s3.exceptions';

/**
 * Ownership is embedded directly in the signed query string rather than
 * looked up from AccessKey at verify() time — that keeps AccessControlModule
 * from needing a dependency on AuthModule's AccessKey model.
 */
@Injectable()
export class PresignedUrlService {
  constructor(private readonly config: ConfigService) {}

  generate(
    bucket: string,
    key: string,
    method: 'GET' | 'PUT',
    expiresInSeconds: number,
    principal: Principal,
  ): string {
    if (method !== 'GET' && method !== 'PUT') {
      throw new BadRequestException('Presigned method must be GET or PUT');
    }
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const params = new URLSearchParams({
      method,
      expires: String(expires),
      ownerId: principal.ownerId,
      accessKeyId: principal.accessKeyId,
    });
    const signature = this.sign(bucket, key, params);
    params.set('signature', signature);

    const path = `/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
    return `${path}?${params.toString()}`;
  }

  verify(bucket: string, key: string, query: Record<string, string>, requestMethod: string): Principal {
    const { signature, ...rest } = query;
    const params = new URLSearchParams(rest);
    const expected = this.sign(bucket, key, params);

    if (signature !== expected) {
      throw new SignatureInvalidException('Presigned URL signature does not match');
    }
    if ((query.method !== 'GET' && query.method !== 'PUT') || query.method !== requestMethod.toUpperCase()) {
      throw new SignatureInvalidException('Presigned URL does not allow this HTTP method');
    }
    if (Date.now() / 1000 > Number(query.expires)) {
      throw new SignatureInvalidException('Presigned URL has expired');
    }

    return { ownerId: query.ownerId, accessKeyId: query.accessKeyId };
  }

  private sign(bucket: string, key: string, params: URLSearchParams): string {
    const secret = this.config.get<string>('security.presignedUrlSecret');
    const payload = `${bucket}/${key}?${params.toString()}`;
    return createHmac('sha256', secret).update(payload).digest('hex');
  }
}
