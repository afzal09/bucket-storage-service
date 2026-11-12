/** HTTP failures. Network errors and cancellation preserve the transport error. */
export class ObjectStorageError extends Error {
  readonly name = 'ObjectStorageError';

  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}
