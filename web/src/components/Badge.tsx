import type { ReactNode } from 'react';
import './Badge.css';

export type BadgeColor = 'primary' | 'info' | 'warning';
export type BadgeVariant = 'solid' | 'outline';

export function Badge({
  color = 'primary',
  variant = 'solid',
  className,
  children,
}: {
  color?: BadgeColor;
  variant?: BadgeVariant;
  className?: string;
  children?: ReactNode;
}) {
  const classes = ['badge', `badge-${color}`];
  if (variant === 'outline') classes.push('badge-outline');
  if (className) classes.push(className);
  return <span className={classes.join(' ')}>{children}</span>;
}
