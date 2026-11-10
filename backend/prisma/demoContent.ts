import type { PrismaClient, ReactionType } from '@prisma/client'
import { scatter, type Scene } from './demoPhotos.js'

// The demo's sample family beyond the basics in seed.ts: photos, an album, an
// event, a circle, a gift list, chat, wiki pages, stories and notifications —
// so every part of the app has something to show on a read-only demo.
//
// Everything is keyed on fixed ids and upserted, so the seed can run on every
// start. A few rows are refreshed on each run on purpose (the live stories
// and the "on this day" memory), because they are only meaningful relative to
// today.

export interface DemoUsers {
  admin: { id: string }
  testUser: { id: string }
  opa: { id: string }
  oma: { id: string }
  mama: { id: string }
  papa: { id: string }
  sophie: { id: string }
  emma: { id: string }
}

export interface DemoGroups {
  family: { id: string }
  weekend: { id: string }
}

// Upload UUIDs: the files are /uploads/<uuid>.jpg (see demoPhotos.ts).
const PHOTO = {
  birthday: 'd3e0a000-0000-4000-8000-000000000001',
  garden: 'd3e0a000-0000-4000-8000-000000000002',
  dinner: 'd3e0a000-0000-4000-8000-000000000003',
  forest: 'd3e0a000-0000-4000-8000-000000000004',
  sunset: 'd3e0a000-0000-4000-8000-000000000005',
  beach: 'd3e0a000-0000-4000-8000-000000000006',
  beachSunset: 'd3e0a000-0000-4000-8000-000000000007',
  snow: 'd3e0a000-0000-4000-8000-000000000008',
  pie: 'd3e0a000-0000-4000-8000-000000000009',
  shells: 'd3e0a000-0000-4000-8000-00000000000a',
  run: 'd3e0a000-0000-4000-8000-00000000000b',
  cabin: 'd3e0a000-0000-4000-8000-00000000000c',
  storyBeach: 'd3e0a000-0000-4000-8000-00000000000d',
  storyFlowers: 'd3e0a000-0000-4000-8000-00000000000e',
  storyLake: 'd3e0a000-0000-4000-8000-00000000000f',
} as const

export const photoUrl = (name: keyof typeof PHOTO) => `/uploads/${PHOTO[name]}.jpg`

const portrait = { width: 900, height: 1600 }

