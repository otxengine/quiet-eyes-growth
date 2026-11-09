// sendEmail forwards Resend attachments ({ filename, content: base64 }) and only when there are some.
process.env.RESEND_API_KEY = 'test-resend-key';

import { sendEmail } from '../lib/email';

const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
beforeEach(() => { (global as any).fetch = fetchMock; });

const sentBody = () => JSON.parse(((fetchMock.mock.calls[0] as any)[1] as any).body);

describe('sendEmail attachments', () => {
  it('includes the attachments in the Resend payload', async () => {
    const attachments = [{ filename: 'cortexi-daily-2026-11-08.pdf', content: Buffer.from('%PDF-1.4').toString('base64') }];
    await expect(sendEmail({ to: ['a@x.com'], subject: 's', html: '<p>h</p>', attachments })).resolves.toBe(true);
    expect(sentBody().attachments).toEqual(attachments);
    expect(sentBody().to).toEqual(['a@x.com']);
  });

  it('omits the field when there are none', async () => {
    await sendEmail({ to: 'a@x.com', subject: 's', html: '<p>h</p>', attachments: [] });
    expect(sentBody()).not.toHaveProperty('attachments');
  });
});
