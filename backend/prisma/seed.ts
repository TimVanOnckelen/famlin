import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Example seed data. Replace these emails with actual family emails.
  const users = await Promise.all([
    prisma.user.upsert({
      where: { email: 'admin@example.com' },
      update: {},
      create: {
        email: 'admin@example.com',
        name: 'Admin',
        isAdmin: true,
      },
    }),
    prisma.user.upsert({
      where: { email: 'opa@example.com' },
      update: {},
      create: {
        email: 'opa@example.com',
        name: 'Opa Jan',
      },
    }),
    prisma.user.upsert({
      where: { email: 'oma@example.com' },
      update: {},
      create: {
        email: 'oma@example.com',
        name: 'Oma Riet',
      },
    }),
    prisma.user.upsert({
      where: { email: 'sophie@example.com' },
      update: {},
      create: {
        email: 'sophie@example.com',
        name: 'Sophie',
      },
    }),
    prisma.user.upsert({
      where: { email: 'mama@example.com' },
      update: {},
      create: {
        email: 'mama@example.com',
        name: 'Mama',
      },
    }),
  ]);

  const admin = users[0];
  const opa = users[1];
  const oma = users[2];
  const sophie = users[3];
  const mama = users[4];

  const familyGroup = await prisma.group.upsert({
    where: { id: 'seed-family-group' },
    update: {},
    create: {
      id: 'seed-family-group',
      name: 'Familie de Vries',
      description: 'Onze familiegroep',
    },
  });

  // Ensure memberships exist without conflicts
  const memberIds = [admin.id, opa.id, oma.id, sophie.id, mama.id];
  for (const userId of memberIds) {
    await prisma.groupMember.upsert({
      where: { groupId_userId: { groupId: familyGroup.id, userId } },
      update: {},
      create: { groupId: familyGroup.id, userId },
    });
  }

  // Create a sample milestone post
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

  // Create a sample regular post
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

  // Create a sample text-only post
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

  console.log('✅ Seed data created');
  console.log(`   Group: ${familyGroup.name}`);
  console.log(`   Members: ${memberIds.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
