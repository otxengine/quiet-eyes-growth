/**
 * Uploaded media types (uploadBusinessMedia + GET /api/social/media/:assetId), the Meta webhook
 * verify handshake, the admin-key rate-limit skip, and HTML escaping in the invite and weekly
 * digest emails.
 */
jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn(), findMany: jest.fn() },
    mediaAsset:      { findUnique: jest.fn(), create: jest.fn() },
    lead:            { findMany: jest.fn(), count: jest.fn() },
    review:          { findMany: jest.fn() },
    proactiveAlert:  { findFirst: jest.fn() },
    healthScore:     { findMany: jest.fn() },
  },
}));
jest.mock('../lib/s3', () => ({ ...jest.requireActual('../lib/s3'), downloadFromS3: jest.fn() }));
jest.mock('../lib/email', () => ({ ...jest.requireActual('../lib/email'), sendEmail: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn() }));

import express from 'express';
import type { AddressInfo } from 'net';
import { prisma } from '../db';
import { downloadFromS3 } from '../lib/s3';
import { sendEmail, buildInviteEmail } from '../lib/email';
import { uploadBusinessMedia } from '../routes/functions/uploadBusinessMedia';
import { weeklyEmailDigest } from '../routes/functions/weeklyEmailDigest';
import socialRouter from '../routes/social';
import metaWebhookRouter from '../routes/meta/webhook';

const db = prisma as any;
const routeHandler = (router: any, path: string) =>
  router.stack.find((l: any) => l.route?.path === path && l.route.methods.get).route.stack[0].handle;
const mockRes = () => {
  const res: any = { headers: {} as Record<string, string> };
  res.set = jest.fn((k: string, v: string) => { res.headers[k.toLowerCase()] = v; return res; });
  res.setHeader = res.set;
  res.type = jest.fn((t: string) => res.set('Content-Type', t));
  for (const m of ['status', 'send', 'json', 'sendStatus']) res[m] = jest.fn(() => res);
  return res;
};

describe('uploadBusinessMedia media type', () => {
  const upload = (mimeType: string) => {
    const res = mockRes();
    return uploadBusinessMedia({ body: {
      businessProfileId: 'biz-1', fileBase64: Buffer.from('x').toString('base64'), mimeType, description: 'd',
    } } as any, res).then(() => res);
  };
  beforeEach(() => {
    db.businessProfile.findUnique.mockResolvedValue({ id: 'biz-1' });
    db.mediaAsset.create.mockResolvedValue({ id: 'm1', url: null, media_type: 'image' });
  });

  it.each(['image/svg+xml', 'text/html', 'text/plain', 'application/xhtml+xml', 'image/svg+xml; charset=utf-8'])(
    'refuses %s', async type => {
      const res = await upload(type);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(db.mediaAsset.create).not.toHaveBeenCalled();
    });

  it.each(['image/png', 'IMAGE/JPEG', 'image/webp'])('stores %s', async type => {
    await upload(type);
    expect(db.mediaAsset.create.mock.calls[0][0].data).toMatchObject({ mime_type: type.toLowerCase(), media_type: 'image' });
  });
});

describe('GET /api/social/media/:assetId', () => {
  const serve = async (asset: object) => {
    db.mediaAsset.findUnique.mockResolvedValue(asset);
    const res = mockRes();
    await routeHandler(socialRouter, '/media/:assetId')({ params: { assetId: 'a1' } }, res);
    return res.headers;
  };

  it.each(['image/svg+xml', 'text/html'])('serves a stored %s as an inert download', async type => {
    const h = await serve({ image_base64: 'eA==', mime_type: type });
    expect(h['content-type']).toBe('application/octet-stream');
    expect(h['content-security-policy']).toBe('sandbox');
    expect(h['x-content-type-options']).toBe('nosniff');
  });

  it('applies the same to an S3 object\'s stored ContentType', async () => {
    (downloadFromS3 as jest.Mock).mockResolvedValue({ body: Buffer.from('x'), contentType: 'text/html' });
    const h = await serve({ url: 'https://bucket.example/k' });
    expect(h['content-type']).toBe('application/octet-stream');
    expect(h['content-security-policy']).toBe('sandbox');
  });

  it('keeps allowlisted image types', async () => {
    expect((await serve({ image_base64: 'eA==', mime_type: 'image/png' }))['content-type']).toBe('image/png');
  });
});

