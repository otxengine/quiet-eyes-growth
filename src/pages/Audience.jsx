import { useOutletContext } from 'react-router-dom';
import PageHeader from '@/components/shared/PageHeader';
import AudienceInsights from '@/components/audience/AudienceInsights';
import AudienceSegments from '@/components/audience/AudienceSegments';

export default function Audience() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;

  return (
    <div className="space-y-8">
      <PageHeader title="קהל יעד" subtitle="הכירו את הלקוחות שלכם ובנו קהלי יעד לקמפיינים" />

      <section className="space-y-3">
        <h2 className="text-[14px] font-bold text-foreground">מה הלקוחות שלך אומרים</h2>
        <AudienceInsights businessProfileId={bpId} />
      </section>

      <section className="space-y-3">
        <h2 className="text-[14px] font-bold text-foreground">קהלי יעד לקמפיינים</h2>
        <AudienceSegments businessProfileId={bpId} />
      </section>
    </div>
  );
}
