import { Avatar } from '@/components/Avatar';
import './AvatarStack.css';

export type AvatarStackPerson = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

export function AvatarStack({
  people,
  size = 26,
  max = 5,
  overlap = 8,
  className,
}: {
  people: AvatarStackPerson[];
  size?: number;
  max?: number;
  /** How many px each avatar overlaps the previous one. */
  overlap?: number;
  className?: string;
}) {
  if (people.length === 0) return null;
  return (
    <span
      className={className ? `avatar-stack ${className}` : 'avatar-stack'}
      style={{ '--avatar-stack-overlap': `-${overlap}px` } as React.CSSProperties}
    >
      {people.slice(0, max).map((person) => (
        <Avatar key={person.id} name={person.name} avatarUrl={person.avatarUrl} size={size} ring />
      ))}
    </span>
  );
}
