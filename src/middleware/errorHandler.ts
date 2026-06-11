import { Request, Response, NextFunction } from 'express';
import { errorResponse } from '../utils';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error('[Error]', err.message);
  console.error(err.stack);
  res.status(500).json(errorResponse('服务器内部错误: ' + err.message, 500));
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json(errorResponse('接口不存在: ' + req.path, 404));
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
}
