import { getAllOnThisDayPosts } from '../services/onThisDay.js';
import { notifyGroup, excerptText } from '../services/notifications.js';

// No real user has this id, so notifyGroup's sender-exclusion filter never
// excludes anyone — this is a system-generated notification, not one "from"
// a group member (and it's never persisted, notify() only stores userId/type).
const SYSTEM_SENDER_ID = '__system__';

// Runs once a day (see registerCronJobs in server.ts): finds every post
// created on today's month/day in a past year and notifies each post's group.
export async function runOnThisDayJob(referenceDate = new Date()) {
  const posts = await getAllOnThisDayPosts(referenceDate);
  const year = referenceDate.getFullYear();

  for (const post of posts) {
    const yearsAgo = year - post.createdAt.getFullYear();
    await notifyGroup({
      type: 'on_this_day',
      groupId: post.groupId,
      senderId: SYSTEM_SENDER_ID,
      postId: post.id,
      params: { author: post.authorName, group: post.groupName, count: yearsAgo, excerpt: excerptText(post.content) },
    }).catch((err) => console.error('Failed to send on-this-day notification', err));
  }
}
