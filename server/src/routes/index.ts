import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authorize, requireAuth } from '../middleware/auth.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import * as auth from '../controllers/auth.controller.js';
import * as crm from '../controllers/crm.controller.js';
import * as admin from '../controllers/admin.controller.js';
import * as invitation from '../controllers/invitation.controller.js';
import * as intake from '../controllers/intake.controller.js';
import * as messaging from '../controllers/messaging.controller.js';
import { requireIntakeKey } from '../middleware/apiKey.js';
import { Activity, Opportunity, TimelineEvent } from '../models/index.js';
import { rescoreLead } from '../services/scoring.service.js';

export const api = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false });
const invitationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });
const intakeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
api.post('/auth/login', loginLimiter, asyncHandler(auth.login));
api.post('/auth/signup-admin', asyncHandler(auth.signupAdmin));
api.get('/auth/invitations/:token', invitationLimiter, asyncHandler(invitation.inspectInvitation));
api.post('/auth/invitations/:token/accept', invitationLimiter, asyncHandler(invitation.acceptInvitation));
api.post('/auth/logout', auth.logout);
api.get('/auth/me', requireAuth, auth.me);
// Public lead capture: authenticated by an IntakeChannel API key (see middleware/apiKey), not a
// session cookie - this is the door a website form, a WhatsApp/Facebook/Instagram/Google Ads
// webhook forwarder, a chatbot, or a bespoke integration posts a lead through from outside.
api.post('/public/leads', intakeLimiter, requireIntakeKey, asyncHandler(intake.receiveLead));
// Same door, for inbound email: point a SendGrid Inbound Parse / Mailgun Route / Postmark inbound
// webhook at this URL with a channel's API key to turn a received email into a lead.
api.post('/public/email', intakeLimiter, requireIntakeKey, asyncHandler(intake.receiveEmail));
// Same door, for inbound WhatsApp: point Twilio's "A message comes in" webhook (WhatsApp sender
// settings) at this URL with ?key=<channel API key> - Twilio's webhook field can't set custom
// headers, so requireIntakeKey also accepts the key as a query param. A reply from a known number
// appends to that lead/deal/contact/company's own timeline; an unknown number becomes a new lead.
api.post('/public/whatsapp', intakeLimiter, requireIntakeKey, asyncHandler(intake.receiveWhatsapp));
api.use(requireAuth);
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
api.get('/admin/channels', authorize('Administrator'), asyncHandler(intake.listChannels));
api.post('/admin/channels', authorize('Administrator'), asyncHandler(intake.createChannel));
api.post('/admin/channels/:id/rotate', authorize('Administrator'), asyncHandler(intake.rotateChannel));
api.patch('/admin/channels/:id', authorize('Administrator'), asyncHandler(intake.updateChannel));
api.delete('/admin/channels/:id', authorize('Administrator'), asyncHandler(intake.deleteChannel));
api.post('/admin/leads/import', authorize('Administrator', 'Sales Manager'), asyncHandler(intake.importLeads));
api.get('/metadata', asyncHandler(crm.metadata));
api.get('/dashboard', asyncHandler(crm.dashboard));
api.get('/dashboard/briefing', asyncHandler(crm.briefing));
api.get('/dashboard/manager', authorize('Administrator', 'Sales Manager'), asyncHandler(crm.managerDashboard));
api.get('/reports', asyncHandler(crm.report));
api.get('/reports/source-attribution', asyncHandler(crm.sourceAttribution));
api.route('/opportunities').get(asyncHandler(crm.listOpportunities)).post(asyncHandler(crm.createOpportunity));
api.route('/opportunities/:id').get(asyncHandler(crm.getOpportunity)).patch(asyncHandler(crm.updateOpportunity)).delete(asyncHandler(crm.deleteOpportunity));
api.patch('/opportunities/:id/move', asyncHandler(crm.move));
api.patch('/opportunities/:id/outcome', asyncHandler(crm.setOutcome));
api.route('/leads').get(asyncHandler(crm.listLeads)).post(asyncHandler(crm.createLead));
api.route('/leads/:id').get(asyncHandler(crm.getLead)).patch(asyncHandler(crm.updateLead)).delete(asyncHandler(crm.deleteLead));
api.post('/leads/:id/convert', asyncHandler(crm.convert));
// Logging a call is its own capture surface (see crm.controller.logCall) - distinct from
// click-to-call below, which just dials out and needs no lead at all.
api.post('/leads/calls', asyncHandler(crm.logCall));
// Click-to-call is a plain tel: link on the client and needs no server support; this is the
// server half of the other request - sending an SMS or WhatsApp message from the CRM's own number.
api.post('/messages', asyncHandler(messaging.sendMessage));
// The Activity Engine's own create/list route - every other CRUD resource below goes through the
// generic loop, but an activity's create must resolve its cross-links (see activity.service) and
// its list must support filtering by any of them, so both get dedicated handlers.
api.route('/activities').get(asyncHandler(crm.listActivities)).post(asyncHandler(crm.createActivity));
api.post('/timeline/:model/:id', asyncHandler(async (req, res) => {
  const eventType = req.body.eventType ?? 'note_added';
  const doc = await TimelineEvent.create({ createdBy: req.user!._id, relatedModel: req.params.model, relatedId: req.params.id, eventType, message: req.body.message });
  // An inbound email logged on a lead is an engagement signal the AI Lead Score reacts to (see
  // scoring.service) - rescore in the background so the card is current the next time it's opened.
  if (req.params.model === 'Lead' && eventType === 'email_received') await rescoreLead(String(req.params.id));
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
const adminResources = new Set(['teams','stages','tags','sources','campaigns','mediums','lostReasons','activityTypes']);
// Activities have their own GET/POST above (create resolves cross-links; list filters by any of
// them) - only their generic PATCH/DELETE still run through this loop.
const customCreateList = new Set(['activities']);
for (const [path, model] of Object.entries(crm.models) as [string, any][]) {
  const owned = path === 'notifications' || path === 'filters';
  if (!customCreateList.has(path)) {
    api.get(`/${path}`, asyncHandler(async (req, res) => {
      const query = owned ? { user: req.user!._id } : {};
      res.json(await model.find(query).populate(listPopulate[path] ?? []).sort('name').limit(500));
    }));
    api.post(`/${path}`, asyncHandler(async (req, res) => {
      if (adminResources.has(path) && (req.user!.role as any).name !== 'Administrator') throw new ApiError(403, 'Administrator access required');
      const base = owned ? { ...req.body, user: req.user!._id } : { ...req.body };
      if (model.schema.path('createdBy')) base.createdBy = req.user!._id;
      const doc = await model.create(base);
      res.status(201).json(doc);
    }));
  }
  api.patch(`/${path}/:id`, asyncHandler(async (req, res) => {
    if (adminResources.has(path) && (req.user!.role as any).name !== 'Administrator') throw new ApiError(403, 'Administrator access required');
    const doc = await model.findOneAndUpdate({ _id: req.params.id, ...(owned ? { user: req.user!._id } : {}) }, req.body, { new: true, runValidators: true });
    if (!doc) throw new ApiError(404, 'Record not found');
    // Completing an activity on a lead - a demo held, a proposal sent - is exactly the kind of
    // engagement the AI Lead Score reacts to (see scoring.service), so rescore in the background.
    if (path === 'activities' && doc.lead) await rescoreLead(doc.lead);
    res.json(doc);
  }));
  api.delete(`/${path}/:id`, asyncHandler(async (req, res) => {
    if (adminResources.has(path) && (req.user!.role as any).name !== 'Administrator') throw new ApiError(403, 'Administrator access required');
    const guard = referenceGuards[path];
    if (guard) { const used = await guard.model.countDocuments({ [guard.field]: req.params.id }); if (used) throw new ApiError(409, `Cannot delete: ${used} ${guard.label}${used === 1 ? ' still uses' : 's still use'} this record`); }
    const doc = await model.findOneAndDelete({ _id: req.params.id, ...(owned ? { user: req.user!._id } : {}) });
    if (!doc) throw new ApiError(404, 'Record not found');
    res.status(204).end();
  }));
}
api.post('/notifications/read-all', asyncHandler(async (req, res) => {
  await crm.models.notifications.updateMany({ user: req.user!._id, read: false }, { read: true });
  res.json({ success: true });
}));
