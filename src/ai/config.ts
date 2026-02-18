/**
 * AI configuration management via conf package.
 * Provides persistent storage of LLM provider settings.
 */

export interface SkejjConfig {
  provider: string;
  model: string;
  apiKey?: string;
}

type ConfStore = {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  store: Record<string, unknown>;
};

async function getConf(): Promise<ConfStore> {
  // Dynamic import: conf is ESM-only
  const { default: Conf } = await import('conf') as { default: new (opts: { projectName: string }) => ConfStore };
  return new Conf({ projectName: 'skejj' });
}

/**
 * Load the persisted AI config. Returns null if provider is not set.
 */
export async function loadAiConfig(): Promise<SkejjConfig | null> {
  const conf = await getConf();
  const provider = conf.get<string>('provider');
  if (!provider) return null;
  return {
    provider,
    model: conf.get<string>('model') ?? '',
    apiKey: conf.get<string>('apiKey'),
  };
}

/**
 * Set a single key in the AI config store.
 */
export async function setAiConfig(key: string, value: string): Promise<void> {
  const validKeys = ['provider', 'model', 'apiKey'];
  if (!validKeys.includes(key)) {
    throw new Error(`Unknown config key: "${key}". Valid keys: ${validKeys.join(', ')}`);
  }
  const conf = await getConf();
  conf.set(key, value);
}

/**
 * Returns all stored config values.
 * Masks apiKey: shows only the last 4 characters.
 */
export async function showAiConfig(): Promise<Record<string, string>> {
  const conf = await getConf();
  const store = conf.store;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(store)) {
    if (k === 'apiKey' && typeof v === 'string' && v.length > 4) {
      result[k] = '****' + v.slice(-4);
    } else {
      result[k] = String(v);
    }
  }
  return result;
}
