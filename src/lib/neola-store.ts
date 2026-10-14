// Local-only persistence for Neola (sessions, keys, models, projects).
import { useSyncExternalStore } from "react";

export type ProviderId = "mistral" | "muse" | "groq" | "openrouter";

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  baseUrl: string;
  defaultModel: string;
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  mistral: { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", defaultModel: "codestral-latest" },
  muse: { id: "muse", label: "Muse Spark", baseUrl: "https://api.llama.com/compat/v1", defaultModel: "muse-spark" },
  groq: { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile" },
  openrouter: { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4o-mini" },
};

export interface Msg {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  at: number;
  error?: boolean;
}

export interface Session {
  id: string;
  title: string;
  project: string | null;
  provider: ProviderId;
  model: string;
  messages: Msg[];
  createdAt: number;
  updatedAt: number;
}

export interface NeolaState {
  keys: Partial<Record<ProviderId, string>>;
  baseUrls: Partial<Record<ProviderId, string>>;
  provider: ProviderId;
  model: string;
  projects: string[];
  history: string[];
  sessions: Session[];
}

const KEY = "neola:v1";
const empty: NeolaState = {
  keys: {},
  baseUrls: {},
  provider: "groq",
  model: PROVIDERS.groq.defaultModel,
  projects: [],
  history: [],
  sessions: [],
};

let state: NeolaState = empty;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...empty, ...JSON.parse(raw) };
  } catch {
    /* ignore corrupt data */
  }
}

export function getState() {
  load();
  return state;
}

export function setState(fn: (s: NeolaState) => NeolaState) {
  load();
  state = fn(state);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota */
  }
  listeners.forEach((l) => l());
}

export function useNeola() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getState,
    () => empty,
  );
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function createSession(project: string | null = null): string {
  const s = getState();
  const id = uid();
  const now = Date.now();
  setState((st) => ({
    ...st,
    sessions: [
      { id, title: "new session", project, provider: s.provider, model: s.model, messages: [], createdAt: now, updatedAt: now },
      ...st.sessions,
    ],
  }));
  return id;
}

export function updateSession(id: string, fn: (s: Session) => Session) {
  setState((st) => ({
    ...st,
    sessions: st.sessions.map((x) => (x.id === id ? { ...fn(x), updatedAt: Date.now() } : x)),
  }));
}

export function deleteSession(id: string) {
  setState((st) => ({ ...st, sessions: st.sessions.filter((x) => x.id !== id) }));
}

export function exportData() {
  return JSON.stringify({ ...getState(), keys: {} }, null, 2);
}
