import { Avatar, AvatarImage, AvatarFallback } from '../avatar'
import { cn } from '../lib/utils'
import { avatarColor, initials } from '../lib/avatar'

export function UserAvatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  return (
    <Avatar className={cn('size-10', className)}>
      {src && (
        <AvatarImage
          keepMounted
          src={src}
          alt=""
          className="absolute inset-0 data-loading:invisible data-error:hidden"
        />
      )}
      <AvatarFallback
        aria-hidden="true"
        className="rounded-full text-xs font-extrabold text-white"
        style={{ backgroundColor: avatarColor(name) }}
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  )
}
