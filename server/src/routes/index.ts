import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authorize, requireAuth } from '../middleware/auth.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import * as auth from '../controllers/auth.controller.js';
import * as crm from '../controllers/crm.controller.js';
import * as admin from '../controllers/admin.controller.js';
import * as invitation from '../controllers/invitation.controller.js';
import * as ai from '../controllers/ai.controller.js';
import * as imports from '../controllers/import.controller.js';
import * as whatsapp from '../controllers/whatsapp.controller.js';
import { Activity, Opportunity, TimelineEvent } from '../models/index.js';
import type { ZodObject } from 'zod';
import { workflowInput } from '../validators/index.js';

export const api = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false });
const invitationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });
const aiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
api.post('/auth/login', loginLimiter, asyncHandler(auth.login));
api.post('/auth/signup-admin', asyncHandler(auth.signupAdmin));
api.get('/auth/invitations/:token', invitationLimiter, asyncHandler(invitation.inspectInvitation));
api.post('/auth/invitations/:token/accept', invitationLimiter, asyncHandler(invitation.acceptInvitation));
api.post('/auth/logout', auth.logout);
api.get('/webhooks/whatsapp', whatsapp.verifyWebhook);
api.post('/webhooks/whatsapp', whatsapp.receiveWebhook);
api.get('/auth/me', requireAuth, auth.me);
api.use(requireAuth);
api.get('/whatsapp/status', whatsapp.status);
api.get('/leads/:id/whatsapp', asyncHandler(whatsapp.conversation));
api.patch('/leads/:id/whatsapp/mode', asyncHandler(whatsapp.setMode));
api.post('/leads/:id/whatsapp/draft', aiLimiter, asyncHandler(whatsapp.draft));
api.post('/leads/:id/whatsapp/send', asyncHandler(whatsapp.send));
api.post('/leads/:id/whatsapp/send-template', asyncHandler(whatsapp.sendTemplate));
api.post('/leads/:id/whatsapp/summarize', aiLimiter, asyncHandler(whatsapp.summarize));
api.get('/whatsapp/bot', asyncHandler(whatsapp.getBot));
api.put('/whatsapp/bot', authorize('Administrator'), asyncHandler(whatsapp.updateBot));
api.post('/whatsapp/templates/sync', authorize('Administrator'), asyncHandler(whatsapp.syncTemplates));
// Registered before the generic resource routes: creating a Meta template submits it, and edits depend on the template's kind.
api.post('/whatsappTemplates', authorize('Administrator'), asyncHandler(whatsapp.createTemplate));
api.patch('/whatsappTemplates/:id', authorize('Administrator'), asyncHandler(whatsapp.updateTemplate));
api.post('/whatsapp/templates/:id/submit', authorize('Administrator'), asyncHandler(whatsapp.submitTemplate));
api.get('/ai/status', asyncHandler(ai.status));
api.post('/ai/action-plan', aiLimiter, asyncHandler(ai.actionPlan));
api.get('/admin/roles', authorize('Administrator', 'Sales Manager'), asyncHandler(admin.listRoles));
api.post('/admin/roles', authorize('Administrator'), asyncHandler(admin.createRole));
api.patch('/admin/roles/:id', authorize('Administrator'), asyncHandler(admin.updateRole));
api.delete('/admin/roles/:id', authorize('Administrator'), asyncHandler(admin.deleteRole));
api.get('/admin/users', authorize('Administrator', 'Sales Manager'), asyncHandler(admin.listUsers));
api.post('/admin/users', authorize('Administrator'), asyncHandler(admin.createUser));
api.patch('/admin/users/:id', authorize('Administrator', 'Sales Manager'), asyncHandler(admin.updateUserAccess));
api.get('/admin/invitations', authorize('Administrator'), asyncHandler(invitation.listInvitations));
api.post('/admin/invitations', authorize('Administrator'), asyncHandler(invitation.createInvitation));
api.post('/admin/invitations/:id/resend', authorize('Administrator'), asyncHandler(invitation.resendInvitation));
api.delete('/admin/invitations/:id', authorize('Administrator'), asyncHandler(invitation.revokeInvitation));
api.get('/metadata', asyncHandler(crm.metadata));
api.get('/dashboard', asyncHandler(crm.dashboard));
api.get('/reports', asyncHandler(crm.report));
api.get('/search', asyncHandler(crm.globalSearch));
api.get('/duplicates', asyncHandler(crm.checkDuplicates));
api.get('/leads/export', asyncHandler(crm.exportLeads));
api.post('/leads/import', asyncHandler(imports.importLeads));
api.post('/leads/bulk', asyncHandler(crm.bulkLeads));
api.route('/opportunities').get(asyncHandler(crm.listOpportunities)).post(asyncHandler(crm.createOpportunity));
api.route('/opportunities/:id').get(asyncHandler(crm.getOpportunity)).patch(asyncHandler(crm.updateOpportunity)).delete(asyncHandler(crm.deleteOpportunity));
api.patch('/opportunities/:id/move', asyncHandler(crm.move));
api.patch('/opportunities/:id/outcome', asyncHandler(crm.setOutcome));
api.route('/leads').get(asyncHandler(crm.listLeads)).post(asyncHandler(crm.createLead));
api.get('/leads/:id', asyncHandler(crm.getLead));
api.route('/leads/:id').patch(asyncHandler(crm.updateLead)).delete(asyncHandler(crm.deleteLead));
api.post('/leads/:id/convert', asyncHandler(crm.convert));
api.post('/timeline/:model/:id', asyncHandler(async (req, res) => {
  const doc = await TimelineEvent.create({ createdBy: req.user!._id, relatedModel: req.params.model, relatedId: req.params.id, eventType: req.body.eventType ?? 'note_added', message: req.body.message });
  res.status(201).json(doc);
}));

