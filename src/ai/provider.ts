/**
 * LLM provider factory.
 * Resolves provider, model and API key from config + environment variables (12-factor).
 * Environment variable overrides: SKEJJ_PROVIDER, SKEJJ_MODEL, SKEJJ_API_KEY
 */

import type { LanguageModel } from 'ai';
import type { SkejjConfig } from './config.js';

/**
 * Build a LanguageModel instance from config + env var overrides.
 * Throws clearly if provider is unknown or API key is missing.
 */
export async function buildModel(config: SkejjConfig | null): Promise<LanguageModel> {
  // 12-factor: env vars override config file
  const provider = process.env.SKEJJ_PROVIDER ?? config?.provider ?? '';
  const model = process.env.SKEJJ_MODEL ?? config?.model ?? '';
  const apiKey = process.env.SKEJJ_API_KEY ?? config?.apiKey;

  if (!apiKey) {
    throw new Error(
      'No API key configured. Set SKEJJ_API_KEY env var or run: skejj config set apiKey <key>',
    );
  }

  switch (provider) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      const openai = createOpenAI({ apiKey });
      return openai(model || 'gpt-4o');
    }
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      const anthropic = createAnthropic({ apiKey });
      return anthropic(model || 'claude-sonnet-4-20250514');
    }
    default:
      throw new Error(
        `Unknown provider: "${provider}". Supported: openai, anthropic`,
      );
  }
}
