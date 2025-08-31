import { PrismaClient, ThreadStatus } from '@prisma/client';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

// Prayer request categories and templates
const prayerCategories = {
  health: {
    titles: [
      'Prayers for recovery',
      'Healing needed',
      'Surgery tomorrow',
      'Health struggles',
      'Medical test results',
      'Chronic pain relief',
      'Mental health support',
    ],
    bodies: [
      'Please pray for my upcoming surgery. I\'m feeling anxious but trusting in God\'s plan.',
      'My mother was diagnosed with cancer. We need prayers for strength and healing.',
      'Struggling with chronic pain for years. Please pray for relief and patience.',
      'Awaiting test results that could change everything. Need peace and wisdom.',
      'My child is in the hospital. We desperately need your prayers.',
      'Depression has been overwhelming lately. Please pray for hope and healing.',
      'Recovery from addiction is harder than I thought. Need spiritual strength.',
    ],
  },
  family: {
    titles: [
      'Marriage restoration',
      'Family healing needed',
      'Prayers for my children',
      'Relationship struggles',
      'Parents need prayer',
      'Family unity',
      'Difficult family situation',
    ],
    bodies: [
      'My marriage is going through a rough patch. Please pray for wisdom and reconciliation.',
      'My teenager is making destructive choices. I need prayers for guidance.',
      'Estranged from my family for years. Praying for reconciliation and forgiveness.',
      'Single parent struggling to make ends meet. Need prayers for provision and strength.',
      'My parents are getting divorced after 30 years. This is devastating.',
      'Blended family challenges are overwhelming. Please pray for unity and love.',
      'Infertility journey has been heartbreaking. Prayers for peace and hope appreciated.',
    ],
  },
  work: {
    titles: [
      'Job search prayers',
      'Work situation',
      'Career guidance needed',
      'Workplace challenges',
      'Financial provision',
      'Business prayers',
      'Employment needed',
    ],
    bodies: [
      'Lost my job last month. Please pray for provision and new opportunities.',
      'Toxic work environment is affecting my mental health. Need wisdom on next steps.',
      'Starting a new business venture. Prayers for wisdom and success appreciated.',
      'Facing potential layoffs at work. Please pray for peace and provision.',
      'Struggling to find purpose in my career. Need guidance and clarity.',
      'Interview tomorrow for my dream job. Please pray for confidence and favor.',
      'Financial stress is overwhelming our family. Prayers for breakthrough needed.',
    ],
  },
  spiritual: {
    titles: [
      'Spiritual growth',
      'Faith struggles',
      'Seeking God\'s will',
      'Spiritual warfare',
      'Need spiritual guidance',
      'Growing in faith',
      'Spiritual dryness',
    ],
    bodies: [
      'Feeling distant from God lately. Please pray for renewed faith and connection.',
      'New Christian seeking mentorship and growth. Prayers for wisdom appreciated.',
      'Struggling with doubt and questions about faith. Need prayers for clarity.',
      'Called to ministry but facing obstacles. Please pray for open doors.',
      'Spiritual attacks have been intense. Need prayers for protection and strength.',
      'Trying to discern God\'s will for my life. Prayers for clarity needed.',
      'Want to grow deeper in my faith. Pray for discipline and hunger for God\'s word.',
    ],
  },
  community: {
    titles: [
      'Community outreach',
      'Church prayers needed',
      'Mission trip',
      'Neighborhood needs',
      'School prayer request',
      'Local ministry',
      'Community healing',
    ],
    bodies: [
      'Our church is planning a food drive. Pray for resources and volunteers.',
      'Mission trip to Guatemala next month. Prayers for safety and impact.',
      'Local homeless shelter needs support. Praying for provision and volunteers.',
      'School shooting in our community. Please pray for healing and comfort.',
      'Starting a youth ministry in our neighborhood. Need prayers for wisdom.',
      'Natural disaster affected our town. Prayers for recovery and rebuilding.',
      'Community divided over recent events. Praying for unity and healing.',
    ],
  },
  education: {
    titles: [
      'College decisions',
      'Struggling in school',
      'Teacher needs prayer',
      'Student loan stress',
      'Career training',
      'Educational goals',
      'Learning difficulties',
    ],
    bodies: [
      'Senior year and still don\'t know what to major in. Need wisdom for college choice.',
      'Struggling with chemistry class. Please pray for understanding and good grades.',
      'Teaching at a difficult school this year. Pray for patience and impact.',
      'Overwhelmed by student loan debt. Need prayers for financial breakthrough.',
      'Starting nursing program next month. Prayers for success and perseverance.',
      'Child has been diagnosed with learning disability. Need guidance and resources.',
      'Working full-time while going to school. Pray for energy and balance.',
    ],
  },
  travel: {
    titles: [
      'Safe travels needed',
      'Mission trip prayers',
      'Military deployment',
      'Family vacation safety',
      'Work travel',
      'Moving across country',
      'International travel',
    ],
    bodies: [
      'Driving cross-country for job relocation. Prayers for safe travel and smooth transition.',
      'Husband deploying overseas for 12 months. Pray for his safety and our family.',
      'Taking teenagers on mission trip to Mexico. Prayers for safety and hearts to be changed.',
      'Flying for the first time with anxiety. Please pray for peace and safe flight.',
      'Moving elderly parents to assisted living. Pray for emotional adjustment.',
      'Business trip to potentially dangerous region. Need prayers for protection.',
      'Backpacking through Europe after graduation. Pray for safety and wisdom.',
    ],
  },
  pregnancy: {
    titles: [
      'Pregnancy complications',
      'Trying to conceive',
      'High-risk pregnancy',
      'Miscarriage grief',
      'Adoption process',
      'New parent anxiety',
      'Infertility journey',
    ],
    bodies: [
      'Just found out we\'re expecting after years of trying. Prayers for healthy pregnancy.',
      'Doctors found complications at 20-week ultrasound. Need prayers for baby\'s health.',
      'Third miscarriage this year. Heartbroken and need prayers for healing.',
      'Adoption home study next week. Prayers that everything goes smoothly.',
      'First-time parent and feeling overwhelmed. Need wisdom and peace.',
      'Wife is high-risk pregnancy. Prayers for both mom and baby to stay healthy.',
      'Five years of infertility treatments. Running out of hope and money.',
    ],
  },
  mental: {
    titles: [
      'Depression battle',
      'Anxiety overwhelm',
      'Panic attacks',
      'Therapy journey',
      'Medication concerns',
      'Suicidal thoughts',
      'PTSD healing',
    ],
    bodies: [
      'Depression has been worse lately. Struggling to get out of bed. Need prayers.',
      'Panic attacks started after car accident. Please pray for healing and peace.',
      'Starting therapy for childhood trauma. Pray for courage and breakthrough.',
      'Considering medication for anxiety. Need wisdom about treatment options.',
      'Been having dark thoughts lately. Please pray for hope and professional help.',
      'PTSD from military service affecting my family. Need prayers for healing.',
      'Seasonal depression hitting hard this winter. Pray for light and joy.',
    ],
  },
};

