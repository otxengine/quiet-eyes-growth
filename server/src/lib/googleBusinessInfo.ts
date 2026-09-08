/**
 * Shared Google Business Profile (GBP) Business Information API client.
 * Reads the tenant's OWN connected location (mybusinessbusinessinformation.googleapis.com) —
 * never used for third-party/competitor businesses; those go through googlePlaces.ts instead.
 */
import { prisma } from '../db';
import { getValidGoogleToken } from './googleTokenRefresh';

export interface OwnLocationInfo {
  address: string | null;
  phone: string | null;
  category: string | null;
  websiteUri: string | null;
  description: string | null;
}

function joinAddress(addr: any): string | null {
  if (!addr) return null;
  const lines = [...(addr.addressLines || []), addr.locality, addr.postalCode].filter(Boolean);
  return lines.length ? lines.join(', ') : null;
}

export async function getOwnLocationInfo(businessProfileId: string): Promise<OwnLocationInfo | null> {
  const account = await prisma.socialAccount.findFirst({
    where: { linked_business: businessProfileId, platform: 'google_business', is_connected: true },
  });
  const locationPath = account?.page_id;
  if (!account || !locationPath || !locationPath.includes('/')) return null;

  const token = await getValidGoogleToken(businessProfileId);
  if (!token) return null;

  try {
    const readMask = 'storefrontAddress,phoneNumbers,categories,websiteUri,profile';
    const res = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${locationPath}?readMask=${readMask}`,
      { headers: { Authorization: `Bearer ${token}`, 'X-GOOG-API-FORMAT-VERSION': '2' } },
    );
    if (!res.ok) {
      if ((res.status === 401 || res.status === 403) && account) {
        await prisma.socialAccount.update({
          where: { id: account.id },
          data: { is_connected: false, last_error: `gbp_info_${res.status}` },
        }).catch(() => {});
      }
      return null;
    }
    const data: any = await res.json();
    return {
      address: joinAddress(data.storefrontAddress),
      phone: data.phoneNumbers?.primaryPhone || null,
      category: data.categories?.primaryCategory?.displayName || null,
      websiteUri: data.websiteUri || null,
      description: data.profile?.description || null,
    };
  } catch (e: any) {
    console.warn('[googleBusinessInfo] getOwnLocationInfo error:', e.message);
    return null;
  }
}
