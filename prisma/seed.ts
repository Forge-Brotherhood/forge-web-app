import { PrismaClient, PrayerRequestStatus, PrayerEntryKind, GroupType, PrayerResponseType, BanState } from '@prisma/client';
import { faker } from '@faker-js/faker';
import { customAlphabet } from 'nanoid';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// NanoID generator for shortIds (10 chars, alphanumeric)
const generateShortId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 10);

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
  await prisma.support.deleteMany();
  await prisma.savedPrayer.deleteMany();
  await prisma.prayerAction.deleteMany();
  await prisma.prayerResponse.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.prayerEntry.deleteMany();
  await prisma.prayerRequest.deleteMany();
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
      role: 'user',
      banState: BanState.active,
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
        shortId: generateShortId(),
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
        shortId: generateShortId(),
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

  // Create prayer requests with entries
  console.log('🙏 Creating prayer requests with entries...');
  const prayerRequests = [];
  
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
    
    // Create prayer request
    const prayerRequest = await prisma.prayerRequest.create({
      data: {
        shortId: generateShortId(),
        groupId: group.id,
        authorId: author.id,
        title: title as string | null,
        sharedToCommunity,
        isAnonymous,
        status: isAnswered ? PrayerRequestStatus.answered : PrayerRequestStatus.open,
        lastActivityAt: createdAt,
        postCount: 1,
        amenCount: 0,
        createdAt,
      },
    });
    
    prayerRequests.push(prayerRequest);
    
    // Create initial request entry
    await prisma.prayerEntry.create({
      data: {
        shortId: generateShortId(),
        requestId: prayerRequest.id,
        authorId: author.id,
        kind: PrayerEntryKind.request,
        content: content as string | null,
        amenCount: 0,
        createdAt,
      },
    });
    
    // Add some encouragement entries (30% chance per request, 1-3 entries)
    if (Math.random() < 0.3) {
      const encouragementCount = faker.number.int({ min: 1, max: 3 });
      const otherMembers = groupMembers.filter(m => m.userId !== author.id);
      
      for (let j = 0; j < encouragementCount && otherMembers.length > 0; j++) {
        const encourager = faker.helpers.arrayElement(otherMembers);
        const entryDate = faker.date.between({ 
          from: createdAt, 
          to: new Date() 
        });
        await prisma.prayerEntry.create({
          data: {
            shortId: generateShortId(),
            requestId: prayerRequest.id,
            authorId: encourager.userId,
            kind: PrayerEntryKind.encouragement,
            content: faker.helpers.arrayElement(encouragementTemplates),
            amenCount: 0,
            createdAt: entryDate,
          },
        });
        // Update post count and last activity
        await prisma.prayerRequest.update({
          where: { id: prayerRequest.id },
          data: { 
            postCount: { increment: 1 },
            lastActivityAt: entryDate
          },
        });
      }
    }
    
    // Add update entries (15% chance, only from original author)
    if (Math.random() < 0.15) {
      const updateDate = faker.date.between({ 
        from: createdAt, 
        to: new Date() 
      });
      await prisma.prayerEntry.create({
        data: {
          shortId: generateShortId(),
          requestId: prayerRequest.id,
          authorId: author.id,
          kind: PrayerEntryKind.update,
          content: faker.helpers.arrayElement(updateTemplates),
          amenCount: 0,
          createdAt: updateDate,
        },
      });
      // Update post count and last activity
      await prisma.prayerRequest.update({
        where: { id: prayerRequest.id },
        data: { 
          postCount: { increment: 1 },
          lastActivityAt: updateDate
        },
      });
    }
    
    // Add testimony entry if request is answered
    if (isAnswered) {
      const testimonyDate = faker.date.between({ 
        from: createdAt, 
        to: new Date() 
      });
      await prisma.prayerEntry.create({
        data: {
          shortId: generateShortId(),
          requestId: prayerRequest.id,
          authorId: author.id,
          kind: PrayerEntryKind.testimony,
          content: faker.helpers.arrayElement(testimonyTemplates),
          amenCount: 0,
          createdAt: testimonyDate,
        },
      });
      // Update post count and last activity
      await prisma.prayerRequest.update({
        where: { id: prayerRequest.id },
        data: { 
          postCount: { increment: 1 },
          lastActivityAt: testimonyDate
        },
      });
    }
  }

  console.log('✅ Prayer requests and entries created');

  // Create prayer actions and responses
  console.log('❤️ Creating prayer actions and responses...');
  const entries = await prisma.prayerEntry.findMany({
    where: { kind: PrayerEntryKind.request },
    include: { request: { include: { group: { include: { members: true } } } } },
  });
  
  for (const entry of entries) {
    const groupMembers = entry.request.group?.members || [];
    const otherMembers = groupMembers.filter(m => m.userId !== entry.authorId);
    
    // 40-70% of other group members pray for each request
    const prayerRate = faker.number.float({ min: 0.4, max: 0.7 });
    const prayerCount = Math.floor(otherMembers.length * prayerRate);
    const prayers = faker.helpers.arrayElements(otherMembers, prayerCount);
    
    for (const prayer of prayers) {
      const prayedAt = faker.date.between({ 
        from: entry.createdAt, 
        to: new Date() 
      });
      
      // Create prayer action
      await prisma.prayerAction.create({
        data: {
          userId: prayer.userId,
          requestId: entry.requestId,
          entryId: entry.id,
          createdAt: prayedAt,
        },
      });
      
      // Create "amen" response
      await prisma.prayerResponse.create({
        data: {
          entryId: entry.id,
          userId: prayer.userId,
          type: PrayerResponseType.amen,
          payload: '',
          createdAt: prayedAt,
        },
      });
    }
    
    // Add some community prayers if shared to community (10-20% of other users)
    if (entry.request.sharedToCommunity) {
      const allOtherUsers = users.filter(u => 
        u.id !== entry.authorId && 
        !groupMembers.some(m => m.userId === u.id)
      );
      
      const communityPrayerRate = faker.number.float({ min: 0.1, max: 0.2 });
      const communityPrayerCount = Math.floor(allOtherUsers.length * communityPrayerRate);
      const communityPrayers = faker.helpers.arrayElements(allOtherUsers, communityPrayerCount);
      
      for (const prayer of communityPrayers) {
        const prayedAt = faker.date.between({ 
          from: entry.createdAt, 
          to: new Date() 
        });
        
        await prisma.prayerAction.create({
          data: {
            userId: prayer.id,
            requestId: entry.requestId,
            entryId: entry.id,
            createdAt: prayedAt,
          },
        });
        
        await prisma.prayerResponse.create({
          data: {
            entryId: entry.id,
            userId: prayer.id,
            type: PrayerResponseType.amen,
            payload: '',
            createdAt: prayedAt,
          },
        });
      }
    }
  }

  console.log('✅ Prayer actions and responses created');
  
  // Update amen counts on requests
  for (const request of prayerRequests) {
    const amenCount = await prisma.prayerResponse.count({
      where: {
        entry: { requestId: request.id },
        type: PrayerResponseType.amen
      }
    });
    await prisma.prayerRequest.update({
      where: { id: request.id },
      data: { amenCount }
    });
  }

  // Create some support records
  console.log('💰 Creating support records...');
  const sponsors = users.filter(u => u.isSponsor);
  
  for (const sponsor of sponsors) {
    await prisma.support.create({
      data: {
        userId: sponsor.id,
        amount: faker.number.float({ min: 10, max: 100, fractionDigits: 2 }),
        active: true,
      },
    });
  }

  console.log('✅ Support records created');

  // Get statistics
  const stats = {
    users: await prisma.user.count(),
    groups: await prisma.group.count(),
    coreGroups: await prisma.group.count({ where: { groupType: GroupType.core } }),
    circleGroups: await prisma.group.count({ where: { groupType: GroupType.circle } }),
    groupMembers: await prisma.groupMember.count(),
    prayerRequests: await prisma.prayerRequest.count(),
    communityRequests: await prisma.prayerRequest.count({ where: { sharedToCommunity: true } }),
    answeredRequests: await prisma.prayerRequest.count({ where: { status: PrayerRequestStatus.answered } }),
    prayerEntries: await prisma.prayerEntry.count(),
    requestEntries: await prisma.prayerEntry.count({ where: { kind: PrayerEntryKind.request } }),
    encouragementEntries: await prisma.prayerEntry.count({ where: { kind: PrayerEntryKind.encouragement } }),
    updateEntries: await prisma.prayerEntry.count({ where: { kind: PrayerEntryKind.update } }),
    testimonyEntries: await prisma.prayerEntry.count({ where: { kind: PrayerEntryKind.testimony } }),
    prayerActions: await prisma.prayerAction.count(),
    prayerResponses: await prisma.prayerResponse.count(),
    supports: await prisma.support.count(),
  };

  console.log('\n📊 Seeding complete! Database statistics:');
  console.log(`   👥 Users: ${stats.users}`);
  console.log(`   🤝 Groups: ${stats.groups} (${stats.coreGroups} core, ${stats.circleGroups} circle)`);
  console.log(`   👫 Group Members: ${stats.groupMembers}`);
  console.log(`   🙏 Prayer Requests: ${stats.prayerRequests} (${stats.communityRequests} shared to community, ${stats.answeredRequests} answered)`);
  console.log(`   📝 Prayer Entries: ${stats.prayerEntries} (${stats.requestEntries} requests, ${stats.encouragementEntries} encouragements, ${stats.updateEntries} updates, ${stats.testimonyEntries} testimonies)`);
  console.log(`   ❤️  Prayer Actions: ${stats.prayerActions}`);
  console.log(`   👍 Prayer Responses: ${stats.prayerResponses}`);
  console.log(`   💰 Support Records: ${stats.supports}`);
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