/**
 * Supported generation models, normalized names + aliases.
 *
 * Image: gpt-image-2-6/flare-text-to-image
 * Video: grok-imagine-video-1-5-preview
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
}

export const MODELS: ModelSpec[] = [
  {
    id: "gpt-image-2-6/flare-text-to-image",
    kind: "image",
    aliases: ["gpt-image-2.6/flare-text-to-image", "gpt-image-2-6", "gpt-image-2.6"],
    provider: "kie",
    description: "High-resolution social media image generator optimized for posts, thumbnails, and ad banners.",
  },
  {
    id: "grok-imagine-video-1-5-preview",
    kind: "video",
    aliases: ["grok-imagine-video-1.5-preview", "grok-imagine-video-1-5", "grok-imagine-video-1.5", "grok-imagine"],
    provider: "kie",
    description: "AI video generator with native audio for Reels, TikToks, and Shorts.",
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
  const m = MODELS.find((x) => x.kind === kind);
  if (!m) throw new Error(`No model registered for kind ${kind}`);
  return m;
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
