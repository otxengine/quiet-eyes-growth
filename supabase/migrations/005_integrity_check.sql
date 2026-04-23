-- ============================================================
-- OTXEngine — Phase 1.5: Data integrity check
-- Run after every phase. Expected: 0 violations in all rows.
-- ============================================================

SELECT 'signals_raw'          AS tbl, count(*) AS violations
FROM signals_raw
WHERE source_url IS NULL OR detected_at_utc IS NULL OR confidence_score IS NULL

UNION ALL

SELECT 'classified_signals',  count(*)
FROM classified_signals
WHERE source_url IS NULL OR confidence_score IS NULL

UNION ALL

SELECT 'sector_trends',       count(*)
FROM sector_trends
WHERE source_url IS NULL OR detected_at_utc IS NULL OR confidence_score IS NULL

UNION ALL

SELECT 'events_raw',          count(*)
FROM events_raw
WHERE source_url IS NULL OR detected_at_utc IS NULL OR confidence_score IS NULL

UNION ALL

SELECT 'event_opportunities', count(*)
FROM event_opportunities
WHERE source_url IS NULL OR confidence_score IS NULL

UNION ALL

SELECT 'competitor_changes',  count(*)
FROM competitor_changes
WHERE source_url IS NULL OR detected_at_utc IS NULL OR confidence_score IS NULL

UNION ALL

SELECT 'actions_recommended', count(*)
FROM actions_recommended
WHERE source_url IS NULL OR confidence_score IS NULL OR source_ids IS NULL
   OR array_length(source_ids, 1) IS NULL;
