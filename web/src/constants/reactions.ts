import { ReactionType } from '@famlin/api-client';

// UI-only emoji map — mirrors mobile/src/constants/reactions.ts.
export const REACTION_EMOJI: Record<ReactionType, string> = {
  LIKE: '👍',
  LOVE: '❤️',
  HAHA: '😂',
  WOW: '😮',
  SAD: '😢',
  CARE: '🥰',
};
