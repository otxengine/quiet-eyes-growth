# Cortexi Midsite — מה נבנה, איפה, ומה נשאר

> ענף: `feature/midsite-v2` · נבנה על בסיס `the-master-work-space` · אוגוסט 2026
> מסמך התוכן המאושר: [midsite-content-audit.md](./midsite-content-audit.md)

## מה נבנה

אתר שיווקי מלא בעברית (RTL), בשפה העיצובית מהבריף (canvas ‏#FAFAFB, גרדיאנט ורוד-כתום לאקסנטים בלבד, dotted grid, ‏Inter+Heebo):

| עמוד | קובץ |
|---|---|
| `/` בית (hero משחזר את מסך הבית של המוצר + אנימציית הקלדה) | `src/marketing/pages/Home.jsx` |
| `/features` אינדקס מודולים | `src/marketing/pages/FeaturesIndex.jsx` |
| `/features/{reputation,competitors,insights,marketing,social-competition,competitor-offers,events}` | תבנית `FeaturePage.jsx` + תוכן ב-`content/featurePages.js` |
| `/pricing` (הקטלוג המחובר ל-Stripe, חודשי בלבד) | `pages/Pricing.jsx` + `content/pricing.js` |
| `/about` (ביוגרפיות מייסדים = TODO:TAL) | `pages/About.jsx` |
| `/contact` (טופס עם handler מסומן TODO) | `pages/Contact.jsx` |
| `/how-it-works`, משפטיים (terms/privacy/data-deletion), 404 מעוצב | `pages/HowItWorks.jsx`, `pages/Legal.jsx`, `pages/NotFound.jsx` |

הכל תחת `src/marketing/` — מבודד לחלוטין מקוד האפליקציה (אסור לו לייבא מ-`@/components`, `@/lib`, `@/pages`). העמודים הציבוריים הישנים (`src/pages/public/`, `src/components/public/`) נמחקו.

## ארכיטקטורת ה-SEO (הליבה)

ה-SPA לא מספק head לכל עמוד ולא תוכן לקרולרים של OG — לכן:

1. **Dual bundle:** ‏`marketing.html` היא כניסת Vite שלישית. עמודי השיווק טוענים ‏~72KB gz ‏JS (‏react+react-dom+עמודים) + ‏5KB gz ‏CSS (‏Tailwind עם `@config` מצומצם — `tailwind.marketing.config.js`), במקום ה-366KB gz של האפליקציה.
2. **Prerender:** ‏`npm run build` = ‏`vite build` → ‏`vite build --ssr src/marketing/entry-server.jsx` → ‏`node scripts/prerender.mjs`. הסקריפט כותב קובץ HTML אמיתי לכל ראוט (`dist/pricing/index.html` וכו') עם head מלא: title/description ייחודיים, canonical, ‏OG+Twitter, ‏hreflang ‏(he+x-default, מוכן ל-`/en/`), ‏JSON-LD ‏(Organization+WebSite בכל עמוד; SoftwareApplication בבית; Product+Offer במחירים; FAQPage במחירים ובפיצ'רים).
3. **Render מגיש קבצים לפני rewrite** — אבל נתיב בלי סיומת (`/pricing`) לא ממופה אוטומטית ל-`pricing/index.html`, ולכן לכל ראוט שיווקי יש **חוק rewrite ספציפי מעל ה-catch-all** (הוגדרו ידנית ב-`quiet-eyes-growth_DEV_FE` ב-22.8.2026, ומתועדים כ-code ב-`render.yaml` routes). ראוטים של האפליקציה נופלים ל-`index.html` דרך ה-catch-all האחרון. **בכוונה אין `dist/404.html`** — הוא גובר על ה-rewrite ושובר רענון בעמודי אפליקציה (אומת מול ההתנהגות החיה).
4. **`/` מיוחד:** ‏`dist/index.html` נשאר ה-shell של האפליקציה (יעד ה-rewrite); ה-prerender מזריק לתוכו את ה-head וה-markup של עמוד הבית בין המרקרים `<!--app-head-->` / `<!--app-html-->`. הבית נצבע סטטית, וה-SPA עולה מעליו.
5. **מקור אמת אחד:** ‏`src/marketing/routes.jsx` — ‏{path, Component, seo} לכל ראוט; ניזון ממנו ה-router של ה-SPA ‏(`PublicRoutes.jsx`), ה-prerender, ה-sitemap וה-hydration.

נלווים: `public/robots.txt` (חוסם נתיבי אפליקציה + שורת Sitemap), ‏`dist/sitemap.xml` (נוצר בבילד, 16 כתובות), ‏`public/og/og-default.png` ‏(1200×630, נוצר ב-`scripts/generate-og.mjs`, דורש devDep ‏sharp), פונטים ב-`<link>` עם ‏display=swap (באתר השיווקי — בטעינה אסינכרונית).

## ציוני Lighthouse (mobile, slow-4G emulation, מקומי)

| עמוד | Perf | SEO | A11y | Best Practices | LCP | הערות |
|---|---|---|---|---|---|---|
| `/pricing` | 68 | **100** | **100** | **100** | 2.9s | bundle רזה |
| `/features/reputation` | 70 | **100** | 96 | **100** | 2.9s | bundle רזה |
| `/` בית | 30 | **100** | 98 | 96 | 7.8s | טוען את כל האפליקציה (ראו למטה) |

דוחות מלאים: `docs/lighthouse/*.report.html`. המדידה על מכונת פיתוח עמוסה עם הדמיית slow-4G; בפרודקשן (CDN + brotli) הערכים יהיו טובים יותר.

**המגבלה של `/`:** הבית מוגש מ-`index.html` שחייב להישאר ה-shell של האפליקציה, ולכן טוען את ה-bundle המלא (1.44MB / 366KB gz — ‏`main.jsx` מייבא ~40 עמודים eagerly). ה-markup הסטטי המוזרק נותן צביעה מיידית ו-SEO מלא, אבל ה-TBT/LCP סובלים מה-JS. **המלצה להמשך (שינוי קוד אפליקציה — מחוץ להיקף שהוגדר):** להמיר את ייבוא העמודים ב-`src/App.jsx` ל-`React.lazy` — צפוי להקפיץ את ציון הבית לאזור של עמודי השיווק.

## איך עובדים עם זה

```bash
npm run dev                          # SPA רגיל — עמודי השיווק ב-/home, /pricing וכו'
npm run build                        # בילד מלא כולל prerender + sitemap
node scripts/static-server.mjs 5399  # שרת מקומי עם הסמנטיקה של Render (files-first)
node scripts/generate-og.mjs         # יצירת og:image מחדש
node scripts/seo-keyword-research.mjs  # מחקר מילות מפתח (דורש DATAFORSEO_LOGIN/PASSWORD)
```

**להוסיף עמוד:** קומפוננטה ב-`src/marketing/pages/` → רשומה ב-`routes.jsx` עם seo — זה הכל (router, prerender, sitemap מתעדכנים לבד).
**להוסיף שפה (en-US):** ראוטים תחת `/en/...` ב-routes.jsx + הרחבת `alternates` ב-`seo/head.js` — המבנה מוכן.

## TODO פתוחים

1. **טופס לידים** — `pages/Contact.jsx` מסומן `// TODO: wire to leads endpoint`. אין endpoint ציבורי בשרת; תשתית המייל (Resend) קיימת — נדרש endpoint קטן בצד השרת. **לא לפרסם את העמוד לפרודקשן לפני חיווט.**
2. **וואטסאפ** — אין מספר אמיתי; הבלוק ב-Contact.jsx בהערה עם TODO.
3. **ביוגרפיות מייסדים** — `pages/About.jsx`, מסומן `<!-- TODO: TAL -->`.
4. **מחקר מילות מפתח DataForSEO** — הסקריפט מוכן; הקרדנצ'לס קיימים רק ב-Render. להריץ עם `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` ולעדכן titles אם הנפחים מצדיקים.
5. **ביצועי עמוד הבית** — React.lazy ל-routes של האפליקציה (ראו למעלה).
6. **og:image** — ה-placeholder נוצר עם Arial (sharp לא רואה את Heebo); כשיהיה עיצוב סופי, לעדכן את ה-SVG ב-`scripts/generate-og.mjs`.
7. **דומיין** — כל ה-canonical/sitemap מצביעים על `https://cortexi.ai`; לוודא שזה הדומיין שיחובר ב-Render.
