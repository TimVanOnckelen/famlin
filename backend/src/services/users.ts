import bcrypt from 'bcryptjs';

// Bcrypt cost factor for every password hash the app creates (login setup,
// registration, invite acceptance, password reset/change) — one constant so
// tuning it is a one-line change instead of a grep-and-replace.
const SALT_ROUNDS = 12;

// Shared password hashing helper — every place the app turns a plaintext
// password into a stored hash routes through this rather than calling
// bcrypt.hash directly, so the cost factor stays consistent everywhere.
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

// Fields safe to hand back to the user themselves — never includes
// passwordHash or tokenVersion. Shared by every route that returns "the
// current user" after login/register/invite acceptance.
export function sanitizeUser(user: any) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    isAdmin: user.isAdmin,
    // Lets clients (web/mobile profile screens) show or hide the
    // change-password UI: SSO-only accounts have no local password to change.
    hasPassword: !!user.passwordHash,
    emailOnNewPost: user.emailOnNewPost,
    emailOnNewComment: user.emailOnNewComment,
    emailOnNewLike: user.emailOnNewLike,
    pushOnNewPost: user.pushOnNewPost,
    pushOnNewComment: user.pushOnNewComment,
    pushOnNewLike: user.pushOnNewLike,
    pushOnChitchat: user.pushOnChitchat,
  };
}
