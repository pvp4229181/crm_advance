import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MessageCircle, Phone, Send } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Modal } from './ui';

type RelatedModel = 'Lead' | 'Opportunity' | 'Contact' | 'Company';

// Click-to-call needs no backend at all - a tel: link hands the number to whatever the device
// already uses to dial. The two message icons open a small composer that posts to POST
// /api/messages, which sends via Twilio (SMS or WhatsApp) and logs the send to the record's timeline.
export function PhoneActions({ phone, relatedModel, relatedId, onSent }: { phone?: string; relatedModel: RelatedModel; relatedId: string; onSent?: () => void }) {
  const [compose, setCompose] = useState<'sms' | 'whatsapp' | null>(null);
  if (!phone) return <span className="text-slate-400">—</span>;
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
    <a href={`tel:${phone}`} title={`Call ${phone}`} className="text-slate-500 hover:text-[#0284c7]"><Phone size={14} /></a>
    <span className="truncate">{phone}</span>
    <button type="button" title="Send WhatsApp message" className="text-slate-400 hover:text-emerald-600" onClick={() => setCompose('whatsapp')}><MessageCircle size={14} /></button>
    <button type="button" title="Send SMS" className="text-slate-400 hover:text-[#0284c7]" onClick={() => setCompose('sms')}><Send size={14} /></button>
    {compose && <MessageComposer phone={phone} channel={compose} relatedModel={relatedModel} relatedId={relatedId} onClose={() => setCompose(null)} onSent={() => { setCompose(null); onSent?.(); }} />}
  </span>;
}

export function MessageComposer({ phone, channel, relatedModel, relatedId, onClose, onSent }: { phone: string; channel: 'sms' | 'whatsapp'; relatedModel: RelatedModel; relatedId: string; onClose: () => void; onSent: () => void }) {
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const send = useMutation({
    mutationFn: () => api('/messages', { method: 'POST', body: JSON.stringify({ relatedModel, relatedId, channel, body }) }),
    onMutate: () => setError(''),
    onSuccess: onSent,
    onError: (cause: any) => setError(cause?.message ?? 'Could not send this message.'),
  });
  return <Modal title={`Send ${channel === 'whatsapp' ? 'WhatsApp message' : 'SMS'} to ${phone}`} width="max-w-md" onClose={onClose}>
    <div className="space-y-3 p-5">
      <textarea className="field min-h-28" placeholder="Type your message…" value={body} onChange={e => setBody(e.target.value)} autoFocus />
      {error && <p className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" onClick={onClose}>Cancel</Button><Button className="btn-primary" disabled={!body.trim() || send.isPending} onClick={() => send.mutate()}>{send.isPending ? 'Sending…' : 'Send'}</Button></div>
    </div>
  </Modal>;
}
