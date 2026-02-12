/**
 * Translation ID Mappings
 *
 * Maps Forge translation codes to provider-specific IDs.
 */

import type { BibleProviderType } from './types';

/**
 * Forge-supported translations.
 *
 * Note: BSB is only available via AO Lab provider.
 * NLT is only available via api.bible provider.
 */
export const SUPPORTED_TRANSLATIONS = ['BSB', 'KJV', 'WEB', 'ASV', 'NLT'] as const;
export type SupportedTranslation = (typeof SUPPORTED_TRANSLATIONS)[number];

/**
 * AO Lab translation IDs.
 * From: https://bible.helloao.org/api/available_translations.json
 *
 * Note: NLT is not available on AO Lab, falls back to BSB.
 */
export const AO_LAB_TRANSLATION_IDS: Record<SupportedTranslation, string> = {
  BSB: 'BSB',
  KJV: 'eng_kjv',
  WEB: 'ENGWEBP',
  ASV: 'eng_asv',
  NLT: 'BSB', // NLT not available on AO Lab, fallback to BSB
};

/**
 * api.bible translation IDs.
 * Retrieved via: GET https://rest.api.bible/v1/bibles
 *
 * Note: BSB is not available on api.bible, falls back to NLT.
 */
export const API_BIBLE_TRANSLATION_IDS: Record<SupportedTranslation, string> = {
  BSB: 'd6e14a625393b4da-01', // BSB not available, fallback to NLT
  KJV: 'de4e12af7f28f599-01', // King James (Authorised) Version
  WEB: '9879dbb7cfe39e4d-01', // World English Bible
  ASV: '06125adad2d5898a-01', // The Holy Bible, American Standard Version
  NLT: 'd6e14a625393b4da-01', // New Living Translation
};

/**
 * Get provider-specific translation ID.
 */
export function getProviderTranslationId(
  provider: BibleProviderType,
  translation: string
): string {
  const normalized = translation.trim().toUpperCase() as SupportedTranslation;

  if (provider === 'aolab') {
    return AO_LAB_TRANSLATION_IDS[normalized] ?? AO_LAB_TRANSLATION_IDS.BSB;
  }

  if (provider === 'apibible') {
    return API_BIBLE_TRANSLATION_IDS[normalized] ?? API_BIBLE_TRANSLATION_IDS.BSB;
  }

  return normalized;
}

/**
 * Check if a translation is supported.
 */
export function isTranslationSupported(translation: string): boolean {
  const normalized = translation.trim().toUpperCase();
  return SUPPORTED_TRANSLATIONS.includes(normalized as SupportedTranslation);
}

/**
 * Translations actually available on each provider (no fallbacks).
 * Used by /api/bible/translations endpoint to return provider-specific options.
 */
export const AO_LAB_AVAILABLE_TRANSLATIONS = ['BSB', 'KJV', 'WEB', 'ASV'] as const;
export const API_BIBLE_AVAILABLE_TRANSLATIONS = ['NLT', 'KJV', 'WEB', 'ASV'] as const;

/**
 * Get available translations for a provider.
 */
export function getAvailableTranslations(provider: BibleProviderType): readonly string[] {
  if (provider === 'aolab') {
    return AO_LAB_AVAILABLE_TRANSLATIONS;
  }
  if (provider === 'apibible') {
    return API_BIBLE_AVAILABLE_TRANSLATIONS;
  }
  return SUPPORTED_TRANSLATIONS;
}

/**
 * Get the default translation for a provider.
 */
export function getDefaultTranslation(provider: BibleProviderType): string {
  if (provider === 'aolab') {
    return 'BSB';
  }
  if (provider === 'apibible') {
    return 'NLT';
  }
  return 'BSB';
}