describe('Meta webhook verify (GET)', () => {
  const verify = (token: string | undefined) => {
    const res = mockRes();
    routeHandler(metaWebhookRouter, '/')(
      { query: { 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': 'abc' } }, res);
    return res;
  };
  const saved = process.env.META_WEBHOOK_VERIFY_TOKEN;
  afterEach(() => { process.env.META_WEBHOOK_VERIFY_TOKEN = saved; });

  it('refuses every request when META_WEBHOOK_VERIFY_TOKEN is unset', () => {
    delete process.env.META_WEBHOOK_VERIFY_TOKEN;
    const res = verify(undefined);
    expect(res.sendStatus).toHaveBeenCalledWith(403);
    expect(res.send).not.toHaveBeenCalled();
  });

  it('refuses a wrong token', () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'right-token';
    expect(verify('wrong-token').sendStatus).toHaveBeenCalledWith(403);
  });

  it('echoes the challenge as text/plain for the right token', () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'right-token';
    const res = verify('right-token');
    expect(res.headers['content-type']).toBe('text/plain');
    expect(res.send).toHaveBeenCalledWith('abc');
  });
});

describe('rate limiters and the admin key', () => {
  // auth.ts reads ADMIN_SECRET at load, so each case loads the modules fresh.
  async function statuses(adminSecret: string | undefined, header: string, n: number) {
    const saved = process.env.ADMIN_SECRET;
    if (adminSecret === undefined) delete process.env.ADMIN_SECRET; else process.env.ADMIN_SECRET = adminSecret;
    let strictLimiter: any;
    jest.isolateModules(() => { ({ strictLimiter } = require('../middleware/rateLimits')); });
    if (saved === undefined) delete process.env.ADMIN_SECRET; else process.env.ADMIN_SECRET = saved;

    const server = express().use(strictLimiter).get('/', (_req, res) => { res.send('ok'); }).listen(0);
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
      const out: number[] = [];
      for (let i = 0; i < n; i++) out.push((await fetch(url, { headers: { 'x-admin-key': header } })).status);
      return out;
    } finally {
      server.close();
    }
  }

  it('does not skip when ADMIN_SECRET is unset, whatever the header says', async () => {
    expect((await statuses(undefined, '__unset__', 21)).pop()).toBe(429);
  });

  it('skips for the configured admin key', async () => {
    expect(await statuses('s3cret', 's3cret', 21)).not.toContain(429);
  });
});

describe('platform emails escape interpolated values', () => {
  it('invite email', () => {
    const html = buildInviteEmail({
      inviterName: '<script>x</script>', orgName: '<img src=x>', role: '"><b>r</b>', inviteToken: 't"><i>',
    });
    expect(html).not.toMatch(/<script>|<img src=x>|<b>r<\/b>|<i>/);
    expect(html).toContain('&lt;img src=x&gt;');
  });

  it('weekly digest', async () => {
    db.businessProfile.findMany.mockResolvedValue([{ name: '<u>biz</u>', notification_email: 'owner@example.com' }]);
    db.lead.findMany.mockResolvedValue([{ name: '<img src=x>', status: '<i>s</i>', score: 50 }]);
    db.lead.count.mockResolvedValue(0);
    db.review.findMany.mockResolvedValue([]);
    db.proactiveAlert.findFirst.mockResolvedValue({ title: '<script>x</script>' });
    db.healthScore.findMany.mockResolvedValue([]);

    await weeklyEmailDigest({ body: { businessProfileId: 'biz-1' } } as any, mockRes());

    const { html } = (sendEmail as jest.Mock).mock.calls[0][0];
    expect(html).not.toMatch(/<u>biz|<img src=x>|<i>s<\/i>|<script>/);
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  });
});
