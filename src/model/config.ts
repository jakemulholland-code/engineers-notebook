import { z } from "zod";

/** The five ink colours from the design tokens, in toolbar order. */
export const INK_COLOURS = [
  { id: "white", label: "White", value: "#F4F7FF" },
  { id: "mint", label: "Mint", value: "#01C6A3" },
  { id: "gold", label: "Gold", value: "#E8A828" },
  { id: "pink", label: "Pink", value: "#FF5C86" },
  { id: "pale-blue", label: "Pale blue", value: "#8FB8FF" },
] as const;

export const STROKE_WIDTHS = [2, 4, 8] as const;

export const TabConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  colour: z.string(),
  /** The folder the user chose; notes live in `<folder>/notes`. */
  folder: z.string().min(1),
  order: z.number(),
  archived: z.boolean().default(false),
  excludeFromAi: z.boolean().default(false),
});

export const AI_PROVIDERS = ["openrouter", "openai", "anthropic", "gemini", "custom"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export const PROVIDER_LABEL: Record<AiProviderId, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  custom: "Custom (OpenAI-compatible)",
};

/** AI choices. API keys are never stored here; they live in Windows Credential Manager. */
const AiSettingsSchema = z.object({
  provider: z.enum(AI_PROVIDERS).default("openrouter"),
  /** Chosen model id per provider. */
  models: z.record(z.string(), z.string()).default({}),
  customBaseUrl: z.string().default(""),
  lookAheadDays: z.number().default(14),
  staleDays: z.number().default(21),
  includeSnapshots: z.boolean().default(false),
  temperature: z.number().min(0).max(2).default(0.3),
});

/** Export defaults (SPEC: Settings, Export). An empty destination means Documents. */
const ExportSettingsSchema = z.object({
  format: z.enum(["markdown", "pdf", "both"]).default("both"),
  destination: z.string().default(""),
  includeImages: z.boolean().default(true),
  includeDone: z.boolean().default(true),
  printerFriendly: z.boolean().default(false),
});

export const AppConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  tabs: z.array(TabConfigSchema).default([]),
  lastOpened: z.object({ tabId: z.string().optional(), pageId: z.string().optional() }).default({}),
  general: z
    .object({
      gridSize: z.number().default(20),
      lockToGrid: z.boolean().default(true),
      inkColour: z.string().default(INK_COLOURS[0].value),
      strokeWidth: z.number().default(4),
      startWithWindows: z.boolean().default(false),
      checkForUpdates: z.boolean().default(true),
    })
    .default({
      gridSize: 20,
      lockToGrid: true,
      inkColour: INK_COLOURS[0].value,
      strokeWidth: 4,
      startWithWindows: false,
      checkForUpdates: true,
    }),
  ai: AiSettingsSchema.default(AiSettingsSchema.parse({})),
  export: ExportSettingsSchema.default(ExportSettingsSchema.parse({})),
});

export type ExportSettings = z.infer<typeof ExportSettingsSchema>;

export type AiSettings = z.infer<typeof AiSettingsSchema>;

export type TabConfig = z.infer<typeof TabConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

export function defaultConfig(): AppConfig {
  return AppConfigSchema.parse({});
}

/** Parses config text, falling back to defaults for anything missing or broken. */
export function parseConfig(text: string | null): AppConfig {
  if (!text) return defaultConfig();
  try {
    const r = AppConfigSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : defaultConfig();
  } catch {
    return defaultConfig();
  }
}
