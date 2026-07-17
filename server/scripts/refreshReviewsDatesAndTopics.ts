/**
 * One-off backfill: re-run topic extraction (new prompts) on every existing review,
 * and correct created_at for reviews sourced from SerpAPI (the only broken date path —
 * GMB uses createTime, Places uses publishTime, both already correct).
 *
 * Run against the target environment's DB/API keys, e.g.:
 *   DATABASE_URL=... SERPAPI_KEY=... GOOGLE_PLACES_API_KEY=... ANTHROPIC_API_KEY=... \
 *     npx ts-node scripts/refreshReviewsDatesAndTopics.ts
 */
import { prisma } from '../src/db';
import { serpGoogleMapsReviews, firstValidDate } from '../src/lib/serpapi';
import { batchExtractTopics } from '../src/lib/reviewTaxonomy';
import { getSectorProfile } from '../src/lib/businessProfile';
import { resolveTopicSet } from '../src/lib/reviewTopicPacks';

const TOPIC_BATCH = 100;

async function refreshTopics(reviews: Array<{ id: string; text: string | null }>, topicSet?: any) {
  for (let i = 0; i < reviews.length; i += TOPIC_BATCH) {
    const chunk = reviews.slice(i, i + TOPIC_BATCH);
    const results = await batchExtractTopics(chunk.map(r => ({ text: r.text || '' })), undefined, topicSet);
    for (let j = 0; j < chunk.length; j++) {
      const { topics, topic_sentiment } = results[j];
      if (!topics) continue;
      await (prisma.review as any).update({ where: { id: chunk[j].id }, data: { topics, topic_sentiment } }).catch(() => {});
    }
    console.log(`  topics: ${Math.min(i + TOPIC_BATCH, reviews.length)}/${reviews.length}`);
  }
}

async function refreshSerpDates(placeId: string, reviewIdPrefix: (authorLinkOrName: string) => string, existing: Array<{ id: string; google_review_id: string | null }>) {
  const raw = await serpGoogleMapsReviews(placeId, 300);
  const dateById = new Map<string, string>();
  for (const gr of raw) {
    const id = reviewIdPrefix(gr.user?.link || gr.user?.name || '') || gr.review_id;
    if (id && gr.iso_date) dateById.set(id, gr.iso_date);
    if (gr.review_id && gr.iso_date) dateById.set(gr.review_id, gr.iso_date);
  }
  let fixed = 0;
  for (const row of existing) {
    if (!row.google_review_id) continue;
    const isoDate = dateById.get(row.google_review_id);
    if (!isoDate) continue;
    await (prisma.review as any).update({
      where: { id: row.id },
      data: { created_at: firstValidDate(isoDate) },
    }).catch(() => {});
    fixed++;
  }
  return fixed;
}

async function main() {
  const businesses = await prisma.businessProfile.findMany();
  for (const b of businesses) {
    console.log(`\n[business] ${b.name} (${b.id})`);
    const sp = getSectorProfile(b as any);
    const topicSet = resolveTopicSet(sp?.sector_key ?? 'other', sp?.onboarding_review_extras ?? []);

    const ownReviews = await prisma.review.findMany({
      where: { linked_business: b.id, linked_competitor: null } as any,
      select: { id: true, text: true, source_origin: true, google_review_id: true },
    });
    console.log(`  topics: refreshing ${ownReviews.length} own reviews`);
    await refreshTopics(ownReviews, topicSet);

    const serpReviews = ownReviews.filter(r => r.source_origin === 'serp_google_maps_reviews');
    const placeId = (b as any).google_place_id;
    if (serpReviews.length > 0 && placeId) {
      const fixed = await refreshSerpDates(
        placeId,
        (link) => `serpgmr_${link.replace(/[^a-z0-9]/gi, '_').substring(0, 40)}`,
        serpReviews as any,
      );
      console.log(`  dates: fixed ${fixed}/${serpReviews.length} SerpAPI-sourced own reviews`);
    }

    const competitors = await (prisma.competitor as any).findMany({
      where: { linked_business: b.id },
      select: { id: true, name: true, google_place_id: true },
    });
    for (const comp of competitors) {
      const compReviews = await (prisma.review as any).findMany({
        where: { linked_competitor: comp.id },
        select: { id: true, text: true, google_review_id: true },
      });
      if (compReviews.length === 0) continue;
      console.log(`  [competitor] ${comp.name}: refreshing ${compReviews.length} reviews`);
      await refreshTopics(compReviews);
      if (comp.google_place_id) {
        const fixed = await refreshSerpDates(comp.google_place_id, () => '', compReviews);
        console.log(`    dates: fixed ${fixed}/${compReviews.length} SerpAPI-sourced competitor reviews`);
      }
    }
  }
  console.log('\nDone.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
