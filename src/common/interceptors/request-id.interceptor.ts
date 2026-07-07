import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { randomUUID } from 'crypto';

/**
 * Stamps every request with an x-request-id (generated unless the client
 * already sent one), and echoes it back on the response — used by
 * S3ErrorFilter and AuditInterceptor so a request can be traced end to end.
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const requestId = request.headers['x-request-id'] || randomUUID();
    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);

    return next.handle();
  }
}
