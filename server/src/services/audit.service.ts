import type { Request } from 'express';
import mongoose from 'mongoose';
import { AuditLog } from '../models/index.js';

export async function recordAudit(
  req: Request,
  action: string,
  entityType: string,
  entityId: unknown,
  changes: Record<string, unknown> = {},
) {
  if (!mongoose.isValidObjectId(entityId)) return;
  const safeChanges = Object.fromEntries(
    Object.entries(changes).filter(
      ([key]) => !/password|token|secret/i.test(key),
    ),
  );
  await AuditLog.create({
    actor: req.user!._id,
    action,
    entityType,
    entityId,
    changes: safeChanges,
  });
}
