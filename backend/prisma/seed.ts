import { PrismaClient, type ReactionType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const testPasswordHash = await bcrypt.hash('test123456', 12);

  // Users: one admin + one regular test account, plus a fictional family.
  const users = await Promise.all([
    prisma.user.upsert({
      where: { email: 'admin@example.com' },
      update: {},
      create: {
        email: 'admin@example.com',
        name: 'Admin',
        isAdmin: true,
        passwordHash: testPasswordHash,
      },
    }),
    prisma.user.upsert({
      where: { email: 'test@example.com' },
      update: {},
      create: {
        email: 'test@example.com',
        name: 'Test Gebruiker',
        passwordHash: testPasswordHash,
      },
    }),
    prisma.user.upsert({
      where: { email: 'opa@example.com' },
      update: {},
      create: { email: 'opa@example.com', name: 'Opa Jan' },
    }),
    prisma.user.upsert({
      where: { email: 'oma@example.com' },
      update: {},
      create: { email: 'oma@example.com', name: 'Oma Riet' },
    }),
    prisma.user.upsert({
      where: { email: 'mama@example.com' },
      update: {},
      create: { email: 'mama@example.com', name: 'Mama' },
    }),
    prisma.user.upsert({
      where: { email: 'papa@example.com' },
      update: {},
      create: { email: 'papa@example.com', name: 'Papa' },
    }),
    prisma.user.upsert({
      where: { email: 'sophie@example.com' },
      update: {},
      create: { email: 'sophie@example.com', name: 'Sophie' },
    }),
    prisma.user.upsert({
      where: { email: 'emma@example.com' },
      update: {},
      create: { email: 'emma@example.com', name: 'Emma' },
    }),
  ]);

  const [admin, testUser, opa, oma, mama, papa, sophie, emma] = users;

  // Two groups so the demo shows the multi-family experience.
  const familyGroup = await prisma.group.upsert({
    where: { id: 'seed-family-group' },
    update: {},
    create: {
      id: 'seed-family-group',
      name: 'Familie de Vries',
      description: 'Onze familiegroep',
    },
  });

  const weekendGroup = await prisma.group.upsert({
    where: { id: 'seed-weekend-group' },
    update: {},
    create: {
      id: 'seed-weekend-group',
      name: 'Weekendje Ardennen',
      description: 'Plannen en foto’s van ons weekendje weg',
    },
  });

  // Memberships.
  const familyMemberIds = [admin.id, testUser.id, opa.id, oma.id, mama.id, papa.id, sophie.id, emma.id];
  for (const userId of familyMemberIds) {
    await prisma.groupMember.upsert({
      where: { groupId_userId: { groupId: familyGroup.id, userId } },
      update: {},
      create: { groupId: familyGroup.id, userId },
    });
  }

  const weekendMemberIds = [admin.id, testUser.id, mama.id, papa.id, sophie.id, emma.id];
  for (const userId of weekendMemberIds) {
    await prisma.groupMember.upsert({
      where: { groupId_userId: { groupId: weekendGroup.id, userId } },
      update: {},
      create: { groupId: weekendGroup.id, userId },
    });
  }

  // Posts for the family group.
  await prisma.post.upsert({
    where: { id: 'seed-post-1' },
    update: {},
    create: {
      id: 'seed-post-1',
      authorId: sophie.id,
      groupId: familyGroup.id,
      content: 'Emma is 5 jaar! 🎉 Onze kleine meid is vandaag jarig. Wat vliegt de tijd!',
      type: 'MILESTONE',
      milestoneTag: '🎂 Verjaardag',
    },
  });

  await prisma.post.upsert({
    where: { id: 'seed-post-2' },
    update: {},
    create: {
      id: 'seed-post-2',
      authorId: opa.id,
      groupId: familyGroup.id,
      content: 'Vandaag lekker in de tuin gewerkt. De tomaten staan er prachtig bij dit jaar! 🍅',
      type: 'UPDATE',
    },
  });

  await prisma.post.upsert({
    where: { id: 'seed-post-3' },
    update: {},
    create: {
      id: 'seed-post-3',
      authorId: mama.id,
      groupId: familyGroup.id,
      content: 'Zondag zo\'n heerlijk familiediner gehad. Iedereen aanwezig — zo fijn! 💛',
      type: 'UPDATE',
    },
  });

  const pollPost = await prisma.post.upsert({
    where: { id: 'seed-post-poll' },
    update: {},
    create: {
      id: 'seed-post-poll',
      authorId: papa.id,
      groupId: familyGroup.id,
      content: 'Waar gaan we volgende maand met z\'n allen eten?',
      type: 'POLL',
      typeData: {
        options: [
          { id: 'opt-1', text: 'Italiaans 🍝' },
          { id: 'opt-2', text: 'Grieks 🥙' },
          { id: 'opt-3', text: 'Burgers 🍔' },
        ],
        closesAt: null,
      },
    },
  });

  // A few reactions on posts.
  await seedReaction({ postId: 'seed-post-1', userId: oma.id, type: 'LOVE' as ReactionType });
  await seedReaction({ postId: 'seed-post-1', userId: mama.id, type: 'LIKE' as ReactionType });
  await seedReaction({ postId: 'seed-post-2', userId: sophie.id, type: 'CARE' as ReactionType });
  await seedReaction({ postId: 'seed-post-poll', userId: mama.id, type: 'LIKE' as ReactionType });

  // Some poll votes via PostInteraction.
  await seedVote({ postId: pollPost.id, userId: mama.id, optionId: 'opt-1' });
  await seedVote({ postId: pollPost.id, userId: oma.id, optionId: 'opt-2' });
  await seedVote({ postId: pollPost.id, userId: sophie.id, optionId: 'opt-1' });

  // Comments on posts.
  await seedComment({
    id: 'seed-comment-1',
    postId: 'seed-post-1',
    authorId: oma.id,
    content: 'Gefeliciteerd lieve Emma! 🎈 Opa en ik komen zondag langs.',
  });
  await seedComment({
    id: 'seed-comment-2',
    postId: 'seed-post-1',
    authorId: mama.id,
    content: 'Dankjewel mam, tot zondag!',
    parentId: 'seed-comment-1',
  });
  await seedComment({
    id: 'seed-comment-3',
    postId: 'seed-post-2',
    authorId: papa.id,
    content: 'Die tomaten zien er inderdaad goed uit, opa!',
  });

  // Trip post for the weekend group.
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 1);
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + 2);

  const tripPost = await prisma.post.upsert({
    where: { id: 'seed-post-trip' },
    update: {},
    create: {
      id: 'seed-post-trip',
      authorId: papa.id,
      groupId: weekendGroup.id,
      content: 'Met z\'n zessen naar de Ardennen! 🌲',
      type: 'TRIP',
      typeData: {
        title: 'Weekendje Ardennen',
        destination: 'La Roche-en-Ardenne',
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
        coverPhotoUrl: null,
        travelerUserIds: [mama.id, sophie.id, emma.id],
        closedAt: null,
        closedByUserId: null,
      },
    },
  });

  // A couple of trip check-ins as comments with metadata.
  await seedTripCheckin({
    id: 'seed-checkin-1',
    postId: tripPost.id,
    authorId: papa.id,
    text: 'Aangekomen! Het huisje is perfect.',
    place: 'La Roche-en-Ardenne',
    checkinId: 'checkin-a',
  });
  await seedTripCheckin({
    id: 'seed-checkin-2',
    postId: tripPost.id,
    authorId: mama.id,
    text: 'Lekker gewandeld vandaag.',
    place: 'Bois de La Roche',
    checkinId: 'checkin-b',
  });

  // Favorites.
  await seedFavorite({ postId: 'seed-post-1', userId: oma.id });
  await seedFavorite({ postId: 'seed-post-trip', userId: sophie.id });

  console.log('✅ Seed data created');
  console.log(`   Groups: ${familyGroup.name}, ${weekendGroup.name}`);
  console.log(`   Family members: ${familyMemberIds.length}`);
  console.log('   Test accounts:');
  console.log('     - admin@example.com / test123456 (admin)');
  console.log('     - test@example.com / test123456');
}

