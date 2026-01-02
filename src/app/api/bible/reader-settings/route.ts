import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// Valid enum values
const VALID_FONT_TYPES = ["serif", "sansSerif"] as const;
const VALID_LINE_SPACINGS = ["compact", "normal", "relaxed"] as const;
const VALID_THEMES = ["light", "sepia", "dark"] as const;
const VALID_COLORS = ["yellow", "green", "blue", "pink", "orange"] as const;
const VALID_TRANSLATIONS = ["BSB", "KJV", "WEB", "ASV"] as const;

// Validation schema for PATCH (all fields optional for partial updates)
const updateSettingsSchema = z.object({
  fontSize: z.number().min(12).max(32).optional(),
  fontType: z.enum(VALID_FONT_TYPES).optional(),
  lineSpacing: z.enum(VALID_LINE_SPACINGS).optional(),
  theme: z.enum(VALID_THEMES).optional(),
  showWordsOfJesusInRed: z.boolean().optional(),
  lastHighlightColor: z.enum(VALID_COLORS).optional(),
  highlightColorOrder: z.array(z.enum(VALID_COLORS)).length(5).optional(),
  selectedTranslation: z.enum(VALID_TRANSLATIONS).optional(),
  hiddenNoteGroups: z.array(z.string().uuid()).optional(),
});

// Default settings
const DEFAULT_SETTINGS = {
  fontSize: 19,
  fontType: "serif",
  lineSpacing: "normal",
  theme: "light",
  showWordsOfJesusInRed: true,
  lastHighlightColor: "yellow",
  highlightColorOrder: ["yellow", "green", "blue", "pink", "orange"],
  selectedTranslation: "BSB",
  hiddenNoteGroups: [] as string[],
};

// GET /api/bible/reader-settings
// Returns user's reader settings (or defaults if none exist)
export async function GET() {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get settings or return defaults
    const settings = await prisma.readerSettings.findUnique({
      where: { userId: authResult.userId },
    });

    if (!settings) {
      return NextResponse.json({
        success: true,
        settings: DEFAULT_SETTINGS,
      });
    }

    const safeTranslation = VALID_TRANSLATIONS.includes(settings.selectedTranslation as any)
      ? settings.selectedTranslation
      : DEFAULT_SETTINGS.selectedTranslation;

    return NextResponse.json({
      success: true,
      settings: {
        fontSize: settings.fontSize,
        fontType: settings.fontType,
        lineSpacing: settings.lineSpacing,
        theme: settings.theme,
        showWordsOfJesusInRed: settings.showWordsOfJesusInRed,
        lastHighlightColor: settings.lastHighlightColor,
        highlightColorOrder: settings.highlightColorOrder,
        selectedTranslation: safeTranslation,
        hiddenNoteGroups: settings.hiddenNoteGroups,
      },
    });
  } catch (error) {
    console.error("Error fetching reader settings:", error);
    return NextResponse.json(
      { error: "Failed to fetch reader settings" },
      { status: 500 }
    );
  }
}

// PATCH /api/bible/reader-settings
// Update user's reader settings (creates if doesn't exist)
export async function PATCH(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validatedData = updateSettingsSchema.parse(body);

    // Upsert settings (create if doesn't exist, update if exists)
    const settings = await prisma.readerSettings.upsert({
      where: { userId: authResult.userId },
      update: validatedData,
      create: {
        userId: authResult.userId,
        ...DEFAULT_SETTINGS,
        ...validatedData,
      },
    });

    return NextResponse.json({
      success: true,
      settings: {
        fontSize: settings.fontSize,
        fontType: settings.fontType,
        lineSpacing: settings.lineSpacing,
        theme: settings.theme,
        showWordsOfJesusInRed: settings.showWordsOfJesusInRed,
        lastHighlightColor: settings.lastHighlightColor,
        highlightColorOrder: settings.highlightColorOrder,
        selectedTranslation: settings.selectedTranslation,
        hiddenNoteGroups: settings.hiddenNoteGroups,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating reader settings:", error);
    return NextResponse.json(
      { error: "Failed to update reader settings" },
      { status: 500 }
    );
  }
}
