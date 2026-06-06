import re

# ── Fix 1: Add missing sector hashtags to tiktokSectorTrendAgent ──────────────
tiktok_path = 'C:/Users/tal89/Downloads/quiet-eyes-growth/server/src/routes/functions/tiktokSectorTrendAgent.ts'
content = open(tiktok_path, encoding='utf-8').read()

old_events_entry = "  'אירועים':      ['אירוע', 'event_israel', 'חתונה', 'wedding_israel', 'קייטרינג'],"

new_events_entry = (
    "  'אירועים':      ['אירוע', 'event_israel', 'חתונה', 'wedding_israel', 'קייטרינג'],\n"
    "  // מוזיקה, פסטיבלים ואירועי לילה\n"
    "  'מוזיקה':       ['מוזיקה', 'music_israel', 'dj_israel', 'festival_israel', 'rave_israel', 'edm', 'techno_israel'],\n"
    "  'dj':           ['dj_israel', 'edm', 'rave_israel', 'festival_music', 'techno', 'music_israel'],\n"
    "  'פסטיבל':       ['festival_israel', 'dj_israel', 'edm', 'rave_israel', 'music_israel', 'nightlife'],\n"
    "  'מועדון':       ['nightlife_israel', 'clubbing', 'dj_israel', 'edm', 'rave_israel', 'party_israel'],\n"
    "  'הפקה':         ['event_israel', 'festival_israel', 'מוזיקה', 'dj_israel', 'nightlife_israel'],\n"
    "  // תוספי תזונה וספורט\n"
    "  'תוספי תזונה':  ['supplements_israel', 'protein_israel', 'preworkout', 'creatine', 'כושר', 'gym_israel'],\n"
    "  'תזונת ספורט':  ['sports_nutrition', 'protein_israel', 'supplements_israel', 'כושר', 'preworkout'],\n"
    "  'חלבון':        ['protein_israel', 'supplements_israel', 'whey', 'כושר', 'gym_israel'],\n"
    "  'קריאטין':      ['creatine', 'supplements_israel', 'protein_israel', 'preworkout', 'כושר'],\n"
    "  // מזון פרימיום ויבוא\n"
    "  'מזון פרימיום': ['premium_food', 'wagyu_israel', 'chef_israel', 'מסעדת_שף', 'fine_dining_israel'],\n"
    "  'בשר פרימיום':  ['wagyu_israel', 'premium_meat', 'שף', 'chef_israel', 'fine_dining_israel'],\n"
    "  'יבוא מזון':    ['premium_food', 'gourmet_israel', 'chef_israel', 'מסעדת_שף', 'food_import'],\n"
    "  'טרופל':        ['truffle_israel', 'פטריות_טרופל', 'chef_israel', 'fine_dining_israel', 'gourmet'],\n"
    "  // פיננסים ומסחר\n"
    "  'מסחר':         ['trading_il', 'stocks_israel', 'forex_israel', 'crypto_il', 'השקעות'],\n"
    "  'השקעות':       ['השקעות', 'stocks_israel', 'trading_il', 'finance_israel', 'investment_israel'],\n"
    "  'קריפטו':       ['crypto_il', 'bitcoin_israel', 'trading_il', 'defi_israel', 'web3_israel'],\n"
    "  'תעופה':        ['aviation_israel', 'private_jet', 'business_aviation', 'flight', 'luxury_travel'],\n"
    "  'מטוסים':       ['aviation_israel', 'private_jet', 'business_aviation', 'luxury_travel', 'vip_travel'],"
)

content = content.replace(old_events_entry, new_events_entry, 1)
open(tiktok_path, 'w', encoding='utf-8').write(content)
print('tiktok hashtags:', 'creatine' in content and 'wagyu_israel' in content and 'private_jet' in content)

# ── Fix 2: Add missing sectors to findSocialLeads sector queries ──────────────
leads_path = 'C:/Users/tal89/Downloads/quiet-eyes-growth/server/src/routes/functions/findSocialLeads.ts'
content = open(leads_path, encoding='utf-8').read()

# Find the isCar block to append after
old_car_end = (
    "    if (isCar) {\n"
    "      queries.push(`site:facebook.com/groups \"מחפש רכב\" OR \"קונה רכב\" ${area} תקציב`);\n"
    "      queries.push(`site:yad2.co.il רכב ${area} ${new Date().getFullYear()} מחיר`);\n"
    "      queries.push(`\"תנאי מימון\" OR \"ליסינג\" רכב ${area} 2025 site:facebook.com`);\n"
    "    }"
)

