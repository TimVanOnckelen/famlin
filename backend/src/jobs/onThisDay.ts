import { getAllOnThisDayPosts } from '../services/onThisDay.js';
import { notifyGroup, excerptText, SYSTEM_SENDER_ID } from '../services/notifications.js';

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
