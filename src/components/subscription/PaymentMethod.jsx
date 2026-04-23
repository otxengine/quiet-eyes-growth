import React from 'react';
import { CreditCard, ExternalLink } from 'lucide-react';

export default function PaymentMethod({ paymentMethod, hasSubscription, onManage }) {
  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-foreground-muted" /> אמצעי תשלום
        </h3>
        {hasSubscription && (
          <button onClick={onManage}
            className="text-[10px] font-medium text-foreground-muted hover:text-foreground transition-colors flex items-center gap-1">
            <ExternalLink className="w-3 h-3" /> נהל ב-Stripe
          </button>
        )}
      </div>

      {paymentMethod ? (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary/50 border border-border">
          <div className="w-10 h-7 rounded bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
            <CreditCard className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-[12px] font-medium text-foreground capitalize">{paymentMethod.brand} •••• {paymentMethod.last4}</p>
            <p className="text-[10px] text-foreground-muted">תוקף: {paymentMethod.exp}</p>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-secondary/50 border border-border text-center">
          <p className="text-[12px] text-foreground-muted">
            {hasSubscription ? 'לא נמצא אמצעי תשלום' : 'שדרג לתוכנית בתשלום כדי להוסיף אמצעי תשלום'}
          </p>
        </div>
      )}
    </div>
  );
}