const encouragementTemplates = [
  'Praying for you during this difficult time. God is with you.',
  'Standing with you in prayer. May you feel God\'s peace and presence.',
  'Just lifted you up in prayer. Trust that God is working in your situation.',
  'Your faith is inspiring. Continuing to pray for breakthrough.',
  'God sees your struggle and He cares. Praying for His comfort and strength.',
  'Remember that you\'re not alone. This community is praying for you.',
  'May God\'s peace that surpasses understanding guard your heart.',
  'Believing with you for God\'s intervention. Stay strong in faith.',
  'Praying Psalm 91 over you today. God is your refuge and fortress.',
  'Your testimony is being written. Praying for God\'s perfect will.',
  'Lifting you and your family up in prayer. God is faithful.',
  'Praying for wisdom and clarity in your situation. God will guide you.',
  'May you feel the prayers of this community surrounding you with love.',
  'God\'s timing is perfect. Praying for patience and peace while you wait.',
  'Declaring healing and restoration over your situation in Jesus\' name.',
  'Your vulnerability is courageous. Praying for God\'s abundant grace.',
  'Standing in the gap for you. God is working even when we can\'t see it.',
  'Praying for supernatural peace and provision in your circumstances.',
  'May God surprise you with His goodness. Keeping you in prayer.',
  'Your faith through this trial is a testimony. Praying for breakthrough.',
];

