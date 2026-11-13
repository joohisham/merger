/**
 * Supported generation models, normalized names + aliases.
 *
 * Default image model: gpt-image-2-6/economy-text-to-image (5 credits/image ≈ $0.025)
 *   - Same GPT Image 2.6 family as the "flare" variant but per-image pricing
 *     instead of per-token, making it 6-7x cheaper for typical social media work.
 *   - With 80 credits you can generate ~16 images. The "flare" model costs
 *     ~30-36 credits per image (token-based) so it doesn't fit small budgets.
 *
 * Premium image model: gpt-image-2-6/flare-text-to-image (token-based, ~$0.025-0.035/image)
 *   - Available via explicit `model` parameter; better quality + supports edits.
 *
 * Video: grok-imagine-video-1-5-preview (2.4 credits/second ≈ $0.012)
 *
 * Aliases are accepted at the API/MCP boundary and normalized before use.
 */

export type ModelKind = "image" | "video";

export interface ModelSpec {
  id: string;                 // canonical model id sent to provider
  kind: ModelKind;
  aliases: string[];          // accepted alternative spellings
  provider: "kie" | "cometapi";
  description: string;
  creditsPerUnit: string;     // human-readable cost (e.g. "5 credits/image")
  isDefault?: boolean;        // marks the default model for its kind
}

export const MODELS: ModelSpec[] = [
  {
    id: "gpt-image-2-6/economy-text-to-image",
    kind: "image",
    aliases: [
      "gpt-image-2.6/economy-text-to-image",
      "gpt-image-2-6-economy",
      "gpt-image-2.6-economy",
      "gpt-image-2-6-economy-text-to-image",
      "economy",
    ],
    provider: "kie",
    description:
      "GPT Image 2.6 Economy — same family as Flare but per-image pricing. Best value for budget workflows.",
    creditsPerUnit: "5 credits/image (≈ $0.025)",
    isDefault: true,
  },
  {
    id: "gpt-image-2-6/flare-text-to-image",
    kind: "image",
    aliases: [
      "gpt-image-2.6/flare-text-to-image",
      "gpt-image-2-6",
      "gpt-image-2.6",
      "flare",
    ],
    provider: "kie",
    description:
      "GPT Image 2.6 Flare — premium quality, token-based pricing (~30-36 credits/image). Better for high-end editorial / advertising work.",
    creditsPerUnit: "36 credits / 1M output tokens (≈ $0.18/1M)",
  },
  {
    id: "grok-imagine-video-1-5-preview",
    kind: "video",
    aliases: [
      "grok-imagine-video-1.5-preview",
      "grok-imagine-video-1-5",
      "grok-imagine-video-1.5",
      "grok-imagine",
    ],
    provider: "kie",
    description: "AI video generator with native audio for Reels, TikToks, and Shorts.",
    creditsPerUnit: "2.4 credits/second (≈ $0.012)",
    isDefault: true,
  },
];

export function resolveModel(input: string): ModelSpec | null {
  if (!input) return null;
  const norm = input.trim().toLowerCase();
  for (const m of MODELS) {
    if (m.id.toLowerCase() === norm) return m;
    if (m.aliases.some((a) => a.toLowerCase() === norm)) return m;
  }
  // Partial contains match (case-insensitive) for convenience
  for (const m of MODELS) {
    if (norm.includes(m.id.toLowerCase())) return m;
    if (m.aliases.some((a) => norm.includes(a.toLowerCase()))) return m;
  }
  return null;
}

export function defaultModelForKind(kind: ModelKind): ModelSpec {
  // Prefer the model flagged isDefault; fall back to first of that kind.
  const def = MODELS.find((x) => x.kind === kind && x.isDefault);
  if (def) return def;
  const any = MODELS.find((x) => x.kind === kind);
  if (!any) throw new Error(`No model registered for kind ${kind}`);
  return any;
}

/**
 * Social media aspect ratio presets per platform.
 * Mapped to provider width/height when applicable.
 */
export interface AspectPreset {
  platform: string;
  label: string;
  ratio: string;          // "9:16"
  width: number;
  height: number;
}

export const SOCIAL_PRESETS: AspectPreset[] = [
  { platform: "tiktok", label: "TikTok / Reels / Shorts", ratio: "9:16", width: 1080, height: 1920 },
  { platform: "instagram", label: "Instagram Feed (Square)", ratio: "1:1", width: 1080, height: 1080 },
  { platform: "instagram", label: "Instagram Portrait", ratio: "4:5", width: 1080, height: 1350 },
  { platform: "youtube", label: "YouTube / LinkedIn / Facebook", ratio: "16:9", width: 1920, height: 1080 },
  { platform: "twitter", label: "Twitter / X Banner", ratio: "16:9", width: 1920, height: 1080 },
  { platform: "twitter", label: "Twitter / X Post", ratio: "2:1", width: 1600, height: 800 },
  { platform: "facebook", label: "Facebook Landscape", ratio: "16:9", width: 1920, height: 1080 },
  { platform: "linkedin", label: "LinkedIn Cover", ratio: "4:1", width: 1584, height: 396 },
];

export function presetForPlatform(platform?: string): AspectPreset | null {
  if (!platform || platform === "all") return null;
  return SOCIAL_PRESETS.find((p) => p.platform === platform) || null;
}
