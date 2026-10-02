import type { Request } from 'express';
import {
  Company,
  Contact,
  Lead,
  Opportunity,
  SalesTeam,
  User,
} from '../models/index.js';
import { accessScope, hasPermission } from '../middleware/auth.js';
import { ApiError } from '../utils/http.js';

export async function validateAssignment(
  req: Request,
  input: any,
  creating = false,
) {
  const admin = hasPermission(req.user, '*');
  const manager = hasPermission(req.user, 'team:write');
  if (creating && !input.salesperson) input.salesperson = String(req.user!._id);
  if (!admin && !manager) {
    if (
      input.salesperson !== undefined &&
      String(input.salesperson) !== String(req.user!._id)
    )
      throw new ApiError(403, 'You can only assign records to yourself');
    if (input.salesTeam) {
      const team = await SalesTeam.exists({
        _id: input.salesTeam,
        active: true,
        $or: [{ members: req.user!._id }, { teamLeader: req.user!._id }],
      });
      if (!team) throw new ApiError(403, 'Choose a team you belong to');
    }
  }
  if (input.salesTeam) {
    if (
      !admin &&
      manager &&
      !(req.user as any).salesTeams?.some(
        (id: unknown) => String(id) === String(input.salesTeam),
      )
    )
      throw new ApiError(403, 'Choose a team you manage');
    if (!(await SalesTeam.exists({ _id: input.salesTeam, active: true })))
      throw new ApiError(422, 'Sales team is unavailable');
  }
  if (input.salesperson) {
    if (!(await User.exists({ _id: input.salesperson, active: true })))
      throw new ApiError(422, 'Salesperson is unavailable');
    if (
      !admin &&
      manager &&
      String(input.salesperson) !== String(req.user!._id)
    ) {
      const team = await SalesTeam.exists({
        _id: { $in: (req.user as any).salesTeams ?? [] },
        $or: [
          { members: input.salesperson },
          { teamLeader: input.salesperson },
        ],
      });
      if (!team)
        throw new ApiError(403, 'Choose a salesperson from your teams');
    }
  }
  return input;
}

export async function requireRelatedAccess(
  req: Request,
  model: string,
  id: unknown,
) {
  const models: Record<string, any> = { Lead, Opportunity, Contact, Company };
  if (!models[model]) throw new ApiError(422, 'Invalid related record type');
  // Contacts and companies have ownership but no salesTeam field.
  const scope =
    ['Contact', 'Company'].includes(model) && !hasPermission(req.user, '*')
      ? { salesperson: req.user!._id }
      : accessScope(req);
  if (!(await models[model].exists({ $and: [scope, { _id: id }] })))
    throw new ApiError(404, 'Related record not found');
}

export async function validateReferences(req: Request, input: any) {
  if (input.company) await requireRelatedAccess(req, 'Company', input.company);
  if (input.contact) await requireRelatedAccess(req, 'Contact', input.contact);
}

export async function validateActivity(
  req: Request,
  input: any,
  current?: any,
) {
  const record = { ...current, ...input };
  await requireRelatedAccess(req, record.relatedModel, record.relatedId);
  if (
    !hasPermission(req.user, '*') &&
    String(record.assignedTo) !== String(req.user!._id)
  )
    throw new ApiError(403, 'You can only assign activities to yourself');
  if (record.status === 'completed')
    input.completedAt = current?.completedAt ?? new Date();
  if (record.status === 'planned') input.completedAt = null;
}
