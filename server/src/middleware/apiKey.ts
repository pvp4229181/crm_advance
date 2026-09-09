import type { RequestHandler } from 'express';
import crypto from 'node:crypto';
import { IntakeChannel } from '../models/index.js';
import { ApiError, asyncHandler } from '../utils/http.js';

export const hashApiKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex');
export const newApiKey = () => 'lc_' + crypto.randomBytes(24).toString('base64url');

// Authenticates an external intake request by its channel API key instead of the session cookie -
// this is the door website forms, WhatsApp/Facebook/Google Ads webhook forwarders, chatbots, and
// bespoke integrations come through, so it deliberately sits outside requireAuth. A header is
// preferred, but some inbound-webhook providers (Twilio's console webhook field, notably) offer no
// way to attach a custom header, only a URL - so a `?key=` query param is accepted as a fallback.
export const requireIntakeKey: RequestHandler = asyncHandler(async (req, _res, next) => {
  const key = req.headers['x-api-key'] ?? req.query.key;
  if (typeof key !== 'string' || !key) throw new ApiError(401, 'Missing X-Api-Key header (or ?key= query parameter)');
  const channel = await IntakeChannel.findOne({ apiKeyHash: hashApiKey(key), active: true });
  if (!channel) throw new ApiError(401, 'Invalid or revoked API key');
  channel.lastUsedAt = new Date();
  await channel.save();
  req.intakeChannel = channel;
  next();
});
