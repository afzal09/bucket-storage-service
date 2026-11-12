import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PresignedUrlService } from '../presigned-url.service';
import { SignatureInvalidException } from '../../common/exceptions/s3.exceptions';

describe('presigned URL method enforcement', () => {
  const service = new PresignedUrlService(
    new ConfigService({ security: { presignedUrlSecret: 'test-only-secret' } }),
  );
  const principal = { ownerId: 'test-owner', accessKeyId: 'test-key' };
  const query = (url: string) => Object.fromEntries(new URL(url, 'http://localhost').searchParams);

  it.each(['GET', 'PUT'] as const)('accepts the signed %s method', (method) => {
    const url = service.generate('assets', 'folder/file.txt', method, 60, principal);
    expect(service.verify('assets', 'folder/file.txt', query(url), method)).toEqual(principal);
  });

  it.each(['PUT', 'POST', 'DELETE', 'HEAD', 'PATCH'])(
    'rejects %s when GET was signed',
    (method) => {
      const url = service.generate('assets', 'file.txt', 'GET', 60, principal);
      expect(() => service.verify('assets', 'file.txt', query(url), method)).toThrow(
        'Presigned URL does not allow this HTTP method',
      );
    },
  );

  it('rejects GET when PUT was signed', () => {
    const url = service.generate('assets', 'file.txt', 'PUT', 60, principal);
    expect(() => service.verify('assets', 'file.txt', query(url), 'GET')).toThrow(
      SignatureInvalidException,
    );
  });

  it('rejects unsupported methods at generation', () => {
    expect(() => service.generate('assets', 'file.txt', 'DELETE' as 'GET', 60, principal)).toThrow(
      BadRequestException,
    );
  });

  it('rejects tampering with the signed method field', () => {
    const url = service.generate('assets', 'file.txt', 'GET', 60, principal);
    expect(() =>
      service.verify('assets', 'file.txt', { ...query(url), method: 'PUT' }, 'PUT'),
    ).toThrow('Presigned URL signature does not match');
  });

  it('still rejects expired links', () => {
    const url = service.generate('assets', 'file.txt', 'GET', -1, principal);
    expect(() => service.verify('assets', 'file.txt', query(url), 'GET')).toThrow(
      'Presigned URL has expired',
    );
  });

  it('encodes path characters without changing the signed logical key', () => {
    const key = 'folder/a space+?#%/日本語.json';
    const url = service.generate('assets', key, 'GET', 60, principal);
    expect(new URL(url, 'http://localhost').pathname).toBe(
      '/assets/folder/a%20space%2B%3F%23%25/%E6%97%A5%E6%9C%AC%E8%AA%9E.json',
    );
    expect(service.verify('assets', key, query(url), 'GET')).toEqual(principal);
  });
});
