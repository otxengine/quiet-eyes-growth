// DB audit script — run with: node scripts/check-db.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. List all existing tables
  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  const existing = new Set(tables.map(r => r.table_name));

  console.log('\n=== EXISTING TABLES (' + existing.size + ') ===');
  [...existing].forEach(t => console.log(' ✓', t));

  // 2. Required tables (from Prisma schema + startup SQL)
  const required = [
    'business_profiles', 'raw_signals', 'market_signals', 'leads', 'reviews',
    'competitors', 'proactive_alerts', 'actions', 'tasks', 'automation_logs',
    'sector_knowledge', 'business_memory', 'market_trends', 'predictions',
    'health_scores', 'social_accounts', 'morning_briefings', 'learning_signals',
    'outcome_logs', 'events', 'social_posts', 'whatsapp_messages',
    // OTX tables
    'auto_actions', 'system_events', 'routing_rules', 'composite_signals', 'business_constraints',
    // Other tables added via startup SQL
    'agent_heartbeat', 'agent_data_bus', 'otx_decisions', 'otx_competitor_snapshots',
    'meta_configurations', 'otx_opportunities', 'otx_threats', 'otx_weight_update_log',
    'media_assets', 'organic_posts', 'campaigns',
  ];

  console.log('\n=== MISSING TABLES ===');
  const missing = required.filter(t => !existing.has(t));
  if (missing.length === 0) {
    console.log(' ✓ All required tables exist!');
  } else {
    missing.forEach(t => console.log(' ✗ MISSING:', t));
  }

  // 3. Check required columns on auto_actions
  const aaColumns = await prisma.$queryRawUnsafe(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_actions'
    ORDER BY column_name
  `);
  const aaCols = new Set(aaColumns.map(r => r.column_name));
  const requiredAaCols = [
    'id', 'created_date', 'linked_business', 'agent_name', 'action_type',
    'description', 'payload', 'result', 'status', 'executed_at',
    'revenue_impact', 'auto_execute_at',
    'confidence_score', 'predicted_impact', 'execution_decision',
    'decision_reason', 'constraint_notes', 'outcome_score',
  ];
  console.log('\n=== auto_actions COLUMNS ===');
  requiredAaCols.forEach(c => {
    console.log(aaCols.has(c) ? ` ✓ ${c}` : ` ✗ MISSING: ${c}`);
  });

  // 4. Check routing_rules has seed data
  if (existing.has('routing_rules')) {
    const rr = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM routing_rules`);
    console.log('\n=== routing_rules rows:', rr[0].cnt, '===');
    if (Number(rr[0].cnt) === 0) console.log(' ✗ No seed rules — will be inserted on next startup');
    else console.log(' ✓ Rules seeded');
  }

  console.log('\nDone.\n');
}

main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
