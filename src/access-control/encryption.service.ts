import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { EncryptionConfigDto } from '../buckets/dto/bucket.dto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Envelope encryption: each write gets a random 256-bit data key, which
 * itself is wrapped (encrypted) with the master key before being persisted
 * as `keyRef` alongside the object version. Decrypting an object means
 * unwrapping keyRef with the master key, then decrypting the ciphertext
 * with the recovered data key. This is a local stand-in for SSE-KMS's
 * envelope model — swap `wrapWithMasterKey` for a real KMS call to get
 * actual SSE_KMS semantics instead of a simulated one.
 */
@Injectable()
export class EncryptionService {
  private readonly masterKey: Buffer;

  constructor(private readonly config: ConfigService) {
    const raw = this.config.get<string>('security.encryptionMasterKey') || 'dev-32-byte-minimum-master-key!!';
    // Normalize to exactly 32 bytes regardless of the configured string's length.
    this.masterKey = createHash('sha256').update(raw).digest();
  }

  async generateDataKey(): Promise<{ plaintextKey: Buffer; wrappedKey: string }> {
    const plaintextKey = randomBytes(32);
    const wrappedKey = this.wrapWithMasterKey(plaintextKey);
    return { plaintextKey, wrappedKey };
  }

  async encrypt(buffer: Buffer, _config: EncryptionConfigDto): Promise<{ ciphertext: Buffer; keyRef: string }> {
    const { plaintextKey, wrappedKey } = await this.generateDataKey();
    const ciphertext = this.encryptWithKey(buffer, plaintextKey);
    return { ciphertext, keyRef: wrappedKey };
  }

  async decrypt(ciphertext: Buffer, keyRef: string): Promise<Buffer> {
    const plaintextKey = this.unwrapWithMasterKey(keyRef);
    return this.decryptWithKey(ciphertext, plaintextKey);
  }

  /** Used for secrets (e.g. AccessKey.secretKeyEncrypted) that don't need per-record data keys. */
  encryptWithMasterKey(plaintext: string): string {
    return this.wrapWithMasterKey(Buffer.from(plaintext, 'utf8'));
  }

  decryptWithMasterKey(ciphertext: string): string {
    return this.unwrapWithMasterKey(ciphertext).toString('utf8');
  }

  private wrapWithMasterKey(plaintext: Buffer): string {
    const encrypted = this.encryptWithKey(plaintext, this.masterKey);
    return encrypted.toString('base64');
  }

  private unwrapWithMasterKey(wrapped: string): Buffer {
    return this.decryptWithKey(Buffer.from(wrapped, 'base64'), this.masterKey);
  }

  /** Output layout: iv (12) || authTag (16) || ciphertext */
  private encryptWithKey(plaintext: Buffer, key: Buffer): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGO, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  }

  private decryptWithKey(payload: Buffer, key: Buffer): Buffer {
    const iv = payload.subarray(0, IV_LENGTH);
    const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + 16);
    const encrypted = payload.subarray(IV_LENGTH + 16);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }
}
