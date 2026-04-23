import React from 'react';

export default function TermsPage() {
  return (
    <div className="min-h-screen px-6 py-20">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-[32px] font-bold text-foreground mb-2">תנאי שימוש</h1>
        <p className="text-[12px] text-foreground-muted mb-8">עדכון אחרון: ינואר 2025</p>

        <div className="prose max-w-none text-[13px] text-foreground-secondary leading-relaxed space-y-6">

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">1. הסכמה לתנאים</h2>
            <p>בהרשמה לשירות OTX והשימוש בו, אתה מסכים לתנאי שימוש אלה. אם אינך מסכים, אנא אל תשתמש בשירות.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">2. תיאור השירות</h2>
            <p>OTX מספקת פלטפורמת מודיעין עסקי אוטומטי לעסקים קטנים ובינוניים בישראל. השירות כולל סריקת מקורות ציבוריים, ניתוח מתחרים, ניהול ביקורות, מעקב לידים ותובנות שוק.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">3. חשבון משתמש</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li>אתה אחראי לשמור על סודיות פרטי הגישה לחשבונך.</li>
              <li>חל איסור על שיתוף גישה לחשבון עם גורמים לא מורשים.</li>
              <li>יש לדווח מיידית על כל חשד לפרצת אבטחה.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">4. שימוש מותר</h2>
            <p>אתה מסכים לשימוש בשירות למטרות עסקיות חוקיות בלבד. חל איסור על:</p>
            <ul className="list-disc list-inside space-y-1.5 mt-2">
              <li>שימוש לצורך הטרדה, פגיעה בפרטיות, או פעילות בלתי חוקית</li>
              <li>גרידת נתונים מהשירות בצורה אוטומטית</li>
              <li>ניסיון לפגוע בתשתית הטכנית של המערכת</li>
              <li>העברה או מכירה של גישה לשירות לצדדים שלישיים</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">5. תוכן ומידע</h2>
            <p>המידע המוצג בשירות מבוסס על מקורות ציבוריים ועיבוד AI. OTX אינה אחראית לדיוק מלא של המידע ואין לראות בו ייעוץ עסקי, משפטי, או פיננסי.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">6. תשלום וביטול</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li>תשלום עבור מנויים בתשלום מתבצע מראש על בסיס חודשי.</li>
              <li>ניתן לבטל מנוי בכל עת; הביטול ייכנס לתוקף בסוף תקופת החיוב הנוכחית.</li>
              <li>אין החזר כספי על תקופות חיוב שכבר שולמו.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">7. קניין רוחני</h2>
            <p>כל הזכויות בשירות, לרבות תוכנה, עיצוב, ומתודולוגיה, שמורות ל-OTX. המשתמש מקבל רישיון מוגבל, אישי, ובלתי ניתן להעברה לשימוש בשירות.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">8. הגבלת אחריות</h2>
            <p>השירות ניתן "כפי שהוא" (AS IS). OTX לא תישא באחריות לנזקים עקיפים, תוצאתיים, או מקריים הנובעים מהשימוש בשירות.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">9. שינויים בתנאים</h2>
            <p>אנו שומרים לעצמנו את הזכות לשנות תנאים אלה. שינויים מהותיים יפורסמו 30 יום מראש.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">10. דין חל וסמכות שיפוט</h2>
            <p>תנאים אלה כפופים לדין הישראלי. סמכות שיפוט ייחודית לבתי המשפט בתל אביב.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">11. יצירת קשר</h2>
            <p>שאלות: <a href="mailto:legal@quieteyes.co.il" className="text-primary hover:underline">legal@quieteyes.co.il</a></p>
          </section>
        </div>
      </div>
    </div>
  );
}
