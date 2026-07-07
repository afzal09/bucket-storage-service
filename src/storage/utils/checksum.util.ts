import { createHash } from 'crypto';
import { Readable } from 'stream';

export class ChecksumUtil {
  static computeMd5(buffer: Buffer): string {
    return createHash('md5').update(buffer).digest('hex');
  }

  static computeSha256(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Streams the data through a hash without buffering it fully in memory,
   * resolving once the stream ends. The caller is responsible for also
   * piping `stream` to its real destination (e.g. via a PassThrough tee).
   */
  static streamingChecksum(stream: Readable, algo: 'md5' | 'sha256' = 'md5'): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash(algo);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
}
