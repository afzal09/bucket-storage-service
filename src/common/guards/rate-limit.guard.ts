import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface Bucket {
  tokens: number;
  lastRefill: number;
}

/**
 * Simple in-process token-bucket limiter keyed by principal (falls back to IP
 * for unauthenticated routes). Good enough for a single instance; swap for a
 * Redis-backed limiter before running more than one replica of the API.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity = 100; // requests
  private readonly refillPerSecond = 20; // requests/sec

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const key = request.principal?.accessKeyId || request.ip || 'anonymous';
    const now = Date.now();

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    const elapsedSeconds = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillPerSecond);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      throw new HttpException(
        { code: 'SlowDown', message: 'Rate limit exceeded, please retry later' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    bucket.tokens -= 1;
    return true;
  }
}