const updateTemplates = [
  'Thank you for your prayers! We\'ve seen some improvement.',
  'Update: God is moving! Things are getting better slowly but surely.',
  'Praise report! Your prayers are working. Situation is improving.',
  'Still waiting on God\'s timing, but feeling more peaceful. Thank you for praying.',
  'Small victories this week! Please continue praying.',
  'God showed up in an unexpected way! Thank you for your faithful prayers.',
  'Update: Still challenging but I can feel your prayers carrying me.',
  'Grateful for this praying community. Here\'s what\'s happened since I posted...',
  'God answered differently than expected, but I\'m trusting His plan.',
  'Progress update: Slow but steady improvement. Please keep praying!',
];

const tags = [
  'urgent', 'health', 'family', 'relationships', 'work', 'finances', 
  'spiritual-growth', 'healing', 'guidance', 'provision', 'protection',
  'peace', 'wisdom', 'strength', 'faith', 'hope', 'breakthrough',
  'restoration', 'deliverance', 'salvation', 'ministry', 'community',
  'anxiety', 'depression', 'grief', 'loss', 'addiction', 'recovery',
  'children', 'teens', 'parenting', 'marriage', 'divorce', 'dating',
  'school', 'college', 'career', 'retirement', 'military', 'travel',
  'pregnancy', 'infertility', 'adoption', 'surgery', 'chronic-illness',
  'mental-health', 'elderly', 'loneliness', 'housing', 'legal-issues',
  'persecution', 'evangelism', 'missions', 'church', 'worship', 'prayer'
];

