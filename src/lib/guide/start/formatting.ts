export const truncateForTitle = (text: string, maxChars: number): string => {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars - 1).trimEnd()}…`;
};

export const paraphraseSituation = (snippet: string, maxChars: number): string => {
  const cleaned = snippet
    .replace(/^Carrying:\s*/i, "")
    .replace(/^Hoping:\s*/i, "")
    .replace(/^Season:\s*/i, "")
    .replace(/^Schedule:\s*/i, "")
    .replace(/^Prayer topic:\s*/i, "")
    .replace(/^Goal:\s*/i, "")
    .trim();
  return truncateForTitle(cleaned, maxChars);
};

export const timeQualifier = (bucket: string): string => {
  if (bucket === "morning") return "this morning";
  if (bucket === "afternoon") return "today";
  if (bucket === "evening") return "this evening";
  if (bucket === "night") return "tonight";
  return "";
};

export const topicLabel = (topic: string): string => {
  switch (topic) {
    case "peace":
      return "peace";
    case "anxiety":
      return "anxiety";
    case "work":
      return "work";
    case "rest":
      return "rest";
    case "guidance":
      return "guidance";
    case "steadfastness":
      return "steadfastness";
    case "identity":
      return "identity";
    case "relationships":
      return "relationships";
    case "temptation":
      return "strength";
    case "gratitude":
      return "gratitude";
    case "grief":
      return "comfort";
    case "forgiveness":
      return "forgiveness";
    case "hope":
      return "hope";
    default:
      return "a grounded next step";
  }
};


