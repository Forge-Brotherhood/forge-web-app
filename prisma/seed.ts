import { PrismaClient, ThreadStatus, PostKind, GroupType, ReactionType } from '@prisma/client';
import { faker } from '@faker-js/faker';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Load seed data from external JSON file to reduce bundle size
function loadSeedData() {
  const seedDataPath = path.join(__dirname, 'seed-data.json');
  const seedDataContent = fs.readFileSync(seedDataPath, 'utf-8');
  return JSON.parse(seedDataContent);
}

const { 
  prayerCategories, 
  encouragementTemplates, 
  updateTemplates, 
  testimonyTemplates, 
  groupNames 
} = loadSeedData();

async function seed() {
  console.log('🌱 Starting database seed...');

  // Clear existing data
  console.log('🧹 Clearing existing data...');
  await prisma.sponsorship.deleteMany();
  await prisma.prayerAction.deleteMany();
  await prisma.reaction.deleteMany();
  await prisma.media.deleteMany();
  await prisma.post.deleteMany();
  await prisma.thread.deleteMany();
  await prisma.groupMember.deleteMany();
  await prisma.group.deleteMany();
  await prisma.user.deleteMany();

  // Create users
  console.log('👥 Creating 50 users...');
  const usersData = [];
  
  for (let i = 1; i <= 50; i++) {
    const firstName = faker.person.firstName('male');
    const lastName = faker.person.lastName();
    usersData.push({
      clerkId: `test_user_${i}`,
      email: faker.internet.email({ firstName, lastName }).toLowerCase(),
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`,
      handle: faker.internet.username({ firstName, lastName }).toLowerCase().slice(0, 20),
      profileImageUrl: Math.random() > 0.3 ? faker.image.avatar() : null,
      prayerStreak: faker.number.int({ min: 0, max: 30 }),
      lastPrayerAt: Math.random() > 0.3 ? faker.date.recent({ days: 7 }) : null,
      isSponsor: Math.random() > 0.8,
      createdAt: faker.date.past({ years: 1 }),
    });
  }
  
  await prisma.user.createMany({ data: usersData });
  const users = await prisma.user.findMany();

  console.log('✅ Users created');

  // Create groups
  console.log('🤝 Creating groups...');
  const groups = [];
  
  // Create 8 core groups (4-6 members each)
  for (let i = 0; i < 8; i++) {
    const group = await prisma.group.create({
      data: {
        name: faker.helpers.arrayElement(groupNames),
        description: 'A brotherhood committed to prayer, accountability, and spiritual growth.',
        groupType: GroupType.core,
      },
    });
    groups.push(group);
    
    // Add 4-6 members to each core group
    const memberCount = faker.number.int({ min: 4, max: 6 });
    const groupUsers = faker.helpers.arrayElements(users, memberCount);
    
    for (let j = 0; j < groupUsers.length; j++) {
      await prisma.groupMember.create({
        data: {
          groupId: group.id,
          userId: groupUsers[j].id,
          role: j === 0 ? 'leader' : 'member',
          status: 'active',
        },
      });
    }
  }
  
  // Create 5 circle groups (larger groups)
  for (let i = 0; i < 5; i++) {
    const group = await prisma.group.create({
      data: {
        name: `${faker.helpers.arrayElement(groupNames)} Circle`,
        description: 'A larger community for prayer and fellowship.',
        groupType: GroupType.circle,
      },
    });
    groups.push(group);
    
    // Add 8-15 members to each circle group
    const memberCount = faker.number.int({ min: 8, max: 15 });
    const groupUsers = faker.helpers.arrayElements(users, memberCount);
    
    for (let j = 0; j < groupUsers.length; j++) {
      await prisma.groupMember.create({
        data: {
          groupId: group.id,
          userId: groupUsers[j].id,
          role: j === 0 ? 'leader' : 'member',
          status: 'active',
        },
      });
    }
  }

  console.log('✅ Groups and memberships created');

  // Create threads with posts
  console.log('🙏 Creating prayer threads with posts...');
  const threads = [];
  
  for (let i = 0; i < 200; i++) {
    const group = faker.helpers.arrayElement(groups);
    const groupMembers = await prisma.groupMember.findMany({
      where: { groupId: group.id, status: 'active' },
      include: { user: true },
    });
    
    const author = faker.helpers.arrayElement(groupMembers).user;
    const categoryKeys = Object.keys(prayerCategories);
    const category = categoryKeys[Math.floor(Math.random() * categoryKeys.length)] as keyof typeof prayerCategories;
    const categoryData = prayerCategories[category];
    
    const title = faker.helpers.arrayElement(categoryData.titles);
    const content = faker.helpers.arrayElement(categoryData.bodies);
    const isAnonymous = Math.random() < 0.15; // 15% anonymous
    const sharedToCommunity = Math.random() < 0.3; // 30% shared to community
    const isAnswered = Math.random() < 0.12; // 12% answered
    
    const createdAt = faker.date.recent({ days: 60 });
    
    // Create thread
    const thread = await prisma.thread.create({
      data: {
        groupId: group.id,
        authorId: author.id,
        title: title as string | null,
        sharedToCommunity,
        isAnonymous,
        status: isAnswered ? ThreadStatus.answered : ThreadStatus.open,
        createdAt,
      },
    });
    
    threads.push(thread);
    
    // Create initial request post
    await prisma.post.create({
      data: {
        threadId: thread.id,
        authorId: author.id,
        kind: PostKind.request,
        content: content as string | null,
        createdAt,
      },
    });
    
    // Add some encouragement posts (30% chance per thread, 1-3 posts)
    if (Math.random() < 0.3) {
      const encouragementCount = faker.number.int({ min: 1, max: 3 });
      const otherMembers = groupMembers.filter(m => m.userId !== author.id);
      
      for (let j = 0; j < encouragementCount && otherMembers.length > 0; j++) {
        const encourager = faker.helpers.arrayElement(otherMembers);
        await prisma.post.create({
          data: {
            threadId: thread.id,
            authorId: encourager.userId,
            kind: PostKind.encouragement,
            content: faker.helpers.arrayElement(encouragementTemplates),
            createdAt: faker.date.between({ 
              from: createdAt, 
              to: new Date() 
            }),
          },
        });
      }
    }
    
    // Add update posts (15% chance, only from original author)
    if (Math.random() < 0.15) {
      await prisma.post.create({
        data: {
          threadId: thread.id,
          authorId: author.id,
          kind: PostKind.update,
          content: faker.helpers.arrayElement(updateTemplates),
          createdAt: faker.date.between({ 
            from: createdAt, 
            to: new Date() 
          }),
        },
      });
    }
    
    // Add testimony post if thread is answered
    if (isAnswered) {
      await prisma.post.create({
        data: {
          threadId: thread.id,
          authorId: author.id,
          kind: PostKind.testimony,
          content: faker.helpers.arrayElement(testimonyTemplates),
          createdAt: faker.date.between({ 
            from: createdAt, 
            to: new Date() 
          }),
        },
      });
    }
  }

  console.log('✅ Threads and posts created');

  // Create prayer actions and reactions
  console.log('❤️ Creating prayer actions and reactions...');
  const posts = await prisma.post.findMany({
    where: { kind: PostKind.request },
    include: { thread: { include: { group: { include: { members: true } } } } },
  });
  
  for (const post of posts) {
    const groupMembers = post.thread.group?.members || [];
    const otherMembers = groupMembers.filter(m => m.userId !== post.authorId);
    
    // 40-70% of other group members pray for each request
    const prayerRate = faker.number.float({ min: 0.4, max: 0.7 });
    const prayerCount = Math.floor(otherMembers.length * prayerRate);
    const prayers = faker.helpers.arrayElements(otherMembers, prayerCount);
    
    for (const prayer of prayers) {
      const prayedAt = faker.date.between({ 
        from: post.createdAt, 
        to: new Date() 
      });
      
      // Create prayer action
      await prisma.prayerAction.create({
        data: {
          userId: prayer.userId,
          threadId: post.threadId,
          postId: post.id,
          createdAt: prayedAt,
        },
      });
      
      // Create "amen" reaction
      await prisma.reaction.create({
        data: {
          postId: post.id,
          userId: prayer.userId,
          type: ReactionType.amen,
          createdAt: prayedAt,
        },
      });
    }
    
    // Add some community prayers if shared to community (10-20% of other users)
    if (post.thread.sharedToCommunity) {
      const allOtherUsers = users.filter(u => 
        u.id !== post.authorId && 
        !groupMembers.some(m => m.userId === u.id)
      );
      
      const communityPrayerRate = faker.number.float({ min: 0.1, max: 0.2 });
      const communityPrayerCount = Math.floor(allOtherUsers.length * communityPrayerRate);
      const communityPrayers = faker.helpers.arrayElements(allOtherUsers, communityPrayerCount);
      
      for (const prayer of communityPrayers) {
        const prayedAt = faker.date.between({ 
          from: post.createdAt, 
          to: new Date() 
        });
        
        await prisma.prayerAction.create({
          data: {
            userId: prayer.id,
            threadId: post.threadId,
            postId: post.id,
            createdAt: prayedAt,
          },
        });
        
        await prisma.reaction.create({
          data: {
            postId: post.id,
            userId: prayer.id,
            type: ReactionType.amen,
            createdAt: prayedAt,
          },
        });
      }
    }
  }

  console.log('✅ Prayer actions and reactions created');

  // Create some sponsorships
  console.log('💰 Creating sponsorships...');
  const sponsors = users.filter(u => u.isSponsor);
  
  for (const sponsor of sponsors) {
    await prisma.sponsorship.create({
      data: {
        userId: sponsor.id,
        amount: faker.number.float({ min: 10, max: 100, fractionDigits: 2 }),
        active: true,
      },
    });
  }

  console.log('✅ Sponsorships created');

  // Get statistics
  const stats = {
    users: await prisma.user.count(),
    groups: await prisma.group.count(),
    coreGroups: await prisma.group.count({ where: { groupType: GroupType.core } }),
    circleGroups: await prisma.group.count({ where: { groupType: GroupType.circle } }),
    groupMembers: await prisma.groupMember.count(),
    threads: await prisma.thread.count(),
    communityThreads: await prisma.thread.count({ where: { sharedToCommunity: true } }),
    answeredThreads: await prisma.thread.count({ where: { status: ThreadStatus.answered } }),
    posts: await prisma.post.count(),
    requestPosts: await prisma.post.count({ where: { kind: PostKind.request } }),
    encouragementPosts: await prisma.post.count({ where: { kind: PostKind.encouragement } }),
    updatePosts: await prisma.post.count({ where: { kind: PostKind.update } }),
    testimonyPosts: await prisma.post.count({ where: { kind: PostKind.testimony } }),
    prayerActions: await prisma.prayerAction.count(),
    reactions: await prisma.reaction.count(),
    sponsorships: await prisma.sponsorship.count(),
  };

  console.log('\n📊 Seeding complete! Database statistics:');
  console.log(`   👥 Users: ${stats.users}`);
  console.log(`   🤝 Groups: ${stats.groups} (${stats.coreGroups} core, ${stats.circleGroups} circle)`);
  console.log(`   👫 Group Members: ${stats.groupMembers}`);
  console.log(`   🙏 Threads: ${stats.threads} (${stats.communityThreads} shared to community, ${stats.answeredThreads} answered)`);
  console.log(`   📝 Posts: ${stats.posts} (${stats.requestPosts} requests, ${stats.encouragementPosts} encouragements, ${stats.updatePosts} updates, ${stats.testimonyPosts} testimonies)`);
  console.log(`   ❤️  Prayer Actions: ${stats.prayerActions}`);
  console.log(`   👍 Reactions: ${stats.reactions}`);
  console.log(`   💰 Sponsorships: ${stats.sponsorships}`);
}

seed()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    console.error(e.stack);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });