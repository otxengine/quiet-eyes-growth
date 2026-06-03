/**
 * OrganizationContext — manages the active org + branch for the current user.
 *
 * - Fetches GET /api/orgs/my on mount
 * - Persists selection to localStorage
 * - Exposes: orgs, currentOrg, currentBranch, currentBranchId, allBranches,
 *            setCurrentOrgId, setCurrentBranchId, isLoading, isAgency, agencyClients
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { orgApi } from '@/api/orgApi';
import { useAuth } from '@/lib/AuthContext';

const OrganizationContext = createContext(null);

const LS_ORG_KEY    = 'otx_current_org_id';
const LS_BRANCH_KEY = 'otx_current_branch_id';

export function OrganizationProvider({ children }) {
  const { isAuthenticated, isLoadingAuth } = useAuth();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['myOrgs'],
    queryFn: () => orgApi.getMyOrgs(),
    enabled: !!isAuthenticated && !isLoadingAuth,
    staleTime: 60_000,
    retry: 2,
  });

  const orgs          = data?.orgs || [];
  const agencyClients = data?.agencyClients || [];

  // Restore saved selection or fall back to first org/branch
  const [currentOrgId, setCurrentOrgIdState]       = useState(() => localStorage.getItem(LS_ORG_KEY) || null);
  const [currentBranchId, setCurrentBranchIdState] = useState(() => localStorage.getItem(LS_BRANCH_KEY) || null);

  // Once orgs load, auto-select if saved selection is gone
  useEffect(() => {
    if (!orgs.length) return;

    const validOrg = orgs.find(o => o.id === currentOrgId) || orgs[0];
    if (validOrg.id !== currentOrgId) {
      setCurrentOrgIdState(validOrg.id);
      localStorage.setItem(LS_ORG_KEY, validOrg.id);
    }

    const branches = validOrg.branches || [];
    const validBranch = branches.find(b => b.id === currentBranchId) || branches[0];
    if (validBranch && validBranch.id !== currentBranchId) {
      setCurrentBranchIdState(validBranch.id);
      localStorage.setItem(LS_BRANCH_KEY, validBranch.id);
    }
  }, [orgs]); // eslint-disable-line react-hooks/exhaustive-deps

  const setCurrentOrgId = useCallback((orgId) => {
    setCurrentOrgIdState(orgId);
    localStorage.setItem(LS_ORG_KEY, orgId);
    // Auto-select first branch of the new org
    const org = orgs.find(o => o.id === orgId);
    const firstBranch = org?.branches?.[0];
    if (firstBranch) {
      setCurrentBranchIdState(firstBranch.id);
      localStorage.setItem(LS_BRANCH_KEY, firstBranch.id);
    }
  }, [orgs]);

  const setCurrentBranchId = useCallback((branchId) => {
    setCurrentBranchIdState(branchId);
    localStorage.setItem(LS_BRANCH_KEY, branchId);
  }, []);

  const currentOrg    = orgs.find(o => o.id === currentOrgId) || orgs[0] || null;
  const allBranches   = currentOrg?.branches || [];
  const currentBranch = allBranches.find(b => b.id === currentBranchId) || allBranches[0] || null;

  const isAgency      = !!currentOrg?.is_agency;
  const hasMultiple   = orgs.length > 1 || allBranches.length > 1;

  return (
    <OrganizationContext.Provider value={{
      orgs,
      currentOrg,
      currentBranch,
      currentBranchId: currentBranch?.id || null,
      allBranches,
      setCurrentOrgId,
      setCurrentBranchId,
      isLoading,
      error,
      isAgency,
      hasMultiple,
      agencyClients,
      refetch,
    }}>
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization() {
  const ctx = useContext(OrganizationContext);
  if (!ctx) throw new Error('useOrganization must be used inside OrganizationProvider');
  return ctx;
}
