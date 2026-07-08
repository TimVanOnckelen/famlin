import { getUploadUrl } from '@famlin/api-client';

// Initial-avatar palette from the styleguide's "Initial avatars" pattern —
// each member keeps one consistent color, derived from their name.
const AVATAR_COLORS = ['#006e94', '#ed835e', '#4b8b5a', '#005480'];

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? '');
  return (first + last).toUpperCase();
}

export function Avatar({
  name,
  avatarUrl,
  size = 44,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: size / 2,
    flexShrink: 0,
  };

  if (avatarUrl) {
    const src = avatarUrl.startsWith('/') ? getUploadUrl(avatarUrl) : avatarUrl;
    return <img src={src} alt={name} style={{ ...style, objectFit: 'cover' }} />;
  }

  return (
    <div
      style={{
        ...style,
        background: colorFor(name),
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.36,
        fontWeight: 800,
        userSelect: 'none',
      }}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}
