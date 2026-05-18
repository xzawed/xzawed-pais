import React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.js'

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default:  'bg-accent text-white hover:bg-accent-hover active:scale-[0.98]',
        ghost:    'text-fg-muted hover:bg-surface-raised hover:text-fg',
        outline:  'border border-border text-fg-muted hover:bg-surface-raised',
        danger:   'bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20',
      },
      size: {
        sm:   'h-6 px-2 text-[10px]',
        md:   'h-7 px-3',
        lg:   'h-8 px-4 text-sm',
        icon: 'h-7 w-7',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  }
)
Button.displayName = 'Button'