async function seedReaction({ postId, userId, type }: { postId: string; userId: string; type: ReactionType }) {
  await prisma.like.upsert({
    where: { postId_userId: { postId, userId } },
    update: {},
    create: { postId, userId, type },
  });
}

async function seedVote({ postId, userId, optionId }: { postId: string; userId: string; optionId: string }) {
  await prisma.postInteraction.upsert({
    where: { postId_userId_key: { postId, userId, key: 'vote' } },
    update: {},
    create: {
      postId,
      userId,
      key: 'vote',
      value: { optionId },
    },
  });
}

async function seedComment({
  id,
  postId,
  authorId,
  content,
  parentId,
}: {
  id: string;
  postId: string;
  authorId: string;
  content: string;
  parentId?: string;
}) {
  await prisma.comment.upsert({
    where: { id },
    update: {},
    create: { id, postId, authorId, content, parentId },
  });
}

async function seedTripCheckin({
  id,
  postId,
  authorId,
  text,
  place,
  checkinId,
}: {
  id: string;
  postId: string;
  authorId: string;
  text: string;
  place: string;
  checkinId: string;
}) {
  await prisma.comment.upsert({
    where: { id },
    update: {},
    create: {
      id,
      postId,
      authorId,
      content: text,
      metadata: { kind: 'trip_checkin', checkinId, place, photoUrls: [] },
    },
  });
}

async function seedFavorite({ postId, userId }: { postId: string; userId: string }) {
  await prisma.favorite.upsert({
    where: { postId_userId: { postId, userId } },
    update: {},
    create: { postId, userId },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
