import mongoose, { Schema, type HydratedDocument } from 'mongoose';
import { normalizePhone, phoneSuffix } from '../utils/phone.js';

const ref = (model: string, required = false) => ({
  type: Schema.Types.ObjectId,
  ref: model,
  required,
});
const namedSchema = (extra: Record<string, unknown> = {}) =>
  new Schema(
    {
      name: { type: String, required: true, trim: true, unique: true },
      active: { type: Boolean, default: true },
      ...extra,
    },
    { timestamps: true },
  );

export interface IUser {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  password: string;
  avatar?: string;
  role: mongoose.Types.ObjectId | { name: string; permissions: string[] };
  active: boolean;
}
const roleSchema = namedSchema({
  permissions: [{ type: String, required: true }],
});
const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true, select: false },
    avatar: String,
    role: ref('Role', true),
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const pipelineStageSchema = namedSchema({
  sequence: { type: Number, required: true, default: 0 },
  probability: { type: Number, min: 0, max: 100, default: 10 },
  folded: { type: Boolean, default: false },
  isWon: { type: Boolean, default: false },
  color: { type: String, default: '#64748b' },
});
pipelineStageSchema.index({ sequence: 1 });
const tagSchema = namedSchema({ color: { type: String, default: '#64748b' } });
const sourceSchema = namedSchema();
const campaignSchema = namedSchema();
const mediumSchema = namedSchema();
const lostReasonSchema = namedSchema();
const activityTypeSchema = namedSchema({
  icon: { type: String, default: 'check' },
  defaultDays: { type: Number, default: 1 },
});

const address = {
  street: String,
  city: String,
  state: String,
  zip: String,
  country: String,
};
const companySchema = new Schema(
  {
    customValues: { type: Schema.Types.Mixed, default: {} },
    name: { type: String, required: true, trim: true },
    industry: String,
    website: String,
    phone: String,
    email: { type: String, lowercase: true },
    address,
    salesperson: ref('User'),
    tags: [ref('Tag')],
  },
  { timestamps: true },
);
companySchema.index({ name: 'text', email: 'text', phone: 'text' });
companySchema.index({ salesperson: 1, createdAt: -1 });
const contactSchema = new Schema(
  {
    customValues: { type: Schema.Types.Mixed, default: {} },
    name: { type: String, required: true, trim: true },
    company: ref('Company'),
    jobPosition: String,
    email: { type: String, lowercase: true },
    phone: String,
    mobile: String,
    address,
    website: String,
    notes: String,
    salesperson: ref('User'),
  },
  { timestamps: true },
);
contactSchema.index({ name: 'text', email: 'text', phone: 'text' });

const salesTeamSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    teamLeader: ref('User', true),
    members: [ref('User')],
    emailAlias: String,
    target: { type: Number, min: 0, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
const leadSchema = new Schema(
  {
    customValues: { type: Schema.Types.Mixed, default: {} },
    title: { type: String, required: true, trim: true },
    contactName: String,
    companyName: String,
    email: { type: String, lowercase: true },
    phone: String,
    normalizedPhone: String,
    phoneSuffix: String,
    expectedRevenue: { type: Number, min: 0, default: 0 },
    priority: { type: Number, min: 0, max: 3, default: 1 },
    salesperson: ref('User'),
    salesTeam: ref('SalesTeam'),
    tags: [ref('Tag')],
    source: ref('LeadSource'),
    medium: ref('Medium'),
    campaign: ref('Campaign'),
    notes: String,
    communicationMode: {
      type: String,
      enum: ['human', 'ai'],
      default: 'human',
    },
    whatsappSummary: {
      summary: String,
      intent: String,
      requirements: [String],
      budget: String,
      timeline: String,
      sentiment: { type: String, enum: ['positive', 'neutral', 'negative'] },
      nextStep: String,
      messageCount: { type: Number, default: 0 },
      generatedAt: Date,
    },
    status: {
      type: String,
      enum: ['new', 'qualified', 'disqualified', 'converted'],
      default: 'new',
    },
    lostReason: ref('LostReason'),
    lostNotes: String,
    converted: { type: Boolean, default: false },
    convertedOpportunity: ref('Opportunity'),
    createdBy: ref('User', true),
    updatedBy: ref('User', true),
  },
  { timestamps: true },
);
leadSchema.index({
  title: 'text',
  contactName: 'text',
  companyName: 'text',
  email: 'text',
  phone: 'text',
});
leadSchema.index({ salesperson: 1, status: 1, createdAt: -1 });
leadSchema.index({ salesTeam: 1, source: 1, campaign: 1 });
leadSchema.index({ email: 1 });
leadSchema.index({ normalizedPhone: 1 });
leadSchema.index({ phoneSuffix: 1 });
leadSchema.pre('save', function () {
  if (this.isModified('phone')) {
    this.normalizedPhone = normalizePhone(this.phone);
    this.phoneSuffix = phoneSuffix(this.phone);
  }
});
leadSchema.pre('insertMany', function (next: any, docs: any[]) {
  for (const doc of docs) {
    doc.normalizedPhone = normalizePhone(doc.phone);
    doc.phoneSuffix = phoneSuffix(doc.phone);
  }
  next();
});
for (const operation of [
  'findOneAndUpdate',
  'updateOne',
  'updateMany',
] as const) {
  leadSchema.pre(operation, function () {
    const update = this.getUpdate() as any;
    if (!update || Array.isArray(update)) return;
    const values = Object.hasOwn(update, 'phone')
      ? update
      : (update.$set ?? update);
    if (Object.hasOwn(values, 'phone')) {
      values.normalizedPhone = normalizePhone(values.phone);
      values.phoneSuffix = phoneSuffix(values.phone);
    }
  });
}

const opportunitySchema = new Schema(
  {
    customValues: { type: Schema.Types.Mixed, default: {} },
    title: { type: String, required: true, trim: true },
    company: ref('Company'),
    contact: ref('Contact'),
    email: { type: String, lowercase: true },
    phone: String,
    expectedRevenue: { type: Number, min: 0, default: 0 },
    recurringRevenue: { type: Number, min: 0, default: 0 },
    probability: { type: Number, min: 0, max: 100, default: 10 },
    priority: { type: Number, min: 0, max: 3, default: 1 },
    salesperson: ref('User'),
    salesTeam: ref('SalesTeam'),
    stage: ref('PipelineStage', true),
    tags: [ref('Tag')],
    source: ref('LeadSource'),
    medium: ref('Medium'),
    campaign: ref('Campaign'),
    expectedClosingDate: Date,
    status: { type: String, enum: ['open', 'won', 'lost'], default: 'open' },
    lostReason: ref('LostReason'),
    lostNotes: String,
    wonAt: Date,
    lostAt: Date,
    kanbanOrder: { type: Number, default: 0 },
    internalNotes: String,
    referredBy: String,
    createdBy: ref('User', true),
    updatedBy: ref('User', true),
  },
  { timestamps: true },
);
opportunitySchema.index({ title: 'text', email: 'text', phone: 'text' });
opportunitySchema.index({ stage: 1, status: 1, kanbanOrder: 1 });
opportunitySchema.index({ salesperson: 1, salesTeam: 1, status: 1 });
opportunitySchema.index({ company: 1, contact: 1, createdAt: -1 });
opportunitySchema.index({ source: 1, campaign: 1, expectedClosingDate: 1 });

const activitySchema = new Schema(
  {
    activityType: ref('ActivityType', true),
    dueDate: { type: Date, required: true },
    assignedTo: ref('User', true),
    summary: { type: String, required: true },
    notes: String,
    relatedModel: {
      type: String,
      enum: ['Lead', 'Opportunity', 'Contact', 'Company'],
      required: true,
    },
    relatedId: {
      type: Schema.Types.ObjectId,
      required: true,
      refPath: 'relatedModel',
    },
    status: {
      type: String,
      enum: ['planned', 'completed'],
      default: 'planned',
    },
    completedAt: Date,
    createdBy: ref('User', true),
  },
  { timestamps: true },
);
activitySchema.index({ assignedTo: 1, status: 1, dueDate: 1 });
activitySchema.index({ relatedModel: 1, relatedId: 1 });
const timelineEventSchema = new Schema(
  {
    createdBy: ref('User', true),
    relatedModel: {
      type: String,
      enum: ['Lead', 'Opportunity', 'Contact', 'Company'],
      required: true,
    },
    relatedId: { type: Schema.Types.ObjectId, required: true },
    eventType: { type: String, required: true },
    message: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
timelineEventSchema.index({ relatedModel: 1, relatedId: 1, createdAt: -1 });
const notificationSchema = new Schema(
  {
    user: ref('User', true),
    title: { type: String, required: true },
    message: String,
    type: { type: String, required: true },
    read: { type: Boolean, default: false },
    link: String,
  },
  { timestamps: true },
);
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });
const savedFilterSchema = new Schema(
  {
    name: { type: String, required: true },
    user: ref('User', true),
    resource: { type: String, required: true },
    query: { type: Schema.Types.Mixed, required: true },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);
savedFilterSchema.index({ user: 1, resource: 1, name: 1 }, { unique: true });
const noteSchema = new Schema(
  {
    body: { type: String, required: true },
    createdBy: ref('User', true),
    relatedModel: { type: String, required: true },
    relatedId: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
const auditLogSchema = new Schema(
  {
    actor: ref('User', true),
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityId: { type: Schema.Types.ObjectId, required: true, index: true },
    changes: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
const communicationSchema = new Schema(
  {
    channel: {
      type: String,
      enum: ['email', 'whatsapp', 'call'],
      required: true,
    },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    mode: { type: String, enum: ['human', 'ai'], default: 'human' },
    provider: String,
    providerMessageId: String,
    status: {
      type: String,
      enum: [
        'draft',
        'queued',
        'sent',
        'delivered',
        'read',
        'failed',
        'received',
      ],
      default: 'draft',
    },
    subject: String,
    body: String,
    relatedModel: {
      type: String,
      enum: ['Lead', 'Opportunity', 'Contact', 'Company'],
      required: true,
    },
    relatedId: { type: Schema.Types.ObjectId, required: true },
    sender: String,
    recipient: String,
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdBy: ref('User'),
  },
  { timestamps: true },
);
communicationSchema.index({ relatedModel: 1, relatedId: 1, createdAt: -1 });
communicationSchema.index(
  { provider: 1, providerMessageId: 1 },
  {
    unique: true,
    name: 'provider_message_unique',
    partialFilterExpression: {
      provider: { $type: 'string' },
      providerMessageId: { $type: 'string' },
    },
  },
);
const workflowSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: false },
    trigger: {
      event: { type: String, required: true },
      conditions: { type: Schema.Types.Mixed, default: {} },
    },
    actions: [
      {
        type: { type: String, required: true },
        config: { type: Schema.Types.Mixed, default: {} },
      },
    ],
    runs: { type: Number, default: 0 },
    failures: { type: Number, default: 0 },
    lastRunAt: Date,
    lastError: String,
    rrCursor: { type: Number, default: 0 },
    createdBy: ref('User', true),
    updatedBy: ref('User', true),
  },
  { timestamps: true },
);
workflowSchema.index({ active: 1, 'trigger.event': 1 });
const customFieldSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true, trim: true },
    entity: {
      type: String,
      enum: ['Lead', 'Contact', 'Company', 'Opportunity'],
      required: true,
    },
    fieldType: {
      type: String,
      enum: [
        'text',
        'number',
        'date',
        'dropdown',
        'multi-select',
        'checkbox',
        'currency',
        'url',
      ],
      required: true,
    },
    options: [String],
    required: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
customFieldSchema.index({ entity: 1, key: 1 }, { unique: true });
const emailTemplateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    active: { type: Boolean, default: true },
    createdBy: ref('User', true),
  },
  { timestamps: true },
);
// A WhatsApp template owned by the CRM and submitted to Meta for approval. `variables[i]` fills {{i+1}} in the body and may mix
// CRM tokens with text, e.g. "{contactName}". DRAFT means it has not reached Meta yet; only APPROVED templates can be sent.
// kind 'crm' templates never go to Meta: they use {contactName}-style tokens in the body, are sent as ordinary text, and
// store language 'crm' so their names cannot collide with Meta's (name, language) pairs.
const whatsappTemplateSchema = new Schema(
  {
    kind: { type: String, enum: ['meta', 'crm'], default: 'meta' },
    name: { type: String, required: true, trim: true },
    language: { type: String, required: true, trim: true, default: 'en_US' },
    category: String,
    status: { type: String, default: 'DRAFT' },
    statusReason: String,
    header: String,
    body: { type: String, required: true },
    footer: String,
    variables: [String],
    unsupportedReason: String,
    active: { type: Boolean, default: true },
    metaId: String,
    syncedAt: Date,
    createdBy: ref('User'),
  },
  { timestamps: true },
);
whatsappTemplateSchema.index({ name: 1, language: 1 }, { unique: true });
// A single workspace-wide document (key 'default') that shapes how the AI bot replies.
const whatsappBotSchema = new Schema(
  {
    key: { type: String, default: 'default', unique: true },
    enabled: { type: Boolean, default: true },
    businessName: { type: String, default: '' },
    persona: { type: String, default: 'A friendly, concise sales assistant.' },
    businessInfo: { type: String, default: '' },
    faq: { type: String, default: '' },
    guardrails: {
      type: String,
      default:
        'Never quote prices, discounts, or delivery dates that are not in the supplied facts.',
    },
    handoffKeywords: {
      type: [String],
      default: ['human', 'agent', 'call me', 'speak to someone'],
    },
    handoffMessage: {
      type: String,
      default: 'Thanks! A member of our team will reply to you shortly.',
    },
    autoSummarize: { type: Boolean, default: true },
    updatedBy: ref('User'),
  },
  { timestamps: true },
);
const scoringRuleSchema = new Schema(
  {
    name: { type: String, required: true },
    field: { type: String, required: true },
    operator: {
      type: String,
      enum: ['equals', 'contains', 'greater_than', 'less_than', 'exists'],
      required: true,
    },
    value: Schema.Types.Mixed,
    points: { type: Number, min: -100, max: 100, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Role = mongoose.model('Role', roleSchema);
export const User = mongoose.model<IUser>('User', userSchema);
export const PipelineStage = mongoose.model(
  'PipelineStage',
  pipelineStageSchema,
);
export const Tag = mongoose.model('Tag', tagSchema);
export const LeadSource = mongoose.model('LeadSource', sourceSchema);
export const Campaign = mongoose.model('Campaign', campaignSchema);
export const Medium = mongoose.model('Medium', mediumSchema);
export const LostReason = mongoose.model('LostReason', lostReasonSchema);
export const ActivityType = mongoose.model('ActivityType', activityTypeSchema);
export const Company = mongoose.model('Company', companySchema);
export const Contact = mongoose.model('Contact', contactSchema);
export const SalesTeam = mongoose.model('SalesTeam', salesTeamSchema);
export const Lead = mongoose.model('Lead', leadSchema);
export const Opportunity = mongoose.model('Opportunity', opportunitySchema);
export const Activity = mongoose.model('Activity', activitySchema);
export const TimelineEvent = mongoose.model(
  'TimelineEvent',
  timelineEventSchema,
);
export const Notification = mongoose.model('Notification', notificationSchema);
export const SavedFilter = mongoose.model('SavedFilter', savedFilterSchema);
export const Note = mongoose.model('Note', noteSchema);
export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export const Communication = mongoose.model(
  'Communication',
  communicationSchema,
);
export const Workflow = mongoose.model('Workflow', workflowSchema);
export const CustomField = mongoose.model('CustomField', customFieldSchema);
export const EmailTemplate = mongoose.model(
  'EmailTemplate',
  emailTemplateSchema,
);
export const ScoringRule = mongoose.model('ScoringRule', scoringRuleSchema);
export const WhatsAppTemplate = mongoose.model(
  'WhatsAppTemplate',
  whatsappTemplateSchema,
);
export const WhatsAppBot = mongoose.model('WhatsAppBot', whatsappBotSchema);
export type UserDocument = HydratedDocument<IUser>;
opportunitySchema.set('toJSON', { virtuals: true });

const userInvitationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: ref('Role', true),
    tokenHash: { type: String, required: true, unique: true, select: false },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'revoked'],
      default: 'pending',
    },
    invitedBy: ref('User', true),
    expiresAt: { type: Date, required: true },
    acceptedAt: Date,
  },
  { timestamps: true },
);
userInvitationSchema.index({ email: 1, status: 1 });
userInvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const UserInvitation = mongoose.model(
  'UserInvitation',
  userInvitationSchema,
);

const webhookJobSchema = new Schema(
  {
    _id: String,
    payload: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lockedAt: Date,
    lastError: String,
    expiresAt: Date,
  },
  { timestamps: true },
);
webhookJobSchema.index({ status: 1, nextAttemptAt: 1 });
webhookJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const WebhookJob = mongoose.model('WebhookJob', webhookJobSchema);
