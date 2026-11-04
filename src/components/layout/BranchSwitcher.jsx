/**
 * BranchSwitcher — TopBar dropdown to switch between orgs and branches.
 * Only renders when the user has multiple branches or multiple orgs.
 */

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Building2, GitBranch, Check } from 'lucide-react';
import { useOrganization } from '@/contexts/OrganizationContext';
import { cn } from '@/lib/utils';

export default function BranchSwitcher() {
  const { orgs, currentOrg, currentBranch, allBranches, setCurrentOrgId, setCurrentBranchId, hasMultiple } = useOrganization();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (!hasMultiple || !currentBranch) return null;

  const displayName = currentBranch.branch_display_name || currentBranch.name;
  const orgName = currentOrg?.name || '';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border hover:border-border-hover bg-card hover:bg-secondary transition-all text-right"
      >
        <Building2 className="w-3.5 h-3.5 text-foreground-muted flex-shrink-0" />
        <span className="text-[12px] font-medium text-foreground max-w-[130px] truncate">{displayName}</span>
        <ChevronDown className={cn('w-3 h-3 text-foreground-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full mt-2 left-0 w-64 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden fade-in-up" dir="rtl">
          {orgs.map((org) => (
            <div key={org.id}>
              {/* Org header */}
              <div
                className="px-3 py-2 flex items-center gap-2 bg-secondary/50 cursor-pointer hover:bg-secondary transition-colors"
                onClick={() => { setCurrentOrgId(org.id); setOpen(false); }}
              >
                <Building2 className="w-3.5 h-3.5 text-foreground-muted" />
                <span className="text-[11px] font-semibold text-foreground-secondary uppercase tracking-wider flex-1 truncate">
                  {org.name}
                </span>
                {org.id === currentOrg?.id && <Check className="w-3 h-3 text-primary" />}
              </div>

              {/* Branches */}
              {(org.branches || []).map((branch) => {
                const branchName = branch.branch_display_name || branch.name;
                const isSelected = branch.id === currentBranch?.id && org.id === currentOrg?.id;
                return (
                  <button
                    key={branch.id}
                    onClick={() => {
                      if (org.id !== currentOrg?.id) setCurrentOrgId(org.id);
                      setCurrentBranchId(branch.id);
                      setOpen(false);
                    }}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-4 py-2 text-right transition-colors',
                      isSelected ? 'bg-primary/5 text-primary' : 'text-foreground-secondary hover:bg-secondary',
                    )}
                  >
                    <GitBranch className="w-3 h-3 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium truncate">{branchName}</p>
                      {branch.city && (
                        <p className="text-[10px] text-foreground-muted">{branch.city}</p>
                      )}
                    </div>
                    {isSelected && <Check className="w-3 h-3 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
