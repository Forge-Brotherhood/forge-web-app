import { PrismaClient, ReadingPlanVisibility } from "@prisma/client";
import { customAlphabet } from "nanoid";

const prisma = new PrismaClient();
const generateShortId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  10
);

// Romans: The Gospel Changes Everything - 7 Day Plan
const romansPlanData = {
  title: "Romans: The Gospel Changes Everything",
  subtitle: "A 7-day journey through Paul's letter to Rome",
  description:
    "Explore how the gospel transforms every aspect of life - from our standing with God to our relationships with others. This plan walks through key passages in Romans, helping you understand justification by faith and what it means to live in the power of the Spirit.",
  theme: "Gospel & Transformation",
  totalDays: 7,
  estimatedMinutesMin: 10,
  estimatedMinutesMax: 15,
  days: [
    {
      dayNumber: 1,
      passageRef: "Romans 1:1-17",
      bookId: "ROM",
      startChapter: 1,
      startVerse: 1,
      endChapter: 1,
      endVerse: 17,
      title: "The Power of the Gospel",
      summary:
        "Paul introduces himself and declares that he is not ashamed of the gospel - it is the power of God for salvation.",
      reflectionPrompt:
        "What does it mean for the gospel to be 'the power of God'? Where do you need that power in your life today?",
      prayerPrompt:
        "Pray for boldness to live out and share the gospel this week.",
      contextIntro:
        "Paul writes to a church he has never visited in the capital of the Roman Empire. His letter would become one of the most influential theological documents in history.",
    },
    {
      dayNumber: 2,
      passageRef: "Romans 3:21-31",
      bookId: "ROM",
      startChapter: 3,
      startVerse: 21,
      endChapter: 3,
      endVerse: 31,
      title: "Justified by Faith",
      summary:
        "After establishing that all have sinned, Paul reveals the good news: righteousness comes through faith in Jesus Christ.",
      reflectionPrompt:
        "How does understanding justification by faith alone change how you approach God?",
      prayerPrompt:
        "Thank God for the gift of righteousness you could never earn.",
      contextIntro:
        "This passage is often called the heart of Romans. The word 'justified' is a legal term meaning 'declared righteous' - it's a verdict, not a process.",
    },
    {
      dayNumber: 3,
      passageRef: "Romans 5:1-11",
      bookId: "ROM",
      startChapter: 5,
      startVerse: 1,
      endChapter: 5,
      endVerse: 11,
      title: "Peace with God",
      summary:
        "Because we are justified by faith, we have peace with God and can rejoice even in suffering.",
      reflectionPrompt:
        "How does knowing you have 'peace with God' change how you face difficult circumstances?",
      prayerPrompt:
        "Pray for someone going through suffering - ask God to produce perseverance and hope in them.",
      contextIntro:
        "The word for 'peace' here means more than the absence of conflict - it's the Hebrew concept of shalom: wholeness, completeness, right relationship.",
    },
    {
      dayNumber: 4,
      passageRef: "Romans 6:1-14",
      bookId: "ROM",
      startChapter: 6,
      startVerse: 1,
      endChapter: 6,
      endVerse: 14,
      title: "Dead to Sin, Alive in Christ",
      summary:
        "Our union with Christ in his death and resurrection means sin no longer has mastery over us.",
      reflectionPrompt:
        "What does it mean to 'count yourselves dead to sin'? What sin pattern do you need to stop feeding?",
      prayerPrompt:
        "Ask God to reveal any area where you're still living as if sin has power over you.",
      contextIntro:
        "Baptism in the early church was a full immersion - going under the water symbolized dying with Christ, and coming up symbolized rising to new life.",
    },
    {
      dayNumber: 5,
      passageRef: "Romans 8:1-17",
      bookId: "ROM",
      startChapter: 8,
      startVerse: 1,
      endChapter: 8,
      endVerse: 17,
      title: "Life in the Spirit",
      summary:
        "There is no condemnation for those in Christ Jesus! The Spirit sets us free and confirms we are God's children.",
      reflectionPrompt:
        "How often do you still live under condemnation? What would change if you truly believed verse 1?",
      prayerPrompt:
        "Ask the Holy Spirit to help you live by the Spirit rather than by the flesh today.",
      contextIntro:
        "Romans 8 is considered one of the most encouraging chapters in all of Scripture. 'No condemnation' doesn't mean we never sin - it means the verdict has already been declared.",
    },
    {
      dayNumber: 6,
      passageRef: "Romans 8:28-39",
      bookId: "ROM",
      startChapter: 8,
      startVerse: 28,
      endChapter: 8,
      endVerse: 39,
      title: "More Than Conquerors",
      summary:
        "God works all things for good, and nothing can separate us from His love in Christ Jesus.",
      reflectionPrompt:
        "What circumstance in your life do you need to trust that God is working for good? What would it look like to truly believe nothing can separate you from God's love?",
      prayerPrompt:
        "Pray through the list in verses 35-39, declaring that none of these can separate you from Christ's love.",
      contextIntro:
        "The phrase 'more than conquerors' could be translated 'super-victors' - we don't just survive; we triumph because of Christ's overwhelming love.",
    },
    {
      dayNumber: 7,
      passageRef: "Romans 12:1-21",
      bookId: "ROM",
      startChapter: 12,
      startVerse: 1,
      endChapter: 12,
      endVerse: 21,
      title: "Living Sacrifice",
      summary:
        "In response to God's mercy, we are to offer our bodies as living sacrifices and be transformed by renewing our minds.",
      reflectionPrompt:
        "What is one specific way you can 'renew your mind' this week? How can you practice 'not being conformed to this world'?",
      prayerPrompt:
        "Offer yourself as a living sacrifice. Ask God to show you how to use your gifts to serve your brothers.",
      contextIntro:
        "After 11 chapters of theology, Paul turns to practical application. The word 'therefore' in verse 1 connects everything that follows to everything that came before.",
    },
  ],
};

