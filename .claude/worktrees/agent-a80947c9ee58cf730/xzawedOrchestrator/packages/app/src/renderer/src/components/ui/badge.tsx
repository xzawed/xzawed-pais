import React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.js'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide transition-colors',
  {
    variants: {
      variant: {
        ok:      'bg-ok-bg text-ok border border-ok/30',
        active:  'bg-accent-bg text-accent border border-accent/40',
        warn:    'bg-warn/10 text-warn border border-warn/30',
        danger:  'bg-danger/10 text-danger border border-danger/30',
        muted:   'bg-surface text-fg-ghost border border-border',
      },
    },
    defaultVariants: { variant: 'muted' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
