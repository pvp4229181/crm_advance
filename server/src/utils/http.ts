import type { RequestHandler } from 'express';
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export const asyncHandler = (fn: RequestHandler): RequestHandler => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
