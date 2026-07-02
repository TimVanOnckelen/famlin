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
    emailOnNewPost: user.emailOnNewPost,
    emailOnNewComment: user.emailOnNewComment,
    emailOnNewLike: user.emailOnNewLike,
    pushOnNewPost: user.pushOnNewPost,
    pushOnNewComment: user.pushOnNewComment,
    pushOnNewLike: user.pushOnNewLike,
  };
}
