import React from 'react';

export default function DataDeletionPage() {
  return (
    <div className="min-h-screen px-6 py-20 bg-white" dir="rtl">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-[32px] font-bold text-foreground mb-2">מחיקת מידע</h1>
        <p className="text-[12px] text-foreground-muted mb-8">עדכון אחרון: אוגוסט 2026</p>

        <div className="prose max-w-none text-[13px] text-foreground-secondary leading-relaxed space-y-8">

          <p className="text-[14px] text-foreground leading-relaxed">
            עמוד זה מסביר כיצד ניתן לבקש מחיקה של המידע שלך מ-<strong>CORTEXI</strong>, לרבות מידע המתקבל מחשבונות פייסבוק ואינסטגרם שחיברת למערכת (Meta Platform Data). לפרטים נוספים על אופן איסוף ושימוש במידע, ראו את <a href="/privacy" className="text-primary hover:underline">מדיניות הפרטיות</a> שלנו.
          </p>

          <section>
            <h2 className="text-[18px] font-bold text-foreground mb-3">1. ניתוק חשבון פייסבוק/אינסטגרם</h2>
            <p>
              אם ברצונך למחוק רק את הגישה לעמוד הפייסבוק ו/או לחשבון האינסטגרם שחיברת, היכנס להגדרות האינטגרציות במערכת ולחץ על "נתק" מול החיבור הרלוונטי. הפעולה מוחקת מיידית ולצמיתות את טוקן הגישה, מזהה העמוד/החשבון, ואת כל המידע הנלווה מהמערכת.
            </p>
          </section>

          <section>
            <h2 className="text-[18px] font-bold text-foreground mb-3">2. מחיקת כלל המידע והחשבון</h2>
            <p>
              לבקשת מחיקה מלאה של חשבונך וכלל המידע השמור עליך במערכת (לרבות מידע לקוחות, טוקנים מחוברים, ותוכן שנוצר), שלח בקשה לכתובת{' '}
              <a href="mailto:contact@cortexi.ai" className="text-primary hover:underline">contact@cortexi.ai</a>
              {' '}מכתובת הדוא"ל הרשומה לחשבונך. נטפל בבקשה ונאשר בדוא"ל את השלמת המחיקה תוך זמן סביר.
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
