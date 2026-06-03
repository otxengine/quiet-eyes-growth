/**
 * weeklyEmailDigest — sends a weekly summary email to the business owner.
 *
 * Scheduled: Sunday 20:00 UTC (23:00 Israel time — after content calendar runs).
 * Uses Resend. Skips silently when RESEND_API_KEY or notification_email is not set.
 *
 * Summary includes:
 *  - New leads found this week + hot leads count
 *  - New reviews + avg rating
 *  - Top insight / proactive alert
 *  - Health score
 *  - Quick link back to dashboard
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { sendEmail } from '../../lib/email';
import { writeAutomationLog } from '../../lib/automationLog';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://quiet-eyes-frontend.onrender.com';

export async function weeklyEmailDigest(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'businessProfileId required' });

  const startTime = new Date().toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000);

  try {
    const profiles = await prisma.businessProfile.findMany({
      where: { id: businessProfileId },
    });
    const profile = profiles[0];
    if (!profile) return res.json({ success: false, reason: 'profile not found' });

    const email = (profile as any).notification_email || (profile as any).owner_email;
    if (!email) {
      return res.json({ success: false, reason: 'no notification_email set on profile' });
    }

    // Load this week's data in parallel
    const [
      newLeads,
      hotLeads,
      newReviews,
      topAlert,
      healthScores,
    ] = await Promise.all([
      prisma.lead.findMany({
        where: { linked_business: businessProfileId, created_date: { gte: sevenDaysAgo } },
        select: { id: true, name: true, status: true, score: true },
        orderBy: { score: 'desc' },
        take: 5,
      }),
      prisma.lead.count({
        where: { linked_business: businessProfileId, status: 'hot' },
      }),
      prisma.review.findMany({
        where: { linked_business: businessProfileId, created_date: { gte: sevenDaysAgo } },
        select: { id: true, rating: true, sentiment: true },
      }),
      prisma.proactiveAlert.findFirst({
        where: { linked_business: businessProfileId, is_dismissed: false, is_acted_on: false },
        orderBy: { created_at: 'desc' } as any,
      }),
      prisma.healthScore.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 1,
      }),
    ]);

    const avgRating = newReviews.length > 0
      ? (newReviews.reduce((s, r) => s + (r.rating || 0), 0) / newReviews.length).toFixed(1)
      : null;

    const healthScore = (healthScores[0] as any)?.overall_score ?? null;

    const html = buildDigestEmail({
      businessName: profile.name,
      newLeadsCount: newLeads.length,
      hotLeadsCount: hotLeads,
      topLeads: newLeads.slice(0, 3),
      newReviewsCount: newReviews.length,
      avgRating,
      topAlert: topAlert ? String((topAlert as any).title || (topAlert as any).description || '') : null,
      topAlertType: topAlert ? String((topAlert as any).alert_type || '') : null,
      healthScore,
      dashboardUrl: `${FRONTEND_URL}/dashboard`,
    });

    const sent = await sendEmail({
      to: email,
      subject: `סיכום שבועי — ${profile.name} | OTX Growth`,
      html,
    });

    await writeAutomationLog('weeklyEmailDigest', businessProfileId, startTime, sent ? 1 : 0);

    return res.json({ success: sent, email, leadsFound: newLeads.length });
  } catch (err: any) {
    console.error('[weeklyEmailDigest]', err.message);
    await writeAutomationLog('weeklyEmailDigest', businessProfileId, startTime, 0, 'failed', err.message);
    return res.json({ success: false, error: err.message });
  }
}

// ── Email HTML builder ────────────────────────────────────────────────────────

function buildDigestEmail(opts: {
  businessName: string;
  newLeadsCount: number;
  hotLeadsCount: number;
  topLeads: Array<{ name?: string | null; status?: string | null; score?: number | null }>;
  newReviewsCount: number;
  avgRating: string | null;
  topAlert: string | null;
  topAlertType: string | null;
  healthScore: number | null;
  dashboardUrl: string;
}): string {
  const {
    businessName, newLeadsCount, hotLeadsCount, topLeads,
    newReviewsCount, avgRating, topAlert, healthScore, dashboardUrl,
  } = opts;

  const healthColor = healthScore === null ? '#888'
    : healthScore >= 70 ? '#16a34a'
    : healthScore >= 40 ? '#d97706'
    : '#dc2626';

  const leadRows = topLeads.length > 0
    ? topLeads.map(l =>
        `<tr>
          <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;">${l.name || 'ליד'}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:center;">
            <span style="background:${l.status === 'hot' ? '#fef2f2' : '#f0fdf4'};color:${l.status === 'hot' ? '#dc2626' : '#16a34a'};padding:2px 8px;border-radius:6px;font-size:12px;">
              ${l.status === 'hot' ? '🔥 חם' : l.status || 'חדש'}
            </span>
          </td>
          <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:center;color:#7c3aed;">
            ${l.score ? Math.round(l.score) : '-'}
          </td>
        </tr>`
      ).join('')
    : `<tr><td colspan="3" style="padding:12px;text-align:center;color:#888;">לא נמצאו לידים חדשים השבוע</td></tr>`;

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>סיכום שבועי</title></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:28px 32px;text-align:center;">
      <div style="color:white;font-size:13px;opacity:0.8;margin-bottom:4px;">OTX Growth OS</div>
      <div style="color:white;font-size:22px;font-weight:bold;">סיכום שבועי</div>
      <div style="color:rgba(255,255,255,0.85);font-size:15px;margin-top:4px;">${businessName}</div>
    </div>

    <!-- KPI Row -->
    <div style="display:flex;padding:20px 16px;gap:12px;background:#fafafa;border-bottom:1px solid #eee;">
      <div style="flex:1;background:#fff;border-radius:12px;padding:16px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
        <div style="font-size:28px;font-weight:bold;color:#7c3aed;">${newLeadsCount}</div>
        <div style="font-size:12px;color:#666;margin-top:2px;">לידים חדשים</div>
      </div>
      <div style="flex:1;background:#fff;border-radius:12px;padding:16px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
        <div style="font-size:28px;font-weight:bold;color:#dc2626;">${hotLeadsCount}</div>
        <div style="font-size:12px;color:#666;margin-top:2px;">לידים חמים</div>
      </div>
      <div style="flex:1;background:#fff;border-radius:12px;padding:16px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
        <div style="font-size:28px;font-weight:bold;color:#d97706;">${newReviewsCount}</div>
        <div style="font-size:12px;color:#666;margin-top:2px;">ביקורות חדשות${avgRating ? ` (⭐ ${avgRating})` : ''}</div>
      </div>
      ${healthScore !== null ? `
      <div style="flex:1;background:#fff;border-radius:12px;padding:16px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
        <div style="font-size:28px;font-weight:bold;color:${healthColor};">${Math.round(healthScore)}</div>
        <div style="font-size:12px;color:#666;margin-top:2px;">ציון בריאות</div>
      </div>` : ''}
    </div>

    <!-- Leads Table -->
    <div style="padding:20px 24px;">
      <div style="font-size:15px;font-weight:bold;color:#222;margin-bottom:12px;">לידים מובילים השבוע</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f8f4ff;">
            <th style="padding:8px 12px;text-align:right;color:#7c3aed;font-weight:600;">שם</th>
            <th style="padding:8px 12px;text-align:center;color:#7c3aed;font-weight:600;">סטטוס</th>
            <th style="padding:8px 12px;text-align:center;color:#7c3aed;font-weight:600;">ציון</th>
          </tr>
        </thead>
        <tbody>${leadRows}</tbody>
      </table>
    </div>

    ${topAlert ? `
    <!-- Top Alert -->
    <div style="margin:0 24px 20px;background:#fef3c7;border:1px solid #fcd34d;border-radius:12px;padding:16px;">
      <div style="font-size:12px;font-weight:bold;color:#92400e;margin-bottom:6px;">💡 תובנה בראש סדר העדיפויות</div>
      <div style="font-size:14px;color:#78350f;line-height:1.5;">${topAlert}</div>
    </div>` : ''}

    <!-- CTA -->
    <div style="padding:0 24px 28px;text-align:center;">
      <a href="${dashboardUrl}" style="background:#7c3aed;color:white;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:15px;font-weight:bold;display:inline-block;">
        פתח את הדשבורד
      </a>
    </div>

    <!-- Footer -->
    <div style="background:#f9f9f9;padding:16px 24px;text-align:center;border-top:1px solid #eee;">
      <p style="margin:0;font-size:12px;color:#aaa;">
        OTX Growth OS — מנוע צמיחה חכם לעסקים.<br>
        לביטול קבלת מיילים, עדכן את הגדרות ההתראות בדשבורד.
      </p>
    </div>
  </div>
</body>
</html>`;
}
