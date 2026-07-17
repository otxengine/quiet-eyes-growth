import { useOutletContext } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import GoogleCompareWidget from '@/components/competitors/GoogleCompareWidget';

export default function ReviewsCompare() {
  // @ts-ignore
  const { businessProfile } = useOutletContext();
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3" dir="rtl">
        <Link to="/reviews" className="flex items-center gap-1 text-[12px] text-foreground-muted hover:text-foreground transition-colors">
          <ArrowRight className="w-4 h-4" />
          חזרה למוניטין
        </Link>
        <span className="text-lg font-semibold text-foreground">השוואת Google</span>
      </div>
      <GoogleCompareWidget businessProfileId={businessProfile?.id} businessName={businessProfile?.name} />
    </div>
  );
}
