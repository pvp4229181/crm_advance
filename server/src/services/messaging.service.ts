import { ApiError } from '../utils/http.js';

// Twilio is used for both SMS and WhatsApp - same REST API, the WhatsApp sender is just a
// number prefixed with "whatsapp:". No SDK dependency: the Messages resource is one POST.
export type MessageChannel = 'sms' | 'whatsapp';
const fromFor = (channel: MessageChannel) => channel === 'whatsapp' ? process.env.TWILIO_WHATSAPP_FROM : process.env.TWILIO_SMS_FROM;
const configured = (channel: MessageChannel) => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && fromFor(channel));
const prefix = (channel: MessageChannel, number: string) => channel === 'whatsapp' && !number.startsWith('whatsapp:') ? `whatsapp:${number}` : number;

export async function sendTwilioMessage(channel: MessageChannel, to: string, body: string) {
  if (!configured(channel)) throw new ApiError(503, `${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} sending is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and ${channel === 'whatsapp' ? 'TWILIO_WHATSAPP_FROM' : 'TWILIO_SMS_FROM'} in the server environment.`);
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const params = new URLSearchParams({ To: prefix(channel, to), From: prefix(channel, fromFor(channel)!), Body: body });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    console.error('Twilio send failed', detail);
    throw new ApiError(502, detail.message ? `Message could not be sent: ${detail.message}` : 'Message could not be sent. Check the Twilio settings and the recipient number.');
  }
  return response.json();
}
