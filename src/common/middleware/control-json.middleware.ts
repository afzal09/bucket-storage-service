import { json, NextFunction, Request, Response } from 'express';

const parseJson = json({ limit: '10mb' });

/** JSON control messages are parsed; object/part PUT payloads remain streams. */
export function controlJsonMiddleware(req: Request, res: Response, next: NextFunction): void {
  const objectPut = req.method === 'PUT' && /^\/[^/]+\/.+/.test(req.path);
  if (!objectPut && req.headers['content-type']?.includes('application/json')) {
    parseJson(req, res, next);
  } else {
    next();
  }
}
