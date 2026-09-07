import mongoose, { Schema, type HydratedDocument } from 'mongoose';

const ref = (model: string, required = false) => ({ type: Schema.Types.ObjectId, ref: model, required });
const namedSchema = (extra: Record<string, unknown> = {}) => new Schema({ name: { type: String, required: true, trim: true, unique: true }, active: { type: Boolean, default: true }, ...extra }, { timestamps: true });

export interface IUser { _id: mongoose.Types.ObjectId; name: string; email: string; password: string; avatar?: string; role: mongoose.Types.ObjectId | { name: string; permissions: string[] }; active: boolean; }
const roleSchema = namedSchema({ permissions: [{ type: String, required: true }] });
const userSchema = new Schema<IUser>({ name: { type: String, required: true, trim: true }, email: { type: String, required: true, unique: true, lowercase: true, trim: true }, password: { type: String, required: true, select: false }, avatar: String, role: ref('Role', true), active: { type: Boolean, default: true } }, { timestamps: true });

const pipelineStageSchema = namedSchema({ sequence: { type: Number, required: true, default: 0 }, probability: { type: Number, min: 0, max: 100, default: 10 }, folded: { type: Boolean, default: false }, isWon: { type: Boolean, default: false }, color: { type: String, default: '#64748b' } });
pipelineStageSchema.index({ sequence: 1 });
const tagSchema = namedSchema({ color: { type: String, default: '#64748b' } });
const sourceSchema = namedSchema();
const campaignSchema = namedSchema();
const mediumSchema = namedSchema();
const lostReasonSchema = namedSchema();
const activityTypeSchema = namedSchema({ icon: { type: String, default: 'check' }, defaultDays: { type: Number, default: 1 } });

const address = { street: String, city: String, state: String, zip: String, country: String };
const companySchema = new Schema({ name: { type: String, required: true, trim: true }, industry: String, website: String, phone: String, email: { type: String, lowercase: true }, address, salesperson: ref('User'), tags: [ref('Tag')] }, { timestamps: true });
companySchema.index({ name: 'text', email: 'text', phone: 'text' });
companySchema.index({ salesperson: 1, createdAt: -1 });
const contactSchema = new Schema({ name: { type: String, required: true, trim: true }, company: ref('Company'), jobPosition: String, email: { type: String, lowercase: true }, phone: String, mobile: String, address, website: String, notes: String, salesperson: ref('User') }, { timestamps: true });
contactSchema.index({ name: 'text', email: 'text', phone: 'text' });

const salesTeamSchema = new Schema({ name: { type: String, required: true, unique: true }, teamLeader: ref('User', true), members: [ref('User')], emailAlias: String, target: { type: Number, min: 0, default: 0 }, active: { type: Boolean, default: true } }, { timestamps: true });
const leadSchema = new Schema({ title: { type: String, required: true, trim: true }, contactName: String, companyName: String, email: { type: String, lowercase: true }, phone: String, expectedRevenue: { type: Number, min: 0, default: 0 }, priority: { type: Number, min: 0, max: 3, default: 1 }, salesperson: ref('User'), salesTeam: ref('SalesTeam'), tags: [ref('Tag')], source: ref('LeadSource'), medium: ref('Medium'), campaign: ref('Campaign'), notes: String, status: { type: String, enum: ['new', 'qualified', 'disqualified', 'converted'], default: 'new' }, lostReason: ref('LostReason'), lostNotes: String, converted: { type: Boolean, default: false }, convertedOpportunity: ref('Opportunity'), createdBy: ref('User', true), updatedBy: ref('User', true) }, { timestamps: true });
leadSchema.index({ title: 'text', contactName: 'text', companyName: 'text', email: 'text', phone: 'text' });
leadSchema.index({ salesperson: 1, status: 1, createdAt: -1 });
leadSchema.index({ salesTeam: 1, source: 1, campaign: 1 });