new_car_end = (
    "    if (isCar) {\n"
    "      queries.push(`site:facebook.com/groups \"מחפש רכב\" OR \"קונה רכב\" ${area} תקציב`);\n"
    "      queries.push(`site:yad2.co.il רכב ${area} ${new Date().getFullYear()} מחיר`);\n"
    "      queries.push(`\"תנאי מימון\" OR \"ליסינג\" רכב ${area} 2025 site:facebook.com`);\n"
    "    }\n\n"
    "    // ── Aviation / Private jets / Ground handling ───────────────────────────\n"
    "    const isAviation = ['תעופה', 'מטוס', 'aviation', 'private jet', 'ground handling', 'flight'].some(k => catLower.includes(k));\n"
    "    if (isAviation) {\n"
    "      queries.push(`site:ainonline.com OR site:avbuyer.com conference summit VIP ${new Date().getFullYear()}`);\n"
    "      queries.push(`כנס עסקי בינלאומי ${area} ${new Date().getFullYear()} executive`);\n"
    "      queries.push(`private jet charter Israel demand ${new Date().getFullYear()}`);\n"
    "      queries.push(`NBAA OR EBACE OR MEBA aviation conference ${new Date().getFullYear()}`);\n"
    "    }\n\n"
    "    // ── Music festivals / EDM / Nightlife production ────────────────────────\n"
    "    const isMusicEvent = ['מוזיקה', 'פסטיבל', 'dj', 'edm', 'rave', 'מועדון', 'הפקה', 'music', 'festival', 'nightlife', 'club'].some(k => catLower.includes(k));\n"
    "    if (isMusicEvent) {\n"
    "      queries.push(`tiktok trending dj edm music ${new Date().getFullYear()} viral israel`);\n"
    "      queries.push(`site:resident-advisor.net OR site:facebook.com/events פסטיבל מוזיקה ${area} ${new Date().getFullYear()}`);\n"
    "      queries.push(`dj lineup festival israel ${new Date().getFullYear()} tickets`);\n"
    "      queries.push(`\"מחפש\" OR \"רוצה\" כרטיסים פסטיבל ${area} site:facebook.com`);\n"
    "    }\n\n"
    "    // ── Nutrition supplements / Sports nutrition ────────────────────────────\n"
    "    const isNutrition = ['תוסף', 'תזונה', 'חלבון', 'קריאטין', 'supplement', 'protein', 'creatine', 'preworkout', 'nutrition'].some(k => catLower.includes(k));\n"
    "    if (isNutrition) {\n"
    "      queries.push(`tiktok trending protein supplement creatine ${new Date().getFullYear()} review`);\n"
    "      queries.push(`site:facebook.com/groups \"תוסף\" OR \"חלבון\" \"מחיר\" OR \"מבצע\" israel`);\n"
    "      queries.push(`supplement price drop promotion israel ${new Date().getFullYear()} competitor`);\n"
    "      queries.push(`\"איזה תוסף\" OR \"מה עדיף\" site:tapuz.co.il OR site:facebook.com`);\n"
    "    }\n\n"
    "    // ── Prop trading / Fintech / Investment platforms ───────────────────────\n"
    "    const isTrading = ['מסחר', 'trading', 'prop firm', 'forex', 'קריפטו', 'crypto', 'השקעות', 'fintech', 'broker'].some(k => catLower.includes(k));\n"
    "    if (isTrading) {\n"
    "      queries.push(`site:tapuz.co.il OR site:traders-il.com \"תלונה\" OR \"בעיה\" OR \"ביצוע\" פלטפורמת מסחר`);\n"
    "      queries.push(`site:facebook.com/groups \"מחפש פלטפורמת מסחר\" OR \"עוזב\" OR \"מאוכזב\" broker`);\n"
    "      queries.push(`forex prop firm Israel complaint slow execution ${new Date().getFullYear()}`);\n"
    "      queries.push(`site:reddit.com \"prop firm\" OR \"forex broker\" Israel review ${new Date().getFullYear()}`);\n"
    "    }\n\n"
    "    // ── Premium food import / B2B gourmet (Wagyu, truffles, etc.) ──────────\n"
    "    const isPremiumFood = ['וואגיו', 'wagyu', 'טרופל', 'truffle', 'יבוא מזון', 'פרימיום', 'premium food', 'gourmet', 'בשר יוקרה'].some(k => catLower.includes(k));\n"
    "    if (isPremiumFood) {\n"
    "      queries.push(`מסעדת שף ${area} תפריט חדש ${new Date().getFullYear()} בשר פרימיום`);\n"
    "      queries.push(`site:rest.co.il OR site:2eat.co.il מסעדה חדשה ${area} שף`);\n"
    "      queries.push(`chef restaurant ${area} new menu premium wagyu truffle ${new Date().getFullYear()}`);\n"
    "      queries.push(`\"מחפש ספק\" OR \"מחפש יבואן\" בשר OR מזון פרימיום site:facebook.com`);\n"
    "    }"
)

content = content.replace(old_car_end, new_car_end, 1)
open(leads_path, 'w', encoding='utf-8').write(content)
print('leads aviation:', 'isAviation' in content)
print('leads music:', 'isMusicEvent' in content)
print('leads nutrition:', 'isNutrition' in content)
print('leads trading:', 'isTrading' in content)
print('leads premium food:', 'isPremiumFood' in content)
