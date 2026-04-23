import React from 'react';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen px-6 py-20">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-[32px] font-bold text-foreground mb-2">מדיניות פרטיות</h1>
        <p className="text-[12px] text-foreground-muted mb-8">עדכון אחרון: ינואר 2025</p>

        <div className="prose max-w-none text-[13px] text-foreground-secondary leading-relaxed space-y-6">

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">1. מבוא</h2>
            <p>OTX ("אנחנו", "השירות") מכבדת את פרטיות המשתמשים שלה. מדיניות זו מסבירה אילו מידע אנו אוספים, כיצד אנו משתמשים בו, ואיזו שליטה יש לך על המידע שלך.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">2. מידע שאנו אוספים</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li><strong>פרטי חשבון:</strong> שם, כתובת אימייל, שם ארגון.</li>
              <li><strong>פרטי עסק:</strong> שם העסק, קטגוריה, עיר, מילות מפתח.</li>
              <li><strong>נתוני שימוש:</strong> עמודים שביקרת, פעולות שביצעת, זמני גישה.</li>
              <li><strong>מידע ציבורי:</strong> נתונים שנאספים ממקורות ציבוריים ברשת עבור הניתוח העסקי שלך.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">3. שימוש במידע</h2>
            <p>אנו משתמשים במידע שנאסף כדי:</p>
            <ul className="list-disc list-inside space-y-1.5 mt-2">
              <li>לספק ולשפר את השירות שלנו</li>
              <li>לנתח מידע שוק ולייצר תובנות עסקיות</li>
              <li>לשלוח עדכונים ודוחות שביקשת</li>
              <li>לנהל את חשבונך ולאבטח אותו</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">4. שיתוף מידע</h2>
            <p>אנו <strong>לא מוכרים</strong> מידע אישי לצדדים שלישיים. אנו עשויים לשתף מידע עם:</p>
            <ul className="list-disc list-inside space-y-1.5 mt-2">
              <li>ספקי שירות שמסייעים בתפעול הפלטפורמה (שרתים, ניתוח נתונים)</li>
              <li>רשויות חוק במקרים הנדרשים על פי דין</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">5. אבטחת מידע</h2>
            <p>אנו נוקטים באמצעי אבטחה מקובלים בתעשייה: הצפנת SSL, גישה מוגבלת לנתונים, ואחסון מאובטח. עם זאת, אין אבטחה מוחלטת ברשת האינטרנט.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">6. Cookies</h2>
            <p>אנו משתמשים ב-cookies לצורך ניהול הסשן, ניתוח ביצועים ושיפור חוויית המשתמש. ניתן לבטל cookies בהגדרות הדפדפן שלך.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">7. זכויותיך</h2>
            <p>בהתאם לחוקי הפרטיות הישראליים ו-GDPR (ככל שחל), יש לך זכות:</p>
            <ul className="list-disc list-inside space-y-1.5 mt-2">
              <li>לגשת למידע שלך ולקבל עותק שלו</li>
              <li>לתקן מידע שגוי</li>
              <li>למחוק את חשבונך ואת המידע שלך</li>
              <li>להגביל עיבוד מידע אישי</li>
            </ul>
            <p className="mt-2">לממש זכויות אלו: <a href="mailto:privacy@quieteyes.co.il" className="text-primary hover:underline">privacy@quieteyes.co.il</a></p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">8. שינויים במדיניות</h2>
            <p>נוודא שאתה מקבל הודעה על שינויים מהותיים במדיניות זו דרך האימייל או הודעה בשירות.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-foreground mb-2">9. יצירת קשר</h2>
            <p>שאלות על הפרטיות: <a href="mailto:privacy@quieteyes.co.il" className="text-primary hover:underline">privacy@quieteyes.co.il</a></p>
          </section>
        </div>
      </div>
    </div>
  );
}