const opportunitySchema = new Schema({ title: { type: String, required: true, trim: true }, company: ref('Company'), contact: ref('Contact'), email: { type: String, lowercase: true }, phone: String, expectedRevenue: { type: Number, min: 0, default: 0 }, recurringRevenue: { type: Number, min: 0, default: 0 }, probability: { type: Number, min: 0, max: 100, default: 10 }, priority: { type: Number, min: 0, max: 3, default: 1 }, salesperson: ref('User'), salesTeam: ref('SalesTeam'), stage: ref('PipelineStage', true), tags: [ref('Tag')], source: ref('LeadSource'), medium: ref('Medium'), campaign: ref('Campaign'), expectedClosingDate: Date, status: { type: String, enum: ['open', 'won', 'lost'], default: 'open' }, lostReason: ref('LostReason'), lostNotes: String, wonAt: Date, lostAt: Date, kanbanOrder: { type: Number, default: 0 }, internalNotes: String, referredBy: String, createdBy: ref('User', true), updatedBy: ref('User', true) }, { timestamps: true });
opportunitySchema.index({ title: 'text', email: 'text', phone: 'text' });
opportunitySchema.index({ stage: 1, status: 1, kanbanOrder: 1 });
opportunitySchema.index({ salesperson: 1, salesTeam: 1, status: 1 });
opportunitySchema.index({ company: 1, contact: 1, createdAt: -1 });
opportunitySchema.index({ source: 1, campaign: 1, expectedClosingDate: 1 });

const activitySchema = new Schema({ activityType: ref('ActivityType', true), dueDate: { type: Date, required: true }, assignedTo: ref('User', true), summary: { type: String, required: true }, notes: String, relatedModel: { type: String, enum: ['Lead', 'Opportunity', 'Contact', 'Company'], required: true }, relatedId: { type: Schema.Types.ObjectId, required: true, refPath: 'relatedModel' }, status: { type: String, enum: ['planned', 'completed'], default: 'planned' }, completedAt: Date, createdBy: ref('User', true) }, { timestamps: true });
activitySchema.index({ assignedTo: 1, status: 1, dueDate: 1 });
activitySchema.index({ relatedModel: 1, relatedId: 1 });
const timelineEventSchema = new Schema({ createdBy: ref('User', true), relatedModel: { type: String, enum: ['Lead', 'Opportunity', 'Contact', 'Company'], required: true }, relatedId: { type: Schema.Types.ObjectId, required: true }, eventType: { type: String, required: true }, message: { type: String, required: true }, metadata: { type: Schema.Types.Mixed, default: {} } }, { timestamps: true });
timelineEventSchema.index({ relatedModel: 1, relatedId: 1, createdAt: -1 });
const notificationSchema = new Schema({ user: ref('User', true), title: { type: String, required: true }, message: String, type: { type: String, required: true }, read: { type: Boolean, default: false }, link: String }, { timestamps: true });
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });
const savedFilterSchema = new Schema({ name: { type: String, required: true }, user: ref('User', true), resource: { type: String, required: true }, query: { type: Schema.Types.Mixed, required: true }, isDefault: { type: Boolean, default: false } }, { timestamps: true });
savedFilterSchema.index({ user: 1, resource: 1, name: 1 }, { unique: true });
const noteSchema = new Schema({ body: { type: String, required: true }, createdBy: ref('User', true), relatedModel: { type: String, required: true }, relatedId: { type: Schema.Types.ObjectId, required: true } }, { timestamps: true });

export const Role = mongoose.model('Role', roleSchema); export const User = mongoose.model<IUser>('User', userSchema);
export const PipelineStage = mongoose.model('PipelineStage', pipelineStageSchema); export const Tag = mongoose.model('Tag', tagSchema);
export const LeadSource = mongoose.model('LeadSource', sourceSchema); export const Campaign = mongoose.model('Campaign', campaignSchema); export const Medium = mongoose.model('Medium', mediumSchema); export const LostReason = mongoose.model('LostReason', lostReasonSchema); export const ActivityType = mongoose.model('ActivityType', activityTypeSchema);
export const Company = mongoose.model('Company', companySchema); export const Contact = mongoose.model('Contact', contactSchema); export const SalesTeam = mongoose.model('SalesTeam', salesTeamSchema); export const Lead = mongoose.model('Lead', leadSchema); export const Opportunity = mongoose.model('Opportunity', opportunitySchema); export const Activity = mongoose.model('Activity', activitySchema); export const TimelineEvent = mongoose.model('TimelineEvent', timelineEventSchema); export const Notification = mongoose.model('Notification', notificationSchema); export const SavedFilter = mongoose.model('SavedFilter', savedFilterSchema); export const Note = mongoose.model('Note', noteSchema);
export type UserDocument = HydratedDocument<IUser>;
opportunitySchema.set('toJSON', { virtuals: true });

const userInvitationSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  role: ref('Role', true),
  tokenHash: { type: String, required: true, unique: true, select: false },
  status: { type: String, enum: ['pending', 'accepted', 'revoked'], default: 'pending' },
  invitedBy: ref('User', true),
  expiresAt: { type: Date, required: true },
  acceptedAt: Date,
}, { timestamps: true });
userInvitationSchema.index({ email: 1, status: 1 });
userInvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const UserInvitation = mongoose.model('UserInvitation', userInvitationSchema);
