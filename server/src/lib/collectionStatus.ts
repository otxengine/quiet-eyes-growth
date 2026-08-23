// ponytail: §2.1 success formula — change here changes everywhere
export type CollectionStatus = 'succeeded' | 'not_yet_done';

export interface CollectorSummary {
  rawSignals: number;
  reviews:    number;
  gmbPath:    'success' | 'failed' | 'not_connected';
}

export function evaluateCollectionStatus(s: CollectorSummary): CollectionStatus {
  if (s.rawSignals > 0 || s.reviews > 0 || s.gmbPath === 'success') return 'succeeded';
  return 'not_yet_done';
}
