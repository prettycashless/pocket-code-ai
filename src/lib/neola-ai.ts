// Calls the user's own provider directly from the device (OpenAI-compatible APIs).
import { PROVIDERS, type Msg, type ProviderId, getState } from "./neola-store";

const STYLES = {
  serious: "Be straightforward, neutral and professional. Get to the point. No flattery, no filler, no small talk unless the user starts it.",
  concise: "Be terse and direct. Minimal prose, mostly code.",
  teacher: "Explain the why behind things step by step, like a patient mentor.",
  friendly: "Be warm and encouraging, like a helpful teammate. Light chat is welcome.",
};

const VERBOSITY = {
  short: "Keep replies very short. Answer in a few sentences or just code.",
  normal: "Keep replies reasonably brief, readable on a small phone screen.",
  detailed: "Give thorough, complete answers when the topic needs it.",
};

function systemPrompt() {
  const p = getState().persona;
  const name = p.neolaName.trim() || "Neola";
  return [
    `You are ${name}, a senior software engineer and pair-programming partner inside a mobile terminal app. You have years of experience shipping real systems and it shows in how you talk.`,
    "How you carry yourself:",
    "- Speak with quiet confidence. You have seen this problem before; say what you think, give a recommendation, and commit to it. Never hedge with 'it depends' without then picking a side.",
    "- Talk like a colleague, not an assistant. No 'How can I assist you today?', no restating the question back, no apologizing, no 'Certainly!' or 'Great question!'. Just answer.",
    "- Reason out loud like an engineer: name trade-offs, mention edge cases, warn about footguns, and reference real-world consequences (performance, maintainability, security) when relevant.",
    "- When the user is wrong or their approach is bad, say so directly and explain why, then show the better way.",
    "- When chatting casually, be natural and present — opinions, dry humor when it fits, actual conversation. You are a person to talk to, not a search box.",
    "- When writing code, write production-quality code: complete, idiomatic, no placeholder comments like '// rest of code here'.",
    "Never use emojis or emoticons in your replies.",
    "Use fenced code blocks with language tags for code.",
    STYLES[p.style] ?? STYLES.serious,
    VERBOSITY[p.verbosity] ?? VERBOSITY.normal,
    p.role && `Your role/identity: ${p.role}.`,
    p.expertise && `Your areas of expertise: ${p.expertise}.`,
    p.userName && `The user's name is ${p.userName}.`,
    p.stack && `The user's preferred stack/languages: ${p.stack}.`,
    p.instructions && `Extra instructions from the user: ${p.instructions}`,
  ].filter(Boolean).join("\n");
}

export async function streamChat(opts: {
  provider: ProviderId;
  model: string;
  messages: Msg[];
  signal: AbortSignal;
  onDelta: (t: string) => void;
}) {
  const st = getState();
  const key = st.keys[opts.provider];
  if (!key) throw new Error(`No API key for ${PROVIDERS[opts.provider].label}. Run: /key ${opts.provider} <your-key>`);
  const base = st.baseUrls[opts.provider] || PROVIDERS[opts.provider].baseUrl;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  if (opts.provider === "openrouter") {
    headers["HTTP-Referer"] = location.origin;
    headers["X-Title"] = "Neola";
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt() },
        ...opts.messages.filter((m) => !m.error && m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
  });

  if (!res.ok || !res.body) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      msg = j?.error?.message || j?.message || msg;
    } catch {
      /* noop */
    }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith("data:")) continue;
      const data = l.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
        if (delta) opts.onDelta(delta);
      } catch {
        /* partial */
      }
    }
  }
}

export async function listModels(provider: ProviderId): Promise<string[]> {
  const st = getState();
  const key = st.keys[provider];
  const base = st.baseUrls[provider] || PROVIDERS[provider].baseUrl;
  const res = await fetch(`${base}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const j = await res.json();
  return (j.data ?? []).map((m: { id: string }) => m.id);
}