// 1 John: Walking in the Light - 5 Day Plan
const johnPlanData = {
  title: "1 John: Walking in the Light",
  subtitle: "5 days exploring fellowship with God",
  description:
    "John, the apostle of love, writes to reassure believers of their salvation and call them to authentic Christian living. This plan explores what it means to walk in the light and love one another as Christ loved us.",
  theme: "Love & Assurance",
  totalDays: 5,
  estimatedMinutesMin: 8,
  estimatedMinutesMax: 12,
  days: [
    {
      dayNumber: 1,
      passageRef: "1 John 1:1-10",
      bookId: "1JN",
      startChapter: 1,
      startVerse: 1,
      endChapter: 1,
      endVerse: 10,
      title: "The Light Has Come",
      summary:
        "John declares what he has seen and heard - the Word of Life. Walking in the light means confessing our sins.",
      reflectionPrompt:
        "What does it mean to 'walk in the light'? Is there any sin you've been hiding from?",
      prayerPrompt:
        "Confess any known sin to God, trusting His promise to forgive and cleanse.",
      contextIntro:
        "John was one of Jesus's closest disciples - he had touched, heard, and seen Jesus with his own eyes. He writes to combat early false teachings.",
    },
    {
      dayNumber: 2,
      passageRef: "1 John 2:1-17",
      bookId: "1JN",
      startChapter: 2,
      startVerse: 1,
      endChapter: 2,
      endVerse: 17,
      title: "Love Not the World",
      summary:
        "Jesus is our advocate when we sin. True knowledge of God is shown by keeping His commands and not loving the world.",
      reflectionPrompt:
        "What worldly thing competes most for your affection? How does having Jesus as your 'advocate' change how you view your failures?",
      prayerPrompt:
        "Ask God to reveal any 'love of the world' that is crowding out your love for Him.",
      contextIntro:
        "The 'world' John refers to is not the physical creation but the system of values and priorities that oppose God's kingdom.",
    },
    {
      dayNumber: 3,
      passageRef: "1 John 3:1-18",
      bookId: "1JN",
      startChapter: 3,
      startVerse: 1,
      endChapter: 3,
      endVerse: 18,
      title: "Children of God",
      summary:
        "See what great love the Father has lavished on us - we are called children of God! And so we love one another.",
      reflectionPrompt:
        "What does it mean to be called a 'child of God'? How should this identity shape how you treat your brothers?",
      prayerPrompt:
        "Thank God for the incredible love that made you His child. Ask for opportunities to love others 'with actions and in truth.'",
      contextIntro:
        "In the ancient world, the title 'child of God' was reserved for emperors and kings. John says it belongs to every believer.",
    },
    {
      dayNumber: 4,
      passageRef: "1 John 4:7-21",
      bookId: "1JN",
      startChapter: 4,
      startVerse: 7,
      endChapter: 4,
      endVerse: 21,
      title: "God Is Love",
      summary:
        "God is love, and His love was demonstrated at the cross. If God so loved us, we ought to love one another.",
      reflectionPrompt:
        "How did God demonstrate His love for you? Who is difficult for you to love, and how might you show them love this week?",
      prayerPrompt:
        "Pray for someone you find difficult to love. Ask God to give you His heart for them.",
      contextIntro:
        "This is the only place in Scripture where we read 'God is love.' Not just that God loves, but that love is essential to who He is.",
    },
    {
      dayNumber: 5,
      passageRef: "1 John 5:1-15",
      bookId: "1JN",
      startChapter: 5,
      startVerse: 1,
      endChapter: 5,
      endVerse: 15,
      title: "Confidence in Christ",
      summary:
        "Faith in the Son of God gives us victory over the world and confidence in approaching God.",
      reflectionPrompt:
        "What does it mean that faith is 'the victory that has overcome the world'? Where do you need more confidence in prayer?",
      prayerPrompt:
        "Bring a bold request to God, trusting that He hears you. Thank Him for the assurance of eternal life.",
      contextIntro:
        "John writes so 'that you may know you have eternal life' - assurance is a gift God wants His children to have.",
    },
  ],
};

