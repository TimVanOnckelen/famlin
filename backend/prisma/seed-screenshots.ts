// One-off fixture for generating App Store screenshots. Not run automatically
// (unlike seed.ts, which docker-compose.override.yml runs on every dev
// container start) — invoke manually with `npx tsx prisma/seed-screenshots.ts`.
// Assumes the /uploads files referenced below already exist (copied in
// separately; this script only writes DB rows that point at them).
import { PrismaClient, ReactionType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const img = {
  anniversary0: '/uploads/17878d8b-44ae-4fa8-b380-9fa6ed8037d3.jpg',
  avatarAlex: '/uploads/2539b7a2-84af-4bd5-8732-2b421976c12f.jpg',
  avatarGrandpa: '/uploads/d9bb0460-f545-442e-809b-472fcccbcea1.jpg',
  avatarGrandma: '/uploads/a9096ee4-a600-48ed-8b57-7ffb7d7598bf.jpg',
  avatarDad: '/uploads/a0b96526-99a7-4ccd-89dc-814db971e0fa.jpg',
  avatarMom: '/uploads/1f61554d-6cbb-4411-891a-71f6c70bbd09.jpg',
  avatarSophie: '/uploads/1d71bf72-1a72-4b1f-bbd2-db63e6772a1f.jpg',
  avatarTestUser: '/uploads/864f53f4-0bfc-4431-a218-e0a1c67c7aac.jpg',
  bbq0: '/uploads/8b6748a3-0348-483a-965f-954b9f46578c.jpg',
  bbq1: '/uploads/232c421f-8f21-436d-996b-97558591f0f5.jpg',
  beach0: '/uploads/243f7bee-37d7-4e5a-b564-39aa8acb2d12.jpg',
  beach1: '/uploads/d87cbf81-7b4b-4299-9a49-4181c8bb152d.jpg',
  beach2: '/uploads/30222cc9-413e-4995-bce7-b92b4b6c0805.jpg',
  birthdayKid0: '/uploads/b92866f3-b9c1-4196-9af2-875ce269f4b8.jpg',
  birthdayTeen0: '/uploads/586d6eca-ace5-4d99-9aff-9b024d6944db.jpg',
  birthdayTeen1: '/uploads/3f2aac90-f151-4261-a20b-e9af24a0d148.jpg',
  dinner0: '/uploads/146dc697-5748-46c8-847a-20c2cf343cb2.jpg',
  garden0: '/uploads/f36529ce-1f38-411c-842d-15b529c47488.jpg',
  keys0: '/uploads/32e7c6fb-e33c-4692-8117-a6fd019b25f7.jpg',
  mountain0: '/uploads/181d9462-8493-4c1d-af3e-5a426b8cf8de.jpg',
  playground0: '/uploads/b0b8cba8-3e45-4f70-914d-04a999dc799c.jpg',
  puppy0: '/uploads/4be48732-a8d2-4c35-b521-7f5a79390a63.jpg',
  school0: '/uploads/8c66ad09-44f8-4eac-92d0-566a440e5833.jpg',
  snow0: '/uploads/4fba2dd7-c9e2-41fe-b959-6c24b66c5632.jpg',
  snow1: '/uploads/e87d358c-adf5-4ee0-8e36-b3240284271f.jpg',
  travel0: '/uploads/f7be58f2-b063-4617-974a-dec61f1c12a3.jpg',
  travel1: '/uploads/1b2d99fc-b695-4dea-92e0-a429ba818f7b.jpg',
};

function at(date: string, time: string) {
  return new Date(`${date}T${time}:00`);
}

async function main() {
  const testPasswordHash = await bcrypt.hash('test123456', 12);

  const admin = await prisma.user.create({
    data: {
      email: 'tim@xeweb.be',
      name: 'Tim',
      isAdmin: true,
      passwordHash: testPasswordHash,
      avatarUrl: img.avatarAlex,
    },
  });
  const grandpa = await prisma.user.create({
    data: { email: 'grandpa@example.com', name: 'Grandpa Joe', avatarUrl: img.avatarGrandpa },
  });
  const grandma = await prisma.user.create({
    data: { email: 'grandma@example.com', name: 'Grandma Rose', avatarUrl: img.avatarGrandma },
  });
  const dad = await prisma.user.create({
    data: { email: 'dad@example.com', name: 'Dad Mike', avatarUrl: img.avatarDad },
  });
  const mom = await prisma.user.create({
    data: { email: 'mom@example.com', name: 'Mom Emily', avatarUrl: img.avatarMom },
  });
  const sophie = await prisma.user.create({
    data: { email: 'sophie@example.com', name: 'Sophie', avatarUrl: img.avatarSophie },
  });
  const testUser = await prisma.user.create({
    data: {
      email: 'test@example.com',
      name: 'Test User',
      passwordHash: testPasswordHash,
      avatarUrl: img.avatarTestUser,
    },
  });

  const group = await prisma.group.create({
    data: { name: 'The Miller Family', description: 'Our family group' },
  });

  for (const userId of [admin.id, grandpa.id, grandma.id, dad.id, mom.id, sophie.id, testUser.id]) {
    await prisma.groupMember.create({ data: { groupId: group.id, userId } });
  }

  async function react(target: { postId?: string; commentId?: string }, userId: string, type: ReactionType) {
    await prisma.like.create({ data: { ...target, userId, type } });
  }

  // --- Posts, oldest to newest ---

  const travelPost = await prisma.post.create({
    data: {
      authorId: dad.id,
      groupId: group.id,
      content: 'Our first day in the Algarve! The kids jumped straight into the water. What a beautiful place. 🌊☀️',
      type: 'UPDATE',
      uploadedAssetUrls: [img.travel0, img.travel1],
      latitude: 37.0894,
      longitude: -8.2339,
      locationName: 'Algarve, Portugal',
      createdAt: at('2025-07-03', '14:00'),
    },
  });

  const teenBirthdayPost = await prisma.post.create({
    data: {
      authorId: mom.id,
      groupId: group.id,
      content: 'Sophie turned 16 today! Where does the time go. Congratulations, sweetheart. 🎉',
      type: 'MILESTONE',
      milestoneTag: '🎂 Birthday',
      uploadedAssetUrls: [img.birthdayTeen0, img.birthdayTeen1],
      createdAt: at('2025-09-01', '20:00'),
    },
  });

  const firstDaySchoolPost = await prisma.post.create({
    data: {
      authorId: sophie.id,
      groupId: group.id,
      content: "Emma's first day of school! She was so proud of her new backpack. 🎒",
      type: 'MILESTONE',
      milestoneTag: '🎒 First day of school',
      uploadedAssetUrls: [img.school0],
      createdAt: at('2025-11-15', '09:00'),
    },
  });

  const snowPost = await prisma.post.create({
    data: {
      authorId: sophie.id,
      groupId: group.id,
      content: 'Finally some snow! Built a snowman in the yard right away. ⛄❄️',
      type: 'UPDATE',
      uploadedAssetUrls: [img.snow0, img.snow1],
      createdAt: at('2026-01-05', '16:00'),
    },
  });

  const anniversaryPost = await prisma.post.create({
    data: {
      authorId: admin.id,
      groupId: group.id,
      content: 'Grandpa and Grandma celebrate 45 years of marriage today! What an example for all of us. 💍',
      type: 'MILESTONE',
      milestoneTag: '💍 Anniversary',
      uploadedAssetUrls: [img.anniversary0],
      createdAt: at('2026-02-14', '12:00'),
    },
  });

  const dinnerPost = await prisma.post.create({
    data: {
      authorId: mom.id,
      groupId: group.id,
      content: 'Had such a lovely family dinner on Sunday. Everyone together — so nice! 💛',
      type: 'UPDATE',
      uploadedAssetUrls: [img.dinner0],
      createdAt: at('2026-03-28', '18:30'),
    },
  });

  const gardenPost = await prisma.post.create({
    data: {
      authorId: grandpa.id,
      groupId: group.id,
      content: 'Spent the day working in the garden. The tomatoes look amazing this year! 🍅',
      type: 'UPDATE',
      uploadedAssetUrls: [img.garden0],
      createdAt: at('2026-04-14', '10:00'),
    },
  });

  const reportCardPost = await prisma.post.create({
    data: {
      authorId: mom.id,
      groupId: group.id,
      content: "Sophie's report card is in — top marks for the whole school year. One proud mom! 📋⭐",
      type: 'UPDATE',
      createdAt: at('2026-05-10', '13:00'),
    },
  });

  const examPost = await prisma.post.create({
    data: {
      authorId: dad.id,
      groupId: group.id,
      content: 'Sophie passed her driving test — on the first try! Time to celebrate with the keys. 🚗🔑',
      type: 'MILESTONE',
      milestoneTag: '🚗 Passed!',
      uploadedAssetUrls: [img.keys0],
      createdAt: at('2026-05-20', '19:00'),
    },
  });

  const beachPost = await prisma.post.create({
    data: {
      authorId: mom.id,
      groupId: group.id,
      content: 'Wonderful day at the beach with the whole family. Ice cream, sandcastles and way too much sun. 🏖️',
      type: 'UPDATE',
      uploadedAssetUrls: [img.beach0, img.beach1, img.beach2],
      latitude: 51.3314,
      longitude: 3.2033,
      locationName: 'Seaside Bay',
      createdAt: at('2026-06-02', '11:00'),
    },
  });

  const hikePost = await prisma.post.create({
    data: {
      authorId: dad.id,
      groupId: group.id,
      content: 'Took a lovely hike through the High Fens today. The view was worth every drop of sweat. 🥾',
      type: 'UPDATE',
      uploadedAssetUrls: [img.mountain0],
      latitude: 50.5001,
      longitude: 6.0800,
      locationName: 'High Fens',
      createdAt: at('2026-06-10', '15:30'),
    },
  });

  const puppyPost = await prisma.post.create({
    data: {
      authorId: dad.id,
      groupId: group.id,
      content: "Everyone, meet the newest member of the family! He's still tired from the trip home. 🐶",
      type: 'MILESTONE',
      milestoneTag: '🐶 New pet',
      uploadedAssetUrls: [img.puppy0],
      createdAt: at('2026-06-18', '20:05'),
    },
  });

  const playgroundPost = await prisma.post.create({
    data: {
      authorId: mom.id,
      groupId: group.id,
      content: "Afternoon at the playground with Emma. She didn't want to go home! 🛝",
      type: 'UPDATE',
      uploadedAssetUrls: [img.playground0],
      createdAt: at('2026-06-25', '17:20'),
    },
  });

  const bbqPost = await prisma.post.create({
    data: {
      authorId: grandpa.id,
      groupId: group.id,
      content: 'First BBQ of the year with the whole family together. The weather could not have been better! 🍖☀️',
      type: 'UPDATE',
      uploadedAssetUrls: [img.bbq0, img.bbq1],
      createdAt: at('2026-06-29', '12:00'),
    },
  });

  const kidBirthdayPost = await prisma.post.create({
    data: {
      authorId: sophie.id,
      groupId: group.id,
      content: 'Emma turned 6 today! 🎉 Our little girl was spoiled with cake and presents.',
      type: 'MILESTONE',
      milestoneTag: '🎂 Birthday',
      uploadedAssetUrls: [img.birthdayKid0],
      createdAt: at('2026-07-02', '18:40'),
    },
  });

  const todayPost = await prisma.post.create({
    data: {
      authorId: admin.id,
      groupId: group.id,
      content: 'Wishing everyone a great start to the week! ☀️',
      type: 'UPDATE',
      createdAt: at('2026-07-03', '09:15'),
    },
  });

  // --- Comments ---

  const travelComment = await prisma.comment.create({
    data: {
      postId: travelPost.id,
      authorId: sophie.id,
      content: 'What a wonderful trip that was! Can we go back soon? 🥹',
      createdAt: at('2025-07-03', '19:00'),
    },
  });
  await react({ commentId: travelComment.id }, dad.id, ReactionType.LOVE);

  const examComment1 = await prisma.comment.create({
    data: {
      postId: examPost.id,
      authorId: grandma.id,
      content: 'Well done, Sophie! So proud of you. 👏',
      createdAt: at('2026-05-20', '19:20'),
    },
  });
  await prisma.comment.create({
    data: {
      postId: examPost.id,
      authorId: sophie.id,
      parentId: examComment1.id,
      content: 'Thank you, Grandma! 🥰',
      createdAt: at('2026-05-20', '19:45'),
    },
  });
  await prisma.comment.create({
    data: {
      postId: examPost.id,
      authorId: grandpa.id,
      content: 'Already practicing for the first drive with Grandpa in the car? 😄',
      createdAt: at('2026-05-20', '20:10'),
    },
  });

  const beachComment1 = await prisma.comment.create({
    data: {
      postId: beachPost.id,
      authorId: grandma.id,
      content: 'What a lovely day, enjoy it!',
      createdAt: at('2026-06-02', '13:00'),
    },
  });
  await react({ commentId: beachComment1.id }, mom.id, ReactionType.LIKE);
  await prisma.comment.create({
    data: {
      postId: beachPost.id,
      authorId: grandpa.id,
      assetUrl: img.beach1,
      content: 'What a great sandcastle you built!',
      createdAt: at('2026-06-02', '14:15'),
    },
  });

  await prisma.comment.create({
    data: {
      postId: hikePost.id,
      authorId: mom.id,
      content: 'What a view! We should join next time.',
      createdAt: at('2026-06-10', '18:00'),
    },
  });

  const puppyComment1 = await prisma.comment.create({
    data: {
      postId: puppyPost.id,
      authorId: grandma.id,
      content: "He's adorable! What's his name?",
      createdAt: at('2026-06-18', '20:30'),
    },
  });
  await prisma.comment.create({
    data: {
      postId: puppyPost.id,
      authorId: dad.id,
      parentId: puppyComment1.id,
      content: "His name is Max! 🐾",
      createdAt: at('2026-06-18', '20:35'),
    },
  });
  await prisma.comment.create({
    data: {
      postId: puppyPost.id,
      authorId: sophie.id,
      content: "Finally!! Can't wait to give him a cuddle 😍",
      createdAt: at('2026-06-18', '21:00'),
    },
  });

  await prisma.comment.create({
    data: {
      postId: bbqPost.id,
      authorId: mom.id,
      content: 'Thanks for cooking, Grandpa, everything was delicious!',
      createdAt: at('2026-06-29', '14:00'),
    },
  });
  await prisma.comment.create({
    data: {
      postId: bbqPost.id,
      authorId: sophie.id,
      content: "Next time I'll help with the marinade 😋",
      createdAt: at('2026-06-29', '14:20'),
    },
  });

  const kidBirthdayComment1 = await prisma.comment.create({
    data: {
      postId: kidBirthdayPost.id,
      authorId: grandpa.id,
      content: 'What a cake! Happy birthday, Emma! 🎂',
      createdAt: at('2026-07-02', '19:00'),
    },
  });
  await prisma.comment.create({
    data: {
      postId: kidBirthdayPost.id,
      authorId: grandma.id,
      parentId: kidBirthdayComment1.id,
      content: 'Couldn\'t agree more, what a lovely party this was!',
      createdAt: at('2026-07-02', '19:10'),
    },
  });
  const kidBirthdayMention = await prisma.comment.create({
    data: {
      postId: kidBirthdayPost.id,
      authorId: dad.id,
      content: '@Tim could you also send the photos to Grandpa and Grandma?',
      createdAt: at('2026-07-02', '19:30'),
    },
  });
  await prisma.comment.create({
    data: {
      postId: kidBirthdayPost.id,
      authorId: mom.id,
      assetUrl: img.birthdayKid0,
      content: 'Look at those balloons! So well organized.',
      createdAt: at('2026-07-02', '19:45'),
    },
  });

  const todayComment = await prisma.comment.create({
    data: {
      postId: todayPost.id,
      authorId: mom.id,
      content: 'You too, have a great week! 😊',
      createdAt: at('2026-07-03', '09:45'),
    },
  });

  // --- Reactions on posts ---
  await react({ postId: travelPost.id }, admin.id, ReactionType.LOVE);
  await react({ postId: travelPost.id }, grandma.id, ReactionType.LOVE);

  await react({ postId: teenBirthdayPost.id }, grandpa.id, ReactionType.LOVE);
  await react({ postId: teenBirthdayPost.id }, grandma.id, ReactionType.LOVE);
  await react({ postId: teenBirthdayPost.id }, admin.id, ReactionType.LIKE);

  await react({ postId: firstDaySchoolPost.id }, grandma.id, ReactionType.LOVE);
  await react({ postId: firstDaySchoolPost.id }, grandpa.id, ReactionType.CARE);

  await react({ postId: snowPost.id }, dad.id, ReactionType.HAHA);
  await react({ postId: snowPost.id }, mom.id, ReactionType.LOVE);

  await react({ postId: anniversaryPost.id }, sophie.id, ReactionType.LOVE);
  await react({ postId: anniversaryPost.id }, mom.id, ReactionType.LOVE);
  await react({ postId: anniversaryPost.id }, dad.id, ReactionType.LOVE);
  await react({ postId: anniversaryPost.id }, grandma.id, ReactionType.CARE);

  await react({ postId: dinnerPost.id }, admin.id, ReactionType.LIKE);
  await react({ postId: dinnerPost.id }, grandpa.id, ReactionType.LOVE);

  await react({ postId: gardenPost.id }, grandma.id, ReactionType.WOW);
  await react({ postId: gardenPost.id }, admin.id, ReactionType.LIKE);

  await react({ postId: reportCardPost.id }, dad.id, ReactionType.WOW);
  await react({ postId: reportCardPost.id }, grandma.id, ReactionType.LOVE);

  await react({ postId: examPost.id }, admin.id, ReactionType.LOVE);
  await react({ postId: examPost.id }, mom.id, ReactionType.LOVE);
  await react({ postId: examPost.id }, grandma.id, ReactionType.WOW);

  await react({ postId: beachPost.id }, dad.id, ReactionType.WOW);
  await react({ postId: beachPost.id }, sophie.id, ReactionType.LOVE);
  await react({ postId: beachPost.id }, admin.id, ReactionType.LIKE);

  await react({ postId: hikePost.id }, mom.id, ReactionType.WOW);
  await react({ postId: hikePost.id }, grandma.id, ReactionType.LIKE);

  await react({ postId: puppyPost.id }, grandma.id, ReactionType.LOVE);
  await react({ postId: puppyPost.id }, grandpa.id, ReactionType.LOVE);
  await react({ postId: puppyPost.id }, mom.id, ReactionType.LOVE);
  await react({ postId: puppyPost.id }, sophie.id, ReactionType.LOVE);
  await react({ postId: puppyPost.id }, admin.id, ReactionType.HAHA);

  await react({ postId: playgroundPost.id }, grandma.id, ReactionType.CARE);
  await react({ postId: playgroundPost.id }, grandpa.id, ReactionType.LOVE);

  await react({ postId: bbqPost.id }, admin.id, ReactionType.LIKE);
  await react({ postId: bbqPost.id }, sophie.id, ReactionType.LOVE);
  await react({ postId: bbqPost.id }, mom.id, ReactionType.LOVE);

  await react({ postId: kidBirthdayPost.id }, grandpa.id, ReactionType.LOVE);
  await react({ postId: kidBirthdayPost.id }, grandma.id, ReactionType.LOVE);
  await react({ postId: kidBirthdayPost.id }, dad.id, ReactionType.LOVE);
  await react({ postId: kidBirthdayPost.id }, mom.id, ReactionType.CARE);
  await react({ postId: kidBirthdayPost.id }, admin.id, ReactionType.LOVE);

  await react({ postId: todayPost.id }, mom.id, ReactionType.LOVE);
  await react({ postId: todayPost.id }, sophie.id, ReactionType.LIKE);

  // --- Favorites (Admin's saved posts, for the Favorites screen) ---
  await prisma.favorite.create({ data: { postId: puppyPost.id, userId: admin.id } });
  await prisma.favorite.create({ data: { postId: kidBirthdayPost.id, userId: admin.id } });
  await prisma.favorite.create({ data: { postId: anniversaryPost.id, userId: admin.id } });

  // --- Notifications for Admin, newest first ---
  await prisma.notification.create({
    data: {
      userId: admin.id,
      type: 'on_this_day',
      relatedPostId: travelPost.id,
      message: 'A memory from The Miller Family — Dad Mike\'s post from 1 year ago: "Our first day in the Algarve! The kids jumped straight into the water..."',
      createdAt: at('2026-07-03', '08:00'),
    },
  });
  await prisma.notification.create({
    data: {
      userId: admin.id,
      type: 'new_like_post',
      relatedPostId: todayPost.id,
      message: 'Mom Emily reacted ❤️ to your post in The Miller Family: "Wishing everyone a great start to the week! ☀️"',
      createdAt: at('2026-07-03', '10:00'),
    },
  });
  await prisma.notification.create({
    data: {
      userId: admin.id,
      type: 'new_comment',
      relatedPostId: todayPost.id,
      message: `Mom Emily commented on a post in The Miller Family: "${todayComment.content}"`,
      createdAt: at('2026-07-03', '09:45'),
      readAt: at('2026-07-03', '09:50'),
    },
  });
  await prisma.notification.create({
    data: {
      userId: admin.id,
      type: 'mention',
      relatedPostId: kidBirthdayPost.id,
      message: `Dad Mike mentioned you in a comment in The Miller Family: "${kidBirthdayMention.content}"`,
      createdAt: at('2026-07-02', '19:30'),
    },
  });
  await prisma.notification.create({
    data: {
      userId: admin.id,
      type: 'new_post',
      relatedPostId: kidBirthdayPost.id,
      message: 'Sophie posted in The Miller Family: "Emma turned 6 today! 🎉 Our little girl was spoiled with cake and presents."',
      createdAt: at('2026-07-02', '18:40'),
      readAt: at('2026-07-02', '20:00'),
    },
  });
  await prisma.notification.create({
    data: {
      userId: admin.id,
      type: 'new_post',
      relatedPostId: puppyPost.id,
      message: 'Dad Mike posted in The Miller Family: "Everyone, meet the newest member of the family! He\'s still tired from the trip home. 🐶"',
      createdAt: at('2026-06-18', '20:10'),
      readAt: at('2026-06-18', '21:00'),
    },
  });
  await prisma.notification.create({
    data: {
      userId: admin.id,
      type: 'new_like_post',
      relatedPostId: dinnerPost.id,
      message: 'Grandpa Joe reacted ❤️ to your post in The Miller Family: "Had such a lovely family dinner on Sunday..."',
      createdAt: at('2026-03-28', '19:00'),
      readAt: at('2026-03-29', '08:00'),
    },
  });

  console.log('Screenshot fixtures created');
  console.log(`  Group: ${group.name} (${group.id})`);
  console.log('  Login: tim@xeweb.be / test123456 (admin)');
  console.log('         test@example.com / test123456');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