async function seed() {
  console.log('🌱 Starting database seed...');

  // Clear existing data
  console.log('🧹 Clearing existing data...');
  await prisma.prayer.deleteMany();
  await prisma.encouragement.deleteMany();
  await prisma.threadUpdate.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.prayerCartItem.deleteMany();
  await prisma.report.deleteMany();
  await prisma.userBlock.deleteMany();
  await prisma.prayerThread.deleteMany();
  await prisma.guestSession.deleteMany();
  await prisma.user.deleteMany();

  // Create 100 users
  console.log('👥 Creating 100 users...');
  const usersData = [];
  
  for (let i = 1; i <= 100; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    usersData.push({
      clerkId: `test_user_${i}`,
      email: faker.internet.email({ firstName, lastName }).toLowerCase(),
      displayName: `${firstName} ${lastName}`,
      handle: faker.internet.username({ firstName, lastName }).toLowerCase().slice(0, 20),
      avatarUrl: Math.random() > 0.3 ? faker.image.avatar() : null,
      createdAt: faker.date.past({ years: 2 }),
      firstPostConsentedAt: Math.random() > 0.2 ? faker.date.past({ years: 2 }) : null,
    });
  }
  
  await prisma.user.createMany({ data: usersData });
  const users = await prisma.user.findMany();

  console.log('✅ Users created');

  // Create 1000 prayer threads
  console.log('🙏 Creating 1000 prayer threads...');
  const threadsData = [];
  
  for (let i = 0; i < 1000; i++) {
    const author = users[Math.floor(Math.random() * users.length)];
    const categoryKeys = Object.keys(prayerCategories);
    const category = categoryKeys[Math.floor(Math.random() * categoryKeys.length)] as keyof typeof prayerCategories;
    const categoryData = prayerCategories[category];
    
    const title = faker.helpers.arrayElement(categoryData.titles);
    const body = faker.helpers.arrayElement(categoryData.bodies);
    const isAnonymous = Math.random() < 0.2; // 20% anonymous
    const isAnswered = Math.random() < 0.15; // 15% answered
    
    const createdAt = faker.date.recent({ days: 90 });
    const expiresAt = new Date(createdAt);
    expiresAt.setDate(expiresAt.getDate() + 7);
    
    const threadTags = faker.helpers.arrayElements(tags, { min: 0, max: 4 });
    
    threadsData.push({
      title,
      body,
      tags: threadTags,
      isAnonymous,
      status: isAnswered ? ThreadStatus.answered : ThreadStatus.open,
      createdAt,
      expiresAt,
      answeredAt: isAnswered ? faker.date.between({ from: createdAt, to: new Date() }) : null,
      authorId: author.id,
    });
  }
  
  await prisma.prayerThread.createMany({ data: threadsData });
  const threads = await prisma.prayerThread.findMany();

  console.log('✅ Prayer threads created');

  // Create encouragements (2000-3000 total)
  console.log('💬 Creating encouragements...');
  const encouragementCount = faker.number.int({ min: 2000, max: 3000 });
  const encouragementsData = [];
  
  for (let i = 0; i < encouragementCount; i++) {
    const thread = faker.helpers.arrayElement(threads);
    const availableUsers = users.filter(u => u.id !== thread.authorId);
    const author = faker.helpers.arrayElement(availableUsers);
    
    encouragementsData.push({
      body: faker.helpers.arrayElement(encouragementTemplates),
      threadId: thread.id,
      authorId: author.id,
      createdAt: faker.date.between({ 
        from: thread.createdAt, 
        to: new Date() 
      }),
    });
  }
  
  // Create encouragements in batches of 500
  for (let i = 0; i < encouragementsData.length; i += 500) {
    const batch = encouragementsData.slice(i, i + 500);
    await prisma.encouragement.createMany({ data: batch });
  }

  console.log('✅ Encouragements created');

  // Create prayers (5000-8000 total)
  console.log('❤️ Creating prayers...');
  const prayerCount = faker.number.int({ min: 5000, max: 8000 });
  const prayerPairs = new Set<string>();
  const prayersData = [];
  
  for (let i = 0; i < prayerCount; i++) {
    const thread = faker.helpers.arrayElement(threads);
    const user = faker.helpers.arrayElement(users);
    const pairKey = `${thread.id}-${user.id}`;
    
    // Skip if this user already prayed for this thread
    if (prayerPairs.has(pairKey)) {
      continue;
    }
    
    prayerPairs.add(pairKey);
    
    prayersData.push({
      threadId: thread.id,
      userId: user.id,
      createdAt: faker.date.between({ 
        from: thread.createdAt, 
        to: new Date() 
      }),
    });
  }
  
  // Create prayers in batches of 1000
  for (let i = 0; i < prayersData.length; i += 1000) {
    const batch = prayersData.slice(i, i + 1000);
    await prisma.prayer.createMany({ data: batch });
  }

  console.log('✅ Prayers created');

  // Create thread updates (200-400 total)
  console.log('📝 Creating thread updates...');
  const updateCount = faker.number.int({ min: 200, max: 400 });
  const threadsWithUpdates = faker.helpers.arrayElements(threads, updateCount);
  const updatesData = [];
  
  for (const thread of threadsWithUpdates) {
    const updateText = faker.helpers.arrayElement(updateTemplates);
    const additionalContext = faker.lorem.sentence();
    
    updatesData.push({
      body: `${updateText} ${additionalContext}`,
      threadId: thread.id,
      authorId: thread.authorId,
      createdAt: faker.date.between({ 
        from: thread.createdAt, 
        to: new Date() 
      }),
    });
  }
  
  await prisma.threadUpdate.createMany({ data: updatesData });

  console.log('✅ Thread updates created');

  // Create some guest sessions with prayers
  console.log('👤 Creating guest sessions...');
  const guestSessionCount = faker.number.int({ min: 50, max: 100 });
  
  for (let i = 0; i < guestSessionCount; i++) {
    const guestSession = await prisma.guestSession.create({
      data: {
        deviceHash: faker.string.alphanumeric(64),
        createdAt: faker.date.recent({ days: 30 }),
      },
    });
    
    // Add some prayers from guest sessions
    const guestPrayerCount = faker.number.int({ min: 1, max: 5 });
    const guestThreads = faker.helpers.arrayElements(threads, guestPrayerCount);
    
    for (const thread of guestThreads) {
      await prisma.prayer.create({
        data: {
          threadId: thread.id,
          guestSessionId: guestSession.id,
          createdAt: faker.date.between({ 
            from: thread.createdAt, 
            to: new Date() 
          }),
        },
      });
    }
  }

  console.log('✅ Guest sessions created');

  // Get statistics
  const stats = {
    users: await prisma.user.count(),
    threads: await prisma.prayerThread.count(),
    encouragements: await prisma.encouragement.count(),
    prayers: await prisma.prayer.count(),
    updates: await prisma.threadUpdate.count(),
    guestSessions: await prisma.guestSession.count(),
  };

  console.log('\n📊 Seeding complete! Database statistics:');
  console.log(`   👥 Users: ${stats.users}`);
  console.log(`   🙏 Prayer Threads: ${stats.threads}`);
  console.log(`   💬 Encouragements: ${stats.encouragements}`);
  console.log(`   ❤️  Prayers: ${stats.prayers}`);
  console.log(`   📝 Thread Updates: ${stats.updates}`);
  console.log(`   👤 Guest Sessions: ${stats.guestSessions}`);
}

seed()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });