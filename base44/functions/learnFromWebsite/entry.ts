import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { businessProfileId, websiteUrl } = await req.json();
  if (!websiteUrl) {
    return Response.json({ error: 'Missing websiteUrl' }, { status: 400 });
  }

  // Step 1: Fetch homepage and extract internal links
  let homepageContent = '';
  let internalLinks = [];
  try {
    const homeRes = await fetch(websiteUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Base44Bot/1.0)' }
    });
    homepageContent = await homeRes.text();

    // Extract internal links from HTML
    const baseUrl = new URL(websiteUrl);
    const linkRegex = /href=["']([^"']+)["']/gi;
    const foundLinks = new Set();
    let match;
    while ((match = linkRegex.exec(homepageContent)) !== null) {
      let href = match[1];
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
      try {
        const fullUrl = new URL(href, websiteUrl);
        if (fullUrl.hostname === baseUrl.hostname && !fullUrl.pathname.match(/\.(jpg|jpeg|png|gif|svg|pdf|css|js|ico|woff|woff2|ttf|eot|mp4|mp3|zip)$/i)) {
          foundLinks.add(fullUrl.origin + fullUrl.pathname);
        }
      } catch {}
    }
    internalLinks = Array.from(foundLinks).slice(0, 15); // max 15 pages
  } catch (e) {
    return Response.json({ error: 'Failed to fetch website: ' + e.message }, { status: 500 });
  }

  // Step 2: Fetch all internal pages
  const pages = [{ url: websiteUrl, content: homepageContent }];
  const fetchPromises = internalLinks
    .filter(link => link !== websiteUrl && link !== websiteUrl + '/')
    .map(async (link) => {
      try {
        const res = await fetch(link, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Base44Bot/1.0)' }
        });
        const html = await res.text();
        return { url: link, content: html };
      } catch {
        return null;
      }
    });
  
  const fetched = await Promise.all(fetchPromises);
  fetched.forEach(p => { if (p) pages.push(p); });

  // Step 3: Strip HTML to text for each page
  function htmlToText(html) {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5000);
  }

  const pagesText = pages.map(p => `--- PAGE: ${p.url} ---\n${htmlToText(p.content)}`).join('\n\n');

  // Step 4: Analyze with LLM
  const analysis = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: `אתה מנתח תוכן אתרי אינטרנט של עסקים ישראליים.

להלן תוכן מתוך ${pages.length} עמודים של אתר עסק:

${pagesText.slice(0, 25000)}

נתח את כל התוכן וחלץ ממנו ידע מובנה. החזר JSON עם מערך של פריטי ידע:`,
    response_json_schema: {
      type: "object",
      properties: {
        business_name: { type: "string", description: "שם העסק" },
        knowledge_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              knowledge_type: { type: "string", enum: ["services", "faq", "about", "pricing", "testimonials", "general"] },
              title: { type: "string", description: "כותרת קצרה" },
              content: { type: "string", description: "תוכן הידע המפורט" },
              keywords: { type: "string", description: "מילות מפתח מופרדות בפסיקים" },
              confidence: { type: "number", description: "רמת ביטחון 0-100" },
              source_url: { type: "string", description: "כתובת העמוד המקורי" }
            }
          }
        }
      }
    }
  });

  // Step 5: Delete old knowledge for this business
  if (businessProfileId) {
    const existing = await base44.asServiceRole.entities.BusinessKnowledge.filter({ linked_business: businessProfileId });
    for (const item of existing) {
      await base44.asServiceRole.entities.BusinessKnowledge.delete(item.id);
    }
  }

  // Step 6: Save new knowledge items
  const now = new Date().toISOString();
  const items = analysis.knowledge_items || [];
  const created = [];
  for (const item of items) {
    const record = await base44.asServiceRole.entities.BusinessKnowledge.create({
      linked_business: businessProfileId || '',
      source_url: item.source_url || websiteUrl,
      knowledge_type: item.knowledge_type || 'general',
      title: item.title || '',
      content: item.content || '',
      keywords: item.keywords || '',
      confidence: item.confidence || 70,
      last_scanned: now,
    });
    created.push(record);
  }

  return Response.json({
    success: true,
    pages_scanned: pages.length,
    knowledge_items_created: created.length,
    business_name: analysis.business_name || '',
    items: created
  });
});