// The generic list route returned raw ObjectIds, so referenced names rendered blank in the UI.
const listPopulate: Record<string, any> = {
  contacts: [{ path: 'company', select: 'name' }, { path: 'salesperson', select: 'name avatar' }],
  companies: [{ path: 'salesperson', select: 'name avatar' }, { path: 'tags', select: 'name color' }],
  activities: [{ path: 'activityType', select: 'name icon' }, { path: 'assignedTo', select: 'name avatar' }],
  teams: [{ path: 'teamLeader', select: 'name avatar' }, { path: 'members', select: 'name avatar' }],
};
// Stage and activity type are required refs: deleting one in use would strand its records.
const referenceGuards: Record<string, { model: any; field: string; label: string }> = {
  stages: { model: Opportunity, field: 'stage', label: 'opportunity' },
  activityTypes: { model: Activity, field: 'activityType', label: 'activity' },
};
// Resources whose free-form body would otherwise go straight into Mongo; unknown keys are stripped.
const bodySchemas: Record<string, ZodObject<any>> = { workflows: workflowInput };
const adminResources = new Set(['teams','stages','tags','sources','campaigns','mediums','lostReasons','activityTypes','workflows','customFields','emailTemplates','whatsappTemplates','scoringRules','auditLogs']);
for (const [path, model] of Object.entries(crm.models) as [string, any][]) {
  const owned = path === 'notifications' || path === 'filters';
  const resourceScope = (req: any) => {
    if (owned) return { user: req.user!._id };
    if ((req.user!.role as any).name === 'Administrator') return {};
    if (path === 'activities') return { assignedTo: req.user!._id };
    if (path === 'communications' || path === 'auditLogs') return { createdBy: req.user!._id };
    if (path === 'contacts' || path === 'companies') return { salesperson: req.user!._id };
    return {};
  };
  api.get(`/${path}`, asyncHandler(async (req, res) => {
    const query = resourceScope(req);
    res.json(await model.find(query).populate(listPopulate[path] ?? []).sort(path === 'activities' ? 'dueDate' : 'name').limit(500));
  }));
  api.post(`/${path}`, asyncHandler(async (req, res) => {
    if (adminResources.has(path) && (req.user!.role as any).name !== 'Administrator') throw new ApiError(403, 'Administrator access required');
    const body = bodySchemas[path]?.parse(req.body) ?? req.body;
    const base: any = owned ? { ...body, user: req.user!._id } : { ...body };
    if ((req.user!.role as any).name === 'Salesperson' && path === 'activities') base.assignedTo = req.user!._id;
    if ((req.user!.role as any).name !== 'Administrator' && (path === 'contacts' || path === 'companies')) base.salesperson = req.user!._id;
    if (model.schema.path('createdBy')) base.createdBy = req.user!._id;
    if (model.schema.path('updatedBy')) base.updatedBy = req.user!._id;
    const doc = await model.create(base);
    res.status(201).json(doc);
  }));
  api.patch(`/${path}/:id`, asyncHandler(async (req, res) => {
    if (adminResources.has(path) && (req.user!.role as any).name !== 'Administrator') throw new ApiError(403, 'Administrator access required');
    const body = bodySchemas[path]?.partial().parse(req.body) ?? req.body;
    const doc = await model.findOneAndUpdate({ _id: req.params.id, ...resourceScope(req) }, model.schema.path('updatedBy') ? { ...body, updatedBy: req.user!._id } : body, { new: true, runValidators: true });
    if (!doc) throw new ApiError(404, 'Record not found');
    res.json(doc);
  }));
  api.delete(`/${path}/:id`, asyncHandler(async (req, res) => {
    if (adminResources.has(path) && (req.user!.role as any).name !== 'Administrator') throw new ApiError(403, 'Administrator access required');
    const guard = referenceGuards[path];
    if (guard) { const used = await guard.model.countDocuments({ [guard.field]: req.params.id }); if (used) throw new ApiError(409, `Cannot delete: ${used} ${guard.label}${used === 1 ? ' still uses' : 's still use'} this record`); }
    const doc = await model.findOneAndDelete({ _id: req.params.id, ...resourceScope(req) });
    if (!doc) throw new ApiError(404, 'Record not found');
    res.status(204).end();
  }));
}
api.post('/notifications/read-all', asyncHandler(async (req, res) => {
  await crm.models.notifications.updateMany({ user: req.user!._id, read: false }, { read: true });
  res.json({ success: true });
}));
