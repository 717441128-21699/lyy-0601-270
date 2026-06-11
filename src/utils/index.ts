import { v4 as uuidv4 } from 'uuid';

export function generateId(): string {
  return uuidv4();
}

export function now(): string {
  return new Date().toISOString();
}

export function successResponse(data: any, message: string = 'success') {
  return {
    code: 0,
    message,
    data
  };
}

export function errorResponse(message: string, code: number = 1) {
  return {
    code,
    message,
    data: null
  };
}

export function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function paginate(page: number = 1, pageSize: number = 20) {
  const limit = Math.max(1, Math.min(100, pageSize));
  const offset = (Math.max(1, page) - 1) * limit;
  return { limit, offset };
}
