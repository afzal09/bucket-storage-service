import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { S3Exception } from '../exceptions/s3.exceptions';

/**
 * Maps every thrown exception to a consistent { code, message, requestId }
 * JSON body (an S3-flavored simplification of S3's actual XML error body —
 * swap the serializer here if true XML compatibility is ever required).
 */
@Catch()
export class S3ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(S3ErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request as any).requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'InternalError';
    let message = 'An internal error occurred';

    if (exception instanceof S3Exception) {
      status = exception.getStatus();
      code = exception.code;
      message = (exception.getResponse() as any).message ?? exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = HttpStatus[status] ?? 'Error';
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : (body as any).message ?? exception.message;
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
      message = exception.message;
    }

    response.status(status).json({
      error: {
        code,
        message: Array.isArray(message) ? message.join('; ') : message,
        requestId,
      },
    });
  }
}