async function seedReadingPlans() {
  console.log("📖 Seeding Reading Plans...");

  // Check if Romans plan already exists
  const existingRomansPlan = await prisma.readingPlanTemplate.findFirst({
    where: { slug: "romans-the-gospel-changes-everything" },
  });

  if (existingRomansPlan) {
    console.log("   ⏭️  Romans plan already exists, skipping...");
  } else {
    // Create Romans plan
    const romansPlan = await prisma.readingPlanTemplate.create({
      data: {
        shortId: generateShortId(),
        slug: "romans-the-gospel-changes-everything",
        title: romansPlanData.title,
        subtitle: romansPlanData.subtitle,
        description: romansPlanData.description,
        theme: romansPlanData.theme,
        totalDays: romansPlanData.totalDays,
        estimatedMinutesMin: romansPlanData.estimatedMinutesMin,
        estimatedMinutesMax: romansPlanData.estimatedMinutesMax,
        visibility: ReadingPlanVisibility.public,
        isPublished: true,
        isFeatured: true,
      },
    });

    // Create days for Romans plan
    for (const day of romansPlanData.days) {
      await prisma.readingPlanTemplateDay.create({
        data: {
          templateId: romansPlan.id,
          dayNumber: day.dayNumber,
          passageRef: day.passageRef,
          bookId: day.bookId,
          startChapter: day.startChapter,
          startVerse: day.startVerse,
          endChapter: day.endChapter,
          endVerse: day.endVerse,
          title: day.title,
          summary: day.summary,
          reflectionPrompt: day.reflectionPrompt,
          prayerPrompt: day.prayerPrompt,
          contextIntro: day.contextIntro,
        },
      });
    }

    console.log("   ✅ Created: Romans: The Gospel Changes Everything (7 days)");
  }

  // Check if 1 John plan already exists
  const existingJohnPlan = await prisma.readingPlanTemplate.findFirst({
    where: { slug: "1-john-walking-in-the-light" },
  });

  if (existingJohnPlan) {
    console.log("   ⏭️  1 John plan already exists, skipping...");
  } else {
    // Create 1 John plan
    const johnPlan = await prisma.readingPlanTemplate.create({
      data: {
        shortId: generateShortId(),
        slug: "1-john-walking-in-the-light",
        title: johnPlanData.title,
        subtitle: johnPlanData.subtitle,
        description: johnPlanData.description,
        theme: johnPlanData.theme,
        totalDays: johnPlanData.totalDays,
        estimatedMinutesMin: johnPlanData.estimatedMinutesMin,
        estimatedMinutesMax: johnPlanData.estimatedMinutesMax,
        visibility: ReadingPlanVisibility.public,
        isPublished: true,
        isFeatured: false,
      },
    });

    // Create days for 1 John plan
    for (const day of johnPlanData.days) {
      await prisma.readingPlanTemplateDay.create({
        data: {
          templateId: johnPlan.id,
          dayNumber: day.dayNumber,
          passageRef: day.passageRef,
          bookId: day.bookId,
          startChapter: day.startChapter,
          startVerse: day.startVerse,
          endChapter: day.endChapter,
          endVerse: day.endVerse,
          title: day.title,
          summary: day.summary,
          reflectionPrompt: day.reflectionPrompt,
          prayerPrompt: day.prayerPrompt,
          contextIntro: day.contextIntro,
        },
      });
    }

    console.log("   ✅ Created: 1 John: Walking in the Light (5 days)");
  }

  // Get statistics
  const stats = {
    templates: await prisma.readingPlanTemplate.count(),
    publishedTemplates: await prisma.readingPlanTemplate.count({
      where: { isPublished: true },
    }),
    templateDays: await prisma.readingPlanTemplateDay.count(),
  };

  console.log("\n📊 Reading Plans statistics:");
  console.log(`   📚 Templates: ${stats.templates} (${stats.publishedTemplates} published)`);
  console.log(`   📅 Template Days: ${stats.templateDays}`);
}

// Run if executed directly
seedReadingPlans()
  .catch((e) => {
    console.error("❌ Reading Plans seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { seedReadingPlans };
