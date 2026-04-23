// Shared episodic memory helpers for all agents

const MAX_EPISODES = 30;
const MAX_MESSAGES = 20;

export interface Episode {
  agent: string;
  timestamp: string;
  run_summary: string;
  key_findings: string[];
  watch_next: string[];
  data_quality: number;
  signals_count: number;
}

export interface AgentMessage {
  from_agent: string;
  to_agent: string;      // 'all' = broadcast
  priority: 'critical' | 'high' | 'normal';
  subject: string;
  body: string;
  timestamp: string;
  expires_at: string;    // messages expire after 48h
  acted_on: boolean;
}

export interface PromptScore {
  agent: string;
  run_count: number;
  avg_quality: number;
  last_score: number;
  improvement_notes: string[];
  last_updated: string;
}

// ---- READ ----

export function readEpisodes(sectorKnowledge: any): Episode[] {
  try {
    return JSON.parse(sectorKnowledge?.agent_episodic_memory || '[]');
  } catch {
    return [];
  }
}

export function readMessages(sectorKnowledge: any, forAgent: string): AgentMessage[] {
  try {
    const all: AgentMessage[] = JSON.parse(sectorKnowledge?.agent_message_queue || '[]');
    const now = new Date().toISOString();
    return all.filter(m =>
      !m.acted_on &&
      m.expires_at > now &&
      (m.to_agent === forAgent || m.to_agent === 'all')
    );
  } catch {
    return [];
  }
}

export function readPromptScores(sectorKnowledge: any): Record<string, PromptScore> {
  try {
    return JSON.parse(sectorKnowledge?.agent_prompt_scores || '{}');
  } catch {
    return {};
  }
}

// ---- WRITE ----

export function buildEpisodeUpdate(existing: Episode[], newEpisode: Episode): string {
  const updated = [newEpisode, ...existing].slice(0, MAX_EPISODES);
  return JSON.stringify(updated);
}

export function buildMessageUpdate(existing: AgentMessage[], newMessages: AgentMessage[]): string {
  const now = new Date().toISOString();
  const active = existing.filter(m => m.expires_at > now && !m.acted_on);
  const updated = [...newMessages, ...active].slice(0, MAX_MESSAGES);
  return JSON.stringify(updated);
}

export function buildPromptScoreUpdate(
  existing: Record<string, PromptScore>,
  agent: string,
  score: number,
  improvementNote?: string
): string {
  const prev = existing[agent] || {
    agent,
    run_count: 0,
    avg_quality: 0,
    last_score: 0,
    improvement_notes: [],
    last_updated: '',
  };
  const newAvg = Math.round((prev.avg_quality * prev.run_count + score) / (prev.run_count + 1));
  const notes = improvementNote
    ? [...prev.improvement_notes.slice(-4), improvementNote]
    : prev.improvement_notes;
  const updated = {
    ...existing,
    [agent]: {
      agent,
      run_count: prev.run_count + 1,
      avg_quality: newAvg,
      last_score: score,
      improvement_notes: notes,
      last_updated: new Date().toISOString(),
    },
  };
  return JSON.stringify(updated);
}

export function markMessagesActedOn(existing: AgentMessage[], agentName: string): string {
  const updated = existing.map(m =>
    (m.to_agent === agentName || m.to_agent === 'all') ? { ...m, acted_on: true } : m
  );
  return JSON.stringify(updated);
}

// ---- HELPERS ----

/** Parse all current messages from raw JSON string */
export function parseMessages(raw: string): AgentMessage[] {
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}
