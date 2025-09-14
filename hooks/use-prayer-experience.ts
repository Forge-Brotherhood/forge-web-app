import { useState, useEffect, useCallback } from "react";
import { usePrayerListQuery } from "./use-prayer-list-query";
import prayerConfig from "@/config/prayer-experience.json";

export interface Stage {
  id: string;
  type: "breathing" | "reflection" | "prayer" | "wrap-up";
  duration?: number;
  autoProgress: boolean;
  content: any;
  prayerData?: any;
}

export function usePrayerExperience() {
  const { data: prayerListData, refetch, isLoading: isPrayersLoading } = usePrayerListQuery();
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [stages, setStages] = useState<Stage[]>([]);

  // Build stages whenever prayer data changes
  useEffect(() => {
    if (!prayerListData) return;

    const configStages = [...prayerConfig.stages];
    const reflectionStage = configStages.find(s => s.type === "reflection");
    const wrapUpStage = configStages.find(s => s.type === "wrap-up");

    // Build stages array: reflection -> prayers -> wrap-up
    const finalStages: Stage[] = [];

    // Only build stages if there are prayers
    if (prayerListData.items && prayerListData.items.length > 0) {
      // Add reflection stage with random theme
      if (reflectionStage && prayerConfig.reflectionThemes) {
        const randomTheme = prayerConfig.reflectionThemes[
          Math.floor(Math.random() * prayerConfig.reflectionThemes.length)
        ];
        finalStages.push({
          ...reflectionStage,
          type: reflectionStage.type as Stage["type"],
          content: randomTheme
        });
      }

      // Add prayer stages from API data
      // Take first 5 prayers for now
      const prayers = prayerListData.items.slice(0, 5);

      prayers.forEach((item, index) => {
        const authorName = item.thread.isAnonymous
          ? "Someone"
          : item.thread.author?.firstName || "Someone";

        finalStages.push({
          id: `prayer-${index}`,
          type: "prayer",
          autoProgress: false,
          content: {
            title: `Pray for ${authorName}`,
            prayerText: item.thread.entries?.[0]?.content || item.thread.content,
            authorName,
            isAnonymous: item.thread.isAnonymous,
            createdAt: item.thread.createdAt
          },
          prayerData: item
        });
      });

      // Add wrap-up stage
      if (wrapUpStage) {
        finalStages.push({
          ...wrapUpStage,
          type: wrapUpStage.type as Stage["type"]
        });
      }
    }

    setStages(finalStages);
  }, [prayerListData]);

  const goToNext = useCallback(() => {
    setCurrentStageIndex(prev =>
      prev < stages.length - 1 ? prev + 1 : prev
    );
  }, [stages.length]);

  const goToPrevious = useCallback(() => {
    setCurrentStageIndex(prev =>
      prev > 0 ? prev - 1 : prev
    );
  }, []);

  const goToStage = useCallback((index: number) => {
    if (index >= 0 && index < stages.length) {
      setCurrentStageIndex(index);
    }
  }, [stages.length]);

  const reset = useCallback(() => {
    setCurrentStageIndex(0);
  }, []);

  const currentStage = stages[currentStageIndex];
  const progress = stages.length > 0 ? (currentStageIndex + 1) / stages.length : 0;

  return {
    stages,
    currentStage,
    currentStageIndex,
    totalStages: stages.length,
    progress,
    goToNext,
    goToPrevious,
    goToStage,
    reset,
    isLoading: isPrayersLoading || !prayerListData,
    config: prayerConfig,
    hasNoPrayers: prayerListData && stages.length === 0
  };
}