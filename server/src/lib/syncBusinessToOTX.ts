import { getSupabaseOTX } from './supabaseOTX';
import { createLogger } from '../infra/logger';

const logger = createLogger('SyncBusinessToOTX');

export async function syncBusinessToOTX(businessProfileId: string, name: string, sectorKey: string | undefined | null, city: string): Promise<void> {
  const supabase = getSupabaseOTX();
  const { error } = await supabase.from('businesses').upsert(
    { app_business_id: businessProfileId, name, sector: sectorKey || 'other', geo_city: city },
    { onConflict: 'app_business_id' },
  );
  if (error) logger.error(`syncBusinessToOTX failed for ${businessProfileId}: ${error.message}`);
}
