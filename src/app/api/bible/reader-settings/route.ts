import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// Valid enum values
const VALID_FONT_TYPES = ["serif", "sansSerif"] as const;
const VALID_LINE_SPACINGS = ["compact", "normal", "relaxed"] as const;
const VALID_THEMES = ["light", "sepia", "dark"] as const;
const VALID_COLORS = ["yellow", "green", "blue", "pink", "orange"] as const;
const VALID_TRANSLATIONS = ["BSB", "KJV", "WEB", "ASV", "CEV"] as const;

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
};

// GET /api/bible/reader-settings
// Returns user's reader settings (or defaults if none exist)
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Get settings or return defaults
    const settings = await prisma.readerSettings.findUnique({
      where: { userId: user.id },
    });

    if (!settings) {
      return NextResponse.json({
        success: true,
        settings: DEFAULT_SETTINGS,
      });
    }

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
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const validatedData = updateSettingsSchema.parse(body);

    // Upsert settings (create if doesn't exist, update if exists)
    const settings = await prisma.readerSettings.upsert({
      where: { userId: user.id },
      update: validatedData,
      create: {
        userId: user.id,
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
