// WhatsApp template library, shared by the template sync (which creates the starters when Meta has none) and the
// additive `seed:templates` script. Meta templates use {{n}} placeholders mapped to CRM fields by `variables`;
// CRM templates use {contactName}-style fields directly and are sent as ordinary text inside the 24-hour window.

export const starterTemplateNames = ['lead_welcome', 'lead_follow_up'];

// Meta rejects a body that starts or ends with a placeholder, so every body opens with "Hi {{1}}" and ends in text.
export function metaTemplates(business: string) {
  const us = business ? ` with ${business}` : '';
  return [
    { name: 'lead_welcome', category: 'UTILITY', body: `Hi {{1}}, thanks for getting in touch${us}. Reply to this message and our team will help you right here on WhatsApp.`, variables: ['{contactName}'] },
    { name: 'lead_follow_up', category: 'UTILITY', body: `Hi {{1}}, we are following up on your recent enquiry${us}. Is now a good time to continue? Just reply to this message.`, variables: ['{contactName}'] },
    { name: 'owner_introduction', category: 'UTILITY', body: `Hi {{1}}, I am {{2}} and I will be your point of contact for your enquiry${us}. Feel free to reply here with any questions.`, variables: ['{contactName}', '{ownerName}'] },
    { name: 'callback_request', category: 'UTILITY', body: `Hi {{1}}, we tried to call you about your enquiry${us} but could not reach you. When is a good time to call back? Just reply with a time that suits you.`, variables: ['{contactName}'] },
    { name: 'quote_follow_up', category: 'UTILITY', body: 'Hi {{1}}, we are following up on the quotation we shared with you. Do you have any questions, or would you like any changes? Reply here and we will help.', variables: ['{contactName}'] },
    { name: 'meeting_follow_up', category: 'UTILITY', body: 'Hi {{1}}, thank you for your time today. As discussed, we will share the next steps shortly. Reply here if you have any questions in the meantime.', variables: ['{contactName}'] },
    { name: 'details_request', category: 'UTILITY', body: 'Hi {{1}}, to move ahead with your request we need a few more details from you. Please reply to this message and our team will guide you.', variables: ['{contactName}'] },
    { name: 're_engagement', category: 'MARKETING', body: `Hi {{1}}, it has been a while since we last spoke${us}. If you are still looking for help with your requirements, reply YES and we will get in touch.`, variables: ['{contactName}'] },
  ].map(template => ({ ...template, language: 'en_US' }));
}

export const crmTemplates = [
  { name: 'Greeting', body: "Hi {contactName}, thanks for reaching out! I'm {ownerName} and I'll be helping you. Could you tell me a little more about what you're looking for?" },
  { name: 'Ask for requirements', body: 'Hi {contactName}, to prepare the right proposal for you, could you share:\n1. What you need\n2. Your budget range\n3. When you would like to get started' },
  { name: 'Schedule a call', body: 'Hi {contactName}, would you be free for a quick 10-minute call to discuss your requirements? Please share a day and time that suits you.' },
  { name: 'Details shared', body: "Hi {contactName}, as promised, I've shared the details you asked about. Take a look and let me know if you have any questions." },
  { name: 'Quote follow-up', body: 'Hi {contactName}, did you get a chance to review the quotation? I am happy to walk you through it or adjust anything to fit your needs.' },
  { name: 'Meeting confirmation', body: 'Hi {contactName}, just confirming our meeting. Please let me know if the time still works for you, or suggest another slot.' },
  { name: 'Gentle nudge', body: "Hi {contactName}, I haven't heard back and didn't want you to miss out. Are you still interested? Just reply and I'll pick up where we left off." },
  { name: 'Thank you', body: "Thank you for choosing us, {contactName}! I'll share the next steps with you shortly. Feel free to message me here anytime." },
  { name: 'Not interested', body: 'Thanks for letting us know, {contactName}. If anything changes, just message us here. We are always happy to help.' },
];
