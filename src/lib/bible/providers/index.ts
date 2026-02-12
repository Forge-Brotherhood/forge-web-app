/**
 * Bible Provider Factory
 *
 * Creates the appropriate Bible provider based on BIBLE_API_PROVIDER env var.
 */

import { type BibleProvider, type BibleProviderType, BibleProviderError } from './types';
import { AoLabBibleProvider } from './aoLabProvider';
import { ApiBibleProvider } from './apiBibleProvider';

// Re-export types and utilities
export { type BibleProvider, type BibleProviderType, BibleProviderError } from './types';
export {
  SUPPORTED_TRANSLATIONS,
  type SupportedTranslation,
  getAvailableTranslations,
  getDefaultTranslation,
} from './translationMaps';

/**
 * Default provider when BIBLE_API_PROVIDER is not set.
 */
const DEFAULT_PROVIDER: BibleProviderType = 'aolab';

/**
 * Cached provider instance.
 */
let cachedProvider: BibleProvider | null = null;
let cachedProviderType: BibleProviderType | null = null;

/**
 * Get the current provider type from environment.
 */
export function getCurrentProviderType(): BibleProviderType {
  const envProvider = process.env.BIBLE_API_PROVIDER?.toLowerCase().trim();

  if (envProvider === 'apibible' || envProvider === 'api.bible') {
    return 'apibible';
  }

  if (envProvider === 'aolab' || envProvider === 'ao-lab' || envProvider === 'helloao') {
    return 'aolab';
  }

  // Default to aolab if not specified or unrecognized
  return DEFAULT_PROVIDER;
}

/**
 * Create a new provider instance for the given type.
 */
function createProvider(type: BibleProviderType): BibleProvider {
  switch (type) {
    case 'aolab':
      return new AoLabBibleProvider();
    case 'apibible':
      return new ApiBibleProvider();
    default:
      throw new BibleProviderError(
        `Unknown Bible provider type: ${type}`,
        500,
        'factory'
      );
  }
}

/**
 * Get the Bible provider instance.
 * Uses cached instance if available and provider type hasn't changed.
 */
export function getBibleProvider(): BibleProvider {
  const currentType = getCurrentProviderType();

  // Return cached instance if type matches
  if (cachedProvider && cachedProviderType === currentType) {
    return cachedProvider;
  }

  // Create new instance
  cachedProvider = createProvider(currentType);
  cachedProviderType = currentType;

  console.log(`[BibleProvider] Using ${currentType} provider`);

  return cachedProvider;
}

/**
 * Reset the cached provider (useful for testing).
 */
export function resetBibleProvider(): void {
  cachedProvider = null;
  cachedProviderType = null;
}
