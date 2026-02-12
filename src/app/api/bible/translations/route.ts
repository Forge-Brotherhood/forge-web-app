import { NextResponse } from "next/server";
import { BIBLE_TRANSLATIONS } from "@/core/models/bibleModels";
import {
  getBibleProvider,
  getCurrentProviderType,
  getAvailableTranslations,
  getDefaultTranslation,
} from "@/lib/bible/providers";

/**
 * GET /api/bible/translations
 *
 * Returns available Bible translations for the current provider.
 * Public endpoint - same for all users.
 */
export async function GET() {
  try {
    const providerType = getCurrentProviderType();
    const provider = getBibleProvider();
    const availableCodes = getAvailableTranslations(providerType);
    const defaultTranslation = getDefaultTranslation(providerType);

    const translations = availableCodes.map((code) => ({
      code,
      name: BIBLE_TRANSLATIONS[code as keyof typeof BIBLE_TRANSLATIONS]?.name ?? code,
    }));

    return NextResponse.json(
      {
        translations,
        provider: provider.name,
        defaultTranslation,
      },
      {
        headers: {
          // Cache for 1 hour - translations don't change often
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      }
    );
  } catch (error) {
    console.error("Error fetching translations:", error);

    return NextResponse.json(
      { error: "Failed to fetch translations" },
      { status: 500 }
    );
  }
}
