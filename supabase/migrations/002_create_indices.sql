-- ============================================================
-- OTXEngine — Phase 1.2: Performance indices
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_signals_biz_time    ON signals_raw(business_id, detected_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_classified_biz       ON classified_signals(business_id, processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trends_sector        ON sector_trends(sector, detected_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_events_date          ON events_raw(event_date);
CREATE INDEX IF NOT EXISTS idx_actions_biz_score    ON actions_recommended(business_id, action_score DESC);
CREATE INDEX IF NOT EXISTS idx_memory_sector        ON global_memory_aggregates(agg_type, dimension_key, action_type);
CREATE INDEX IF NOT EXISTS idx_heartbeat_agent      ON agent_heartbeat(agent_name, last_ping_utc DESC);
