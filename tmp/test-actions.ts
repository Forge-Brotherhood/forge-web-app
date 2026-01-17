import { extractUiActionsDeterministic } from "../src/lib/openai/structuredActions";

(async () => {
  const text = `A few verses that make a calm and steady way to begin a new day are Psalm 121, which reminds you that the Lord watches over you, and Isaiah 26:3–4, which speaks of God keeping in perfect peace the one who trusts in Him. John 14:27 is also a comforting place to start, with Jesus offering a peace the world cannot give.`;

  const actions = extractUiActionsDeterministic({ answerText: text });
  console.log(JSON.stringify(actions, null, 2));
})();
