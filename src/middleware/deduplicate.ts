import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const requestCache = new Map<string, { timestamp: number; response: any }>();
const CACHE_TTL = 5000;

export function generateRequestKey(req: Request): string {
  const body = JSON.stringify(req.body || {});
  const hash = crypto.createHash('md5').update(req.path + body).digest('hex');
  return `${req.method}:${hash}`;
}

export function deduplicateMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return next();
  }

  const key = generateRequestKey(req);
  const now = Date.now();
  const cached = requestCache.get(key);

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return res.status(200).json({
      ...cached.response,
      _from_cache: true
    });
  }

  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      requestCache.set(key, {
        timestamp: now,
        response: body
      });
    }
    return originalJson(body);
  };

  next();
}

export function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of requestCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      requestCache.delete(key);
    }
  }
}

setInterval(cleanupCache, 10000);
