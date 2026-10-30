import { intelligenceProvider, type Settings } from "../data/model.ts";

export const LOCAL_DECIDER_BASE = "hf.co/ggml-org/Clef-Flash-GGUF:Q4_K_M";
export const LOCAL_READER_BASE = "qwen3.5:4b-q4_K_M";
// Keep Clef's original runner metadata; Ollama currently loses it on create.
export const LOCAL_DECIDER = LOCAL_DECIDER_BASE;
/** The extraction alias sets context without changing Ollama's global defaults. */
export const LOCAL_READER = "wilmai-qwen35-4b-q4:latest";
export const LOCAL_CONTEXT = 16384;
/** Reserved native IPC origin: it is never used as a network destination. */
export const MANAGED_ENDPOINT = "http://127.0.0.1:0";
export const OLLAMA_MINIMUM = "0.35.1";

/** Local test packs share a bounded context and keep both roles local. */
export const LOCAL_MODEL_PROFILES = {
  small: {
    decision: LOCAL_DECIDER,
    decisionQuantization: "Q4_K_M",
    readingBase: LOCAL_READER_BASE,
    reading: LOCAL_READER,
    minimumDiskGiB: 14,
    templateURL: "https://huggingface.co/Qwen/Qwen3.5-4B/resolve/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a/chat_template.jinja",
    decisionWeights: { sha256: "fd3e90605e8103307dca37cb5a8cdb036267e2fe3cb2d908d80a8ceb9ec0638c", bytes: 6486448288 },
    readingWeights: { sha256: "a9d0a3e1d8c91732a3812becd31f8d4a8ff57414903f226306069f0437e2ac50", bytes: 2648593216 },
  },
  medium: {
    decision: "hf.co/ggml-org/Clef-Flash-GGUF:Q8_0",
    decisionQuantization: "Q8_0",
    readingBase: "qwen3.5:9b-q4_K_M",
    reading: "wilmai-qwen35-9b-q4:latest",
    minimumDiskGiB: 20,
    templateURL: "https://huggingface.co/Qwen/Qwen3.5-9B/resolve/c202236235762e1c871ad0ccb60c8ee5ba337b9a/chat_template.jinja",
    decisionWeights: { sha256: "d7c352faf1bdd9ea24d0b9347e8eb1eb4bbadeff6c02383bf750215a74f2f1f1", bytes: 9657260192 },
    readingWeights: { sha256: "02d45dc1cf451ba2475ac33b301c2dd8f985abe4c182ce04a1f2f5bf0260278d", bytes: 5629109120 },
  },
} as const;
export type LocalModelProfile = keyof typeof LOCAL_MODEL_PROFILES;

// The provider controls both roles. Model fields cannot opt a single role into
// local processing while the other role uses a cloud provider.
export const localDecisions = (s: Settings) => intelligenceProvider(s) === "local";
export const localReading = localDecisions;
export const usesLocalAI = (s: Settings) => localDecisions(s) || localReading(s);
export const localEndpoint = (s: Settings) => s.localAI?.endpoint ?? "http://127.0.0.1:11434";

/** No remote hosts, credentials, paths or redirects in the local transport. */
export function ollamaEndpoint(value: string): string {
  const u = new URL(value);
  if (u.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(u.hostname) || u.username || u.password || u.pathname !== "/" || u.search || u.hash) {
    throw new Error("Ollama must use an HTTP loopback address, such as http://127.0.0.1:11434.");
  }
  return u.origin;
}

export function versionAtLeast(version: string, minimum = OLLAMA_MINIMUM): boolean {
  const parse = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number);
  const a = parse(version), b = parse(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

/** Every inference-affecting setting belongs in the cache identity. */
export function providerIdentity(s: Settings): string {
  return JSON.stringify({
    decision: localDecisions(s) ? s.localAI?.decisionModel ?? LOCAL_DECIDER : s.decider === "jev" ? s.jevModel : s.decisionsModel ?? "gpt-6-luna",
    reading: localReading(s) ? s.localAI?.readingModel ?? LOCAL_READER : s.readingModel,
    local: usesLocalAI(s) ? [localEndpoint(s), s.localAI?.fingerprint ?? "unchecked", LOCAL_CONTEXT, s.localAI?.think ?? true] : null,
    // Only Claude's answers say so, so OpenAI's and local AI's earlier answers keep their identity (and aren't read again).
    provider: intelligenceProvider(s) === "anthropic" ? "anthropic" : undefined,
  });
}
