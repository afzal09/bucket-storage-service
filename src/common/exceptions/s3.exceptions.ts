import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base class for every error this service throws deliberately.
 * Carries an S3-style error code so S3ErrorFilter can shape a
 * consistent response body regardless of where it was thrown.
 */
export class S3Exception extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus,
  ) {
    super({ code, message }, status);
  }
}

export class NoSuchBucketException extends S3Exception {
  constructor(bucket: string) {
    super('NoSuchBucket', `The specified bucket does not exist: ${bucket}`, HttpStatus.NOT_FOUND);
  }
}

export class BucketAlreadyExistsException extends S3Exception {
  constructor(bucket: string) {
    super('BucketAlreadyExists', `Bucket already exists: ${bucket}`, HttpStatus.CONFLICT);
  }
}

export class BucketNotEmptyException extends S3Exception {
  constructor(bucket: string) {
    super('BucketNotEmpty', `Bucket is not empty: ${bucket}`, HttpStatus.CONFLICT);
  }
}

export class InvalidBucketNameException extends S3Exception {
  constructor(reason: string) {
    super('InvalidBucketName', `Invalid bucket name: ${reason}`, HttpStatus.BAD_REQUEST);
  }
}

export class NoSuchKeyException extends S3Exception {
  constructor(key: string) {
    super('NoSuchKey', `The specified key does not exist: ${key}`, HttpStatus.NOT_FOUND);
  }
}

export class NoSuchUploadException extends S3Exception {
  constructor(uploadId: string) {
    super('NoSuchUpload', `The specified multipart upload does not exist: ${uploadId}`, HttpStatus.NOT_FOUND);
  }
}

export class InvalidPartException extends S3Exception {
  constructor(reason: string) {
    super('InvalidPart', reason, HttpStatus.BAD_REQUEST);
  }
}

export class AccessDeniedException extends S3Exception {
  constructor(reason = 'Access Denied') {
    super('AccessDenied', reason, HttpStatus.FORBIDDEN);
  }
}

export class SignatureInvalidException extends S3Exception {
  constructor(reason = 'The request signature could not be verified') {
    super('SignatureDoesNotMatch', reason, HttpStatus.UNAUTHORIZED);
  }
}
