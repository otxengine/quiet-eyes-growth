import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';

/**
 * revisePost
 *
 * Revises a single organic post draft based on free-text owner feedback —
 * one LLM call per revision (this codebase has no multi-turn conversation
 * mechanism anywhere; every "history-aware" agent flattens prior context
 * into one prompt string, so this follows the same convention). Only the
 * copy is revised — the image/media_asset_id is left untouched.
 *
 * Body: { postId, feedback }
 * Returns: { content }
 */
export async function revisePost(req: Request, res: Response) {
  const { postId, feedback } = req.body;
  if (!postId) return res.status(400).json({ error: 'Missing postId' });
  if (!feedback?.trim()) return res.status(400).json({ error: 'Missing feedback' });

  try {
    const post = await prisma.organicPost.findUnique({ where: { id: postId } });
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const profile = post.linked_business
      ? await prisma.businessProfile.findUnique({ where: { id: post.linked_business } })
      : null;

    const prompt = `אתה עורך תוכן לרשתות חברתיות עבור עסק ישראלי. להלן טיוטת פוסט קיימת ומשוב מבעל העסק על השינוי הנדרש בה.

הפוסט הנוכחי:
"""
${post.content || ''}
"""

המשוב מבעל העסק — יש ליישם אותו במדויק:
"""
${feedback.trim()}
"""

כתוב גרסה מתוקנת של הפוסט המלא (עם Hook, גוף, CTA והאשטאגים אם היו), בעברית, מוכנה לפרסום ישיר. שמור על אותו סגנון ואורך כללי אלא אם המשוב דורש אחרת. החזר אך ורק את טקסט הפוסט המתוקן — ללא כותרות, ללא הסברים, ללא מרכאות עוטפות.`;

    const revised = await invokeLLM({
      model: 'sonnet',
      maxTokens: 700,
      skipCache: true,
      profile: profile || undefined,
      prompt,
    });

    const content = (typeof revised === 'string' ? revised : String(revised || '')).trim();
    if (!content) return res.status(500).json({ error: 'Revision produced empty content' });

    await prisma.organicPost.update({ where: { id: postId }, data: { content } });

    return res.json({ content });
  } catch (err: any) {
    console.error('[revisePost]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