export const DEMO_SCENES: Record<string, Scene> = {
  [PHOTO.birthday]: {
    sky: [
      [255, 214, 224],
      [255, 238, 214],
    ],
    discs: [
      ...scatter(
        60,
        7,
        { x: [0, 1], y: [0, 1] },
        [0.004, 0.009],
        [
          [255, 255, 255],
          [255, 196, 94],
          [120, 200, 220],
        ]
      ),
      ...scatter(
        9,
        3,
        { x: [0.12, 0.88], y: [0.18, 0.62] },
        [0.05, 0.075],
        [
          [237, 92, 120],
          [255, 176, 59],
          [86, 170, 214],
          [146, 112, 214],
          [96, 196, 140],
        ]
      ),
    ],
    bands: [{ top: 0.78, bottom: 1, from: [214, 150, 120], to: [186, 120, 96] }],
  },
  [PHOTO.garden]: {
    sky: [
      [140, 196, 236],
      [220, 238, 250],
    ],
    sun: { x: 0.82, y: 0.16, r: 0.06, color: [255, 236, 170] },
    ridges: [
      { color: [118, 170, 96], base: 0.5, amplitude: 0.03, frequency: 1.2, phase: 0.4 },
      { color: [84, 140, 70], base: 0.62, amplitude: 0.02, frequency: 2, phase: 1.3 },
    ],
    discs: [
      ...scatter(
        14,
        11,
        { x: [0.08, 0.92], y: [0.68, 0.94] },
        [0.025, 0.04],
        [
          [214, 52, 44],
          [232, 74, 50],
          [196, 40, 40],
        ]
      ),
    ],
  },
  [PHOTO.dinner]: {
    sky: [
      [92, 56, 40],
      [176, 112, 66],
    ],
    discs: [
      ...scatter(
        18,
        5,
        { x: [0, 1], y: [0.02, 0.4] },
        [0.006, 0.014],
        [
          [255, 220, 140],
          [255, 236, 190],
        ]
      ),
    ],
    bands: [{ top: 0.5, bottom: 1, from: [150, 92, 54], to: [112, 66, 38] }],
  },
  [PHOTO.forest]: {
    sky: [
      [200, 220, 214],
      [236, 240, 232],
    ],
    ridges: [
      { color: [150, 178, 160], base: 0.38, amplitude: 0.05, frequency: 1.5, phase: 0.2 },
      { color: [96, 138, 108], base: 0.5, amplitude: 0.05, frequency: 2.2, phase: 2 },
      { color: [58, 98, 72], base: 0.64, amplitude: 0.04, frequency: 3, phase: 0.9 },
      { color: [36, 70, 50], base: 0.8, amplitude: 0.03, frequency: 4, phase: 1.6 },
    ],
  },
  [PHOTO.sunset]: {
    sky: [
      [92, 72, 140],
      [252, 160, 100],
    ],
    sun: { x: 0.35, y: 0.6, r: 0.08, color: [255, 214, 140] },
    ridges: [
      { color: [116, 74, 110], base: 0.62, amplitude: 0.04, frequency: 1.4, phase: 1 },
      { color: [64, 44, 76], base: 0.74, amplitude: 0.03, frequency: 2.4, phase: 0.3 },
    ],
  },
  [PHOTO.beach]: {
    sky: [
      [104, 176, 230],
      [200, 230, 248],
    ],
    sun: { x: 0.18, y: 0.18, r: 0.05, color: [255, 248, 214] },
    bands: [
      { top: 0.52, bottom: 0.7, from: [40, 130, 180], to: [80, 170, 200] },
      { top: 0.7, bottom: 1, from: [238, 214, 170], to: [224, 196, 150] },
    ],
  },
  [PHOTO.beachSunset]: {
    sky: [
      [250, 132, 92],
      [255, 210, 150],
    ],
    sun: { x: 0.55, y: 0.5, r: 0.07, color: [255, 236, 190] },
    bands: [
      { top: 0.55, bottom: 0.78, from: [196, 104, 104], to: [120, 86, 120] },
      { top: 0.78, bottom: 1, from: [96, 72, 90], to: [70, 56, 72] },
    ],
  },
  [PHOTO.snow]: {
    sky: [
      [176, 196, 220],
      [236, 242, 250],
    ],
    ridges: [
      { color: [214, 224, 238], base: 0.45, amplitude: 0.08, frequency: 1.1, phase: 0.5 },
      { color: [246, 249, 253], base: 0.66, amplitude: 0.03, frequency: 1.8, phase: 2.1 },
    ],
    discs: [...scatter(120, 13, { x: [0, 1], y: [0, 1] }, [0.002, 0.005], [[255, 255, 255]])],
  },
  [PHOTO.pie]: {
    sky: [
      [246, 232, 210],
      [230, 210, 184],
    ],
    discs: [
      { x: 0.5, y: 0.55, r: 0.3, color: [250, 250, 248] },
      { x: 0.5, y: 0.55, r: 0.24, color: [204, 140, 66] },
      { x: 0.5, y: 0.55, r: 0.2, color: [222, 166, 86] },
      ...scatter(10, 17, { x: [0.38, 0.62], y: [0.45, 0.65] }, [0.012, 0.02], [[186, 112, 48]]),
    ],
  },
  [PHOTO.shells]: {
    sky: [
      [236, 220, 186],
      [214, 192, 152],
    ],
    discs: scatter(
      16,
      21,
      { x: [0.08, 0.92], y: [0.1, 0.9] },
      [0.018, 0.04],
      [
        [252, 244, 236],
        [244, 204, 196],
        [230, 216, 196],
      ]
    ),
  },
  [PHOTO.run]: {
    sky: [
      [255, 196, 150],
      [196, 222, 240],
    ],
    sun: { x: 0.7, y: 0.42, r: 0.05, color: [255, 240, 200] },
    ridges: [
      { color: [140, 170, 120], base: 0.58, amplitude: 0.02, frequency: 1.3, phase: 2.4 },
      { color: [96, 132, 92], base: 0.7, amplitude: 0.015, frequency: 2, phase: 0.6 },
    ],
    bands: [{ top: 0.86, bottom: 1, from: [170, 150, 130], to: [150, 130, 112] }],
  },
  [PHOTO.cabin]: {
    sky: [
      [150, 190, 210],
      [214, 230, 236],
    ],
    ridges: [
      { color: [70, 112, 82], base: 0.46, amplitude: 0.06, frequency: 2.6, phase: 0.1 },
      { color: [112, 150, 92], base: 0.72, amplitude: 0.01, frequency: 1, phase: 0 },
    ],
    discs: [{ x: 0.5, y: 0.66, r: 0.09, color: [150, 92, 60] }],
  },
  [PHOTO.storyBeach]: {
    ...portrait,
    sky: [
      [116, 186, 236],
      [212, 238, 250],
    ],
    sun: { x: 0.7, y: 0.14, r: 0.08, color: [255, 248, 214] },
    bands: [
      { top: 0.5, bottom: 0.68, from: [36, 124, 176], to: [86, 176, 206] },
      { top: 0.68, bottom: 1, from: [240, 218, 176], to: [222, 194, 148] },
    ],
  },
  [PHOTO.storyFlowers]: {
    ...portrait,
    sky: [
      [176, 214, 240],
      [226, 240, 250],
    ],
    ridges: [{ color: [104, 160, 88], base: 0.55, amplitude: 0.02, frequency: 1.5, phase: 1 }],
    discs: scatter(
      40,
      29,
      { x: [0.05, 0.95], y: [0.6, 0.97] },
      [0.025, 0.05],
      [
        [244, 116, 150],
        [255, 206, 84],
        [190, 132, 228],
        [255, 255, 255],
      ]
    ),
  },
  [PHOTO.storyLake]: {
    ...portrait,
    sky: [
      [126, 104, 170],
      [252, 176, 128],
    ],
    sun: { x: 0.5, y: 0.44, r: 0.09, color: [255, 222, 160] },
    ridges: [{ color: [70, 60, 96], base: 0.5, amplitude: 0.03, frequency: 1.6, phase: 0.7 }],
    bands: [{ top: 0.56, bottom: 1, from: [214, 140, 128], to: [86, 72, 118] }],
  },
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

export async function seedDemoContent(prisma: PrismaClient, u: DemoUsers, g: DemoGroups): Promise<void> {
  const now = Date.now()
  const ago = (ms: number) => new Date(now - ms)
  const ahead = (ms: number) => new Date(now + ms)

  // The family chat is part of the demo.
  await prisma.group.update({ where: { id: g.family.id }, data: { chitchatEnabled: true } })

  // ── Upload rows: who may read each generated photo ──────────────────────
  const familyPhotos: (keyof typeof PHOTO)[] = [
    'birthday',
    'garden',
    'dinner',
    'beach',
    'beachSunset',
    'snow',
    'pie',
    'shells',
    'run',
    'storyBeach',
    'storyFlowers',
    'storyLake',
  ]
  const weekendPhotos: (keyof typeof PHOTO)[] = ['forest', 'sunset', 'cabin']
  for (const name of familyPhotos) await bindPhoto(prisma, name, u.admin.id, [g.family.id])
  for (const name of weekendPhotos) await bindPhoto(prisma, name, u.admin.id, [g.weekend.id])

  // ── More posts ────────────────────────────────────────────────────────────
  await prisma.post.upsert({
    where: { id: 'seed-post-pie' },
    update: {},
    create: {
      id: 'seed-post-pie',
      authorId: u.oma.id,
      groupId: g.family.id,
      content:
        'Baked my famous apple pie today 🥧 The recipe is in the family wiki now, so nobody has to call me for it anymore!',
      uploadedAssetUrls: [photoUrl('pie')],
      createdAt: ago(5 * HOUR),
    },
  })

  await prisma.post.upsert({
    where: { id: 'seed-post-run' },
    update: {},
    create: {
      id: 'seed-post-run',
      authorId: u.testUser.id,
      groupId: g.family.id,
      content: 'Look at this view from my run this morning 🏃‍♀️',
      uploadedAssetUrls: [photoUrl('run')],
      createdAt: ago(26 * HOUR),
    },
  })

  // "On this day": kept at exactly one year ago so the feed's memory banner
  // always has something to show.
  const oneYearAgo = new Date(now)
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  await prisma.post.upsert({
    where: { id: 'seed-post-memory' },
    update: { createdAt: oneYearAgo },
    create: {
      id: 'seed-post-memory',
      authorId: u.mama.id,
      groupId: g.family.id,
      content: 'First snow of the year! ❄️ The kids built a snowman before breakfast.',
      uploadedAssetUrls: [photoUrl('snow')],
      createdAt: oneYearAgo,
    },
  })

  await prisma.post.upsert({
    where: { id: 'seed-post-album' },
    update: {},
    create: {
      id: 'seed-post-album',
      authorId: u.sophie.id,
      groupId: g.family.id,
      content: 'Our week at the coast — add your photos too!',
      type: 'ALBUM',
      typeData: {
        title: 'Summer at the coast',
        coverPhotoUrl: photoUrl('beach'),
        closedAt: null,
        closedByUserId: null,
      },
      createdAt: ago(2 * HOUR),
    },
  })
  await seedAlbumPhotos(
    prisma,
    'seed-album-photos-1',
    'seed-post-album',
    u.sophie.id,
    [photoUrl('beach'), photoUrl('shells')],
    ago(2 * HOUR)
  )
  await seedAlbumPhotos(
    prisma,
    'seed-album-photos-2',
    'seed-post-album',
    u.mama.id,
    [photoUrl('beachSunset')],
    ago(90 * 60 * 1000)
  )

  const isoDay = (date: Date) => date.toISOString()
  const bbq = ahead(12 * DAY)
  bbq.setUTCHours(15, 0, 0, 0)
  const bbqEnd = new Date(bbq.getTime() + 5 * HOUR)
  const rsvpBy = ahead(9 * DAY)
  rsvpBy.setUTCHours(20, 0, 0, 0)
  await prisma.post.upsert({
    where: { id: 'seed-post-event' },
    update: {},
    create: {
      id: 'seed-post-event',
      authorId: u.opa.id,
      groupId: g.family.id,
      content: "Summer barbecue at Grandpa & Grandma's 🍔",
      type: 'EVENT',
      typeData: {
        startsAt: isoDay(bbq),
        endsAt: isoDay(bbqEnd),
        location: "Grandpa & Grandma's garden",
        rsvpDeadline: isoDay(rsvpBy),
      },
      createdAt: ago(30 * HOUR),
    },
  })
  for (const [userId, value] of [
    [u.oma.id, 'yes'],
    [u.mama.id, 'yes'],
    [u.papa.id, 'yes'],
    [u.sophie.id, 'maybe'],
    [u.admin.id, 'no'],
  ] as const) {
    await prisma.postInteraction.upsert({
      where: { postId_userId_key: { postId: 'seed-post-event', userId, key: 'rsvp' } },
      update: {},
      create: { postId: 'seed-post-event', userId, key: 'rsvp', value },
    })
  }

  // A Family Circle: everyone but the grandparents, planning a surprise.
  await prisma.circle.upsert({
    where: { id: 'seed-circle-surprise' },
    update: {},
    create: {
      id: 'seed-circle-surprise',
      groupId: g.family.id,
      name: "Grandma's surprise",
      description: "Planning Grandma Rose's 70th — don't tell her!",
      createdById: u.admin.id,
    },
  })
  for (const user of [u.admin, u.testUser, u.mama, u.papa, u.sophie]) {
    await prisma.circleMember.upsert({
      where: { circleId_userId: { circleId: 'seed-circle-surprise', userId: user.id } },
      update: {},
      create: { circleId: 'seed-circle-surprise', userId: user.id },
    })
  }
  await prisma.post.upsert({
    where: { id: 'seed-post-circle' },
    update: {},
    create: {
      id: 'seed-post-circle',
      authorId: u.mama.id,
      groupId: g.family.id,
      circleId: 'seed-circle-surprise',
      content: "Shh 🤫 Grandma turns 70 next month. I'm thinking a surprise brunch — who can help with the photo book?",
      createdAt: ago(20 * HOUR),
    },
  })

  // A gift list with the draw already done. The participants are a hidden
  // GIFT_LIST circle, as the post type creates it.
  const participants = [u.mama, u.papa, u.sophie, u.testUser, u.oma]
  await prisma.circle.upsert({
    where: { id: 'seed-circle-giftlist' },
    update: {},
    create: {
      id: 'seed-circle-giftlist',
      groupId: g.family.id,
      kind: 'GIFT_LIST',
      name: 'Christmas gift exchange',
      createdById: u.mama.id,
    },
  })
  for (const user of participants) {
    await prisma.circleMember.upsert({
      where: { circleId_userId: { circleId: 'seed-circle-giftlist', userId: user.id } },
      update: {},
      create: { circleId: 'seed-circle-giftlist', userId: user.id },
    })
  }
  const christmas = new Date(now)
  christmas.setMonth(11, 24)
  if (christmas.getTime() < now) christmas.setFullYear(christmas.getFullYear() + 1)
  await prisma.post.upsert({
    where: { id: 'seed-post-giftlist' },
    update: {},
    create: {
      id: 'seed-post-giftlist',
      authorId: u.mama.id,
      groupId: g.family.id,
      circleId: 'seed-circle-giftlist',
      content: 'Secret Santa time! 🎁 Add your wishes so your Santa has some ideas.',
      type: 'GIFT_LIST',
      typeData: {
        title: 'Christmas gift exchange',
        occasionDate: christmas.toISOString().slice(0, 10),
        drawEnabled: true,
        budget: '€30',
        exclusions: [],
        drawnAt: ago(3 * DAY).toISOString(),
      },
      createdAt: ago(4 * DAY),
    },
  })
  // giver → recipient, one cycle through everyone.
  const draw: [string, string][] = participants.map((giver, i) => [
    giver.id,
    participants[(i + 1) % participants.length].id,
  ])
  for (const [giverId, recipientId] of draw) {
    await prisma.giftDrawAssignment.upsert({
      where: { postId_giverId: { postId: 'seed-post-giftlist', giverId } },
      update: {},
      create: { postId: 'seed-post-giftlist', giverId, recipientId },
    })
  }
  const wishes: { id: string; ownerId: string; title: string; note?: string; url?: string }[] = [
    {
      id: 'seed-wish-1',
      ownerId: u.testUser.id,
      title: 'Ticket to Ride (board game)',
      note: 'The Europe edition, please!',
    },
    { id: 'seed-wish-2', ownerId: u.testUser.id, title: 'Cozy wool socks' },
    { id: 'seed-wish-3', ownerId: u.oma.id, title: 'Gardening gloves', note: 'Size M' },
    { id: 'seed-wish-4', ownerId: u.oma.id, title: 'A photo book of the grandkids' },
    { id: 'seed-wish-5', ownerId: u.sophie.id, title: 'Wireless headphones', url: 'https://example.com/headphones' },
    { id: 'seed-wish-6', ownerId: u.papa.id, title: 'A good barbecue cookbook' },
    { id: 'seed-wish-7', ownerId: u.mama.id, title: 'Weekend at a spa 💆', note: 'One can dream…' },
  ]
  for (const [position, wish] of wishes.entries()) {
    await prisma.giftListItem.upsert({
      where: { id: wish.id },
      update: {},
      create: { ...wish, postId: 'seed-post-giftlist', position },
    })
  }

  // ── Comments, reactions and favorites on the new posts ──────────────────
  await seedComment(prisma, {
    id: 'seed-comment-pie-1',
    postId: 'seed-post-pie',
    authorId: u.sophie.id,
    content: 'Saving this! Can we have it at the barbecue? 😋',
    createdAt: ago(4 * HOUR),
  })
  await seedComment(prisma, {
    id: 'seed-comment-pie-2',
    postId: 'seed-post-pie',
    authorId: u.oma.id,
    content: 'Of course, sweetheart.',
    parentId: 'seed-comment-pie-1',
    createdAt: ago(3 * HOUR),
  })
  await seedComment(prisma, {
    id: 'seed-comment-album-1',
    postId: 'seed-post-album',
    authorId: u.mama.id,
    content: 'Test User, you have to come with us next year! 🌊',
    createdAt: ago(80 * 60 * 1000),
  })
  await seedComment(prisma, {
    id: 'seed-comment-run-1',
    postId: 'seed-post-run',
    authorId: u.oma.id,
    content: 'Beautiful! Don’t forget to drink enough water.',
    createdAt: ago(20 * HOUR),
  })
  await seedComment(prisma, {
    id: 'seed-comment-memory-1',
    postId: 'seed-post-memory',
    authorId: u.opa.id,
    content: 'Best snowman of the street ⛄',
    createdAt: oneYearAgo,
  })
  await seedComment(prisma, {
    id: 'seed-comment-garden-photo',
    postId: 'seed-post-2',
    authorId: u.opa.id,
    content: 'And here is the first harvest!',
    attachmentUrls: [photoUrl('garden')],
    createdAt: ago(6 * HOUR),
  })

  const reactions: [string, string, ReactionType][] = [
    ['seed-post-pie', u.mama.id, 'LOVE'],
    ['seed-post-pie', u.sophie.id, 'LOVE'],
    ['seed-post-pie', u.papa.id, 'WOW'],
    ['seed-post-pie', u.opa.id, 'LIKE'],
    ['seed-post-album', u.oma.id, 'LOVE'],
    ['seed-post-album', u.papa.id, 'LIKE'],
    ['seed-post-run', u.oma.id, 'LOVE'],
    ['seed-post-run', u.sophie.id, 'WOW'],
    ['seed-post-memory', u.oma.id, 'CARE'],
    ['seed-post-event', u.mama.id, 'LIKE'],
    ['seed-post-trip', u.oma.id, 'LOVE'],
    ['seed-post-3', u.opa.id, 'LOVE'],
  ]
  for (const [postId, userId, type] of reactions) {
    await prisma.like.upsert({
      where: { postId_userId: { postId, userId } },
      update: {},
      create: { postId, userId, type },
    })
  }

  for (const [postId, userId] of [
    ['seed-post-1', u.testUser.id],
    ['seed-post-album', u.testUser.id],
    ['seed-post-pie', u.testUser.id],
    ['seed-post-trip', u.admin.id],
    ['seed-post-pie', u.admin.id],
  ]) {
    await prisma.favorite.upsert({
      where: { postId_userId: { postId, userId } },
      update: {},
      create: { postId, userId },
    })
  }

  // ── Family chat ───────────────────────────────────────────────────────────
  const chat: {
    id: string
    authorId: string
    content: string
    at: Date
    kind?: string
    refPostId?: string
    attachmentUrl?: string
    replyToMessageId?: string
  }[] = [
    {
      id: 'seed-chat-1',
      authorId: u.sophie.id,
      kind: 'SYSTEM_MILESTONE',
      content: '🎂 Sophie shared a milestone: 🎂 Birthday',
      refPostId: 'seed-post-1',
      at: ago(2 * DAY),
    },
    { id: 'seed-chat-2', authorId: u.papa.id, content: "Who's bringing what to the barbecue?", at: ago(30 * HOUR) },
    { id: 'seed-chat-3', authorId: u.oma.id, content: "I'll make my potato salad 🥔", at: ago(29 * HOUR) },
    {
      id: 'seed-chat-4',
      authorId: u.mama.id,
      content: 'Dessert is on us!',
      replyToMessageId: 'seed-chat-2',
      at: ago(28 * HOUR),
    },
    {
      id: 'seed-chat-5',
      authorId: u.opa.id,
      content: 'First tomatoes are ripe 🍅',
      attachmentUrl: photoUrl('garden'),
      at: ago(6 * HOUR),
    },
    {
      id: 'seed-chat-6',
      authorId: u.sophie.id,
      content: 'Can we go back to the beach next weekend? 🏖️',
      at: ago(2 * HOUR),
    },
    { id: 'seed-chat-7', authorId: u.papa.id, content: 'If the weather holds, sure!', at: ago(1 * HOUR) },
  ]
  for (const message of chat) {
    await prisma.chatMessage.upsert({
      where: { id: message.id },
      update: {},
      create: {
        id: message.id,
        groupId: g.family.id,
        authorId: message.authorId,
        kind: message.kind ?? 'USER',
        content: message.content,
        refPostId: message.refPostId,
        attachmentUrl: message.attachmentUrl,
        replyToMessageId: message.replyToMessageId,
        createdAt: message.at,
      },
    })
  }
  // Everyone has read the chat except the two demo accounts, so their chat
  // tab shows unread messages.
  for (const user of [u.opa, u.oma, u.mama, u.papa, u.sophie, u.emma, u.testUser, u.admin]) {
    const unread = user === u.testUser || user === u.admin
    await prisma.chatRead.upsert({
      where: { groupId_userId: { groupId: g.family.id, userId: user.id } },
      update: {},
      create: { groupId: g.family.id, userId: user.id, lastReadAt: unread ? ago(29 * HOUR) : ago(0) },
    })
  }

  // ── Family Wiki ───────────────────────────────────────────────────────────
  const wiki: {
    id: string
    groupId: string
    title: string
    emoji: string
    category: string | null
    locked?: boolean
    createdById: string
    content: string
  }[] = [
    {
      id: 'seed-wiki-pie',
      groupId: g.family.id,
      title: "Grandma's apple pie",
      emoji: '🥧',
      category: 'Recipes',
      createdById: u.oma.id,
      content: `The pie everybody asks for at every birthday.

![Apple pie](${photoUrl('pie')})

## Ingredients
- 300 g flour
- 200 g cold butter
- 150 g sugar
- 1 egg
- 1 kg apples (Jonagold or Boskoop)
- Cinnamon and a handful of raisins

## Method
1. Rub the butter into the flour and sugar, then add the egg and knead briefly.
2. Let the dough rest in the fridge for 30 minutes.
3. Peel and slice the apples, toss them with cinnamon and raisins.
4. Line the tin, fill it, and make a lattice with the rest of the dough.
5. Bake for about 60 minutes at 175 °C.

> Tip from Grandma: let it cool for at least 20 minutes, or it falls apart.

See it in action: [Grandma's pie post](/posts/seed-post-pie)`,
    },
    {
      id: 'seed-wiki-house',
      groupId: g.family.id,
      title: 'House info & Wi-Fi',
      emoji: '🏠',
      category: 'Practical',
      locked: true,
      createdById: u.admin.id,
      content: `Everything you need when staying at Grandpa & Grandma's.

## Wi-Fi
- Network: **MillerHome**
- Password: \`apple-pie-1955\`

## Bins
- **Monday**: general waste
- **Thursday**: paper and cardboard (every other week)

## Good to know
- The spare key is with the neighbours at number 12.
- The heating is on a timer — ask Grandpa before changing it.

## Emergency
- Emergency services: [112](tel:112)
- Family doctor: [+32 3 123 45 67](tel:+3231234567)`,
    },
    {
      id: 'seed-wiki-tree',
      groupId: g.family.id,
      title: 'Family tree',
      emoji: '🌳',
      category: 'History',
      createdById: u.opa.id,
      content: `## Grandpa John & Grandma Rose
Married in 1978, in the village church where Grandma grew up.

### Their children
- **Mom** — married to **Dad**
  - **Sophie**
  - **Emma** (5)

---

Know more names or dates? Anyone can edit this page — please add them!`,
    },
    {
      id: 'seed-wiki-birthdays',
      groupId: g.family.id,
      title: 'Birthdays',
      emoji: '🎂',
      category: 'Practical',
      createdById: u.mama.id,
      content: `- **Emma** — just turned 5! 🎉
- **Grandma Rose** — next month (70!)
- **Sophie** — 14 March
- **Grandpa John** — 2 June
- **Mom** — 21 August
- **Dad** — 9 October`,
    },
    {
      id: 'seed-wiki-packing',
      groupId: g.weekend.id,
      title: 'Ardennes packing list',
      emoji: '🎒',
      category: 'Trips',
      createdById: u.papa.id,
      content: `Follow the trip in the [trip journal](/trips/seed-post-trip).

- [x] Hiking boots
- [x] Rain jackets
- [x] Board games for the evenings
- [ ] Marshmallows for the campfire
- [ ] Charger for the car`,
    },
  ]
  for (const page of wiki) {
    await prisma.wikiPage.upsert({
      where: { id: page.id },
      update: {},
      create: { ...page, locked: page.locked ?? false, updatedById: page.createdById },
    })
  }

  // ── Stories ───────────────────────────────────────────────────────────────
  // Live stories expire after 24 hours; refreshing them on every run keeps
  // the tray filled on a demo that restarts now and then.
  const liveStories = [
    { id: 'seed-story-beach', authorId: u.sophie.id, image: 'storyBeach' as const, age: 3 * HOUR },
    { id: 'seed-story-flowers', authorId: u.opa.id, image: 'storyFlowers' as const, age: 7 * HOUR },
  ]
  for (const story of liveStories) {
    const createdAt = ago(story.age)
    const expiresAt = new Date(createdAt.getTime() + DAY)
    await prisma.story.upsert({
      where: { id: story.id },
      update: { createdAt, expiresAt },
      create: {
        id: story.id,
        authorId: story.authorId,
        groupId: g.family.id,
        imageUrl: photoUrl(story.image),
        createdAt,
        expiresAt,
      },
    })
  }
  // A Highlight: an expired story its author pinned.
  await prisma.story.upsert({
    where: { id: 'seed-story-lake' },
    update: {},
    create: {
      id: 'seed-story-lake',
      authorId: u.papa.id,
      groupId: g.family.id,
      imageUrl: photoUrl('storyLake'),
      createdAt: ago(20 * DAY),
      expiresAt: ago(19 * DAY),
      pinnedAt: ago(20 * DAY),
    },
  })
  for (const [storyId, userId] of [
    ['seed-story-beach', u.oma.id],
    ['seed-story-beach', u.mama.id],
    ['seed-story-flowers', u.mama.id],
    ['seed-story-lake', u.oma.id],
    ['seed-story-lake', u.sophie.id],
  ]) {
    await prisma.storyView.upsert({
      where: { storyId_userId: { storyId, userId } },
      update: {},
      create: { storyId, userId },
    })
  }
  await prisma.storyReaction.upsert({
    where: { storyId_userId: { storyId: 'seed-story-beach', userId: u.mama.id } },
    update: {},
    create: { storyId: 'seed-story-beach', userId: u.mama.id, type: 'LOVE' },
  })

  // ── Notifications for the two demo accounts ─────────────────────────────
  const notifications: {
    id: string
    type: string
    message: string
    postId?: string
    storyId?: string
    at: Date
    read?: boolean
    forAdmin?: boolean
  }[] = [
    {
      id: 'album',
      type: 'new_post',
      message: 'Sophie posted in The Miller Family: "Our week at the coast — add your photos too!"',
      postId: 'seed-post-album',
      at: ago(2 * HOUR),
      forAdmin: true,
    },
    {
      id: 'mention',
      type: 'mention',
      message:
        'Mom mentioned you in a comment in The Miller Family: "Test User, you have to come with us next year! 🌊"',
      postId: 'seed-post-album',
      at: ago(80 * 60 * 1000),
    },
    {
      id: 'story',
      type: 'new_story',
      message: 'Sophie shared a story in The Miller Family',
      storyId: 'seed-story-beach',
      at: ago(3 * HOUR),
      forAdmin: true,
    },
    {
      id: 'like',
      type: 'new_like_post',
      message:
        'Grandma Rose reacted ❤️ to your post in The Miller Family: "Look at this view from my run this morning 🏃‍♀️"',
      postId: 'seed-post-run',
      at: ago(21 * HOUR),
    },
    {
      id: 'checkin',
      type: 'trip_checkin',
      message: 'Mom checked in at Bois de La Roche',
      postId: 'seed-post-trip',
      at: ago(10 * HOUR),
      forAdmin: true,
    },
    {
      id: 'gift-draw',
      type: 'gift_draw',
      message: 'Your Secret Santa name for "Christmas gift exchange" is ready.',
      postId: 'seed-post-giftlist',
      at: ago(3 * DAY),
      read: true,
    },
    {
      id: 'gift-invite',
      type: 'gift_list_invite',
      message: 'Mom added you to the gift list "Christmas gift exchange"',
      postId: 'seed-post-giftlist',
      at: ago(4 * DAY),
      read: true,
    },
    {
      id: 'memory',
      type: 'on_this_day',
      message: 'A memory from The Miller Family — Mom\'s post from 1 year ago: "First snow of the year! ❄️"',
      postId: 'seed-post-memory',
      at: ago(9 * HOUR),
      read: true,
      forAdmin: true,
    },
    {
      id: 'comment',
      type: 'new_comment',
      message: 'Grandma Rose commented on a post in The Miller Family: "Happy birthday, sweet Emma! 🎈"',
      postId: 'seed-post-1',
      at: ago(2 * DAY),
      read: true,
      forAdmin: true,
    },
  ]
  for (const n of notifications) {
    const recipients = n.forAdmin ? [u.testUser, u.admin] : [u.testUser]
    for (const user of recipients) {
      const id = `seed-notification-${n.id}-${user === u.admin ? 'admin' : 'test'}`
      await prisma.notification.upsert({
        where: { id },
        update: {},
        create: {
          id,
          userId: user.id,
          type: n.type,
          message: n.message,
          relatedPostId: n.postId,
          relatedStoryId: n.storyId,
          readAt: n.read ? n.at : null,
          createdAt: n.at,
        },
      })
    }
  }
}

async function bindPhoto(prisma: PrismaClient, name: keyof typeof PHOTO, uploaderId: string, groupIds: string[]) {
  await prisma.upload.upsert({
    where: { assetKey: PHOTO[name] },
    update: {},
    create: { assetKey: PHOTO[name], uploaderId, bound: true, groupIds, sourceFilename: `${name}.jpg` },
  })
}

async function seedAlbumPhotos(
  prisma: PrismaClient,
  id: string,
  postId: string,
  authorId: string,
  photoUrls: string[],
  createdAt: Date
) {
  await prisma.comment.upsert({
    where: { id },
    update: {},
    create: {
      id,
      postId,
      authorId,
      content: '',
      metadata: { kind: 'album_photo', contributionId: id, photoUrls },
      createdAt,
    },
  })
}

async function seedComment(
  prisma: PrismaClient,
  c: {
    id: string
    postId: string
    authorId: string
    content: string
    parentId?: string
    attachmentUrls?: string[]
    createdAt: Date
  }
) {
  await prisma.comment.upsert({
    where: { id: c.id },
    update: {},
    create: {
      id: c.id,
      postId: c.postId,
      authorId: c.authorId,
      content: c.content,
      parentId: c.parentId,
      attachmentUrls: c.attachmentUrls ?? [],
      attachmentUrl: c.attachmentUrls?.[0],
      createdAt: c.createdAt,
    },
  })
}
