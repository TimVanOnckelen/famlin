import * as React from 'react'
import { cn } from './lib/utils'

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="relative w-full min-w-0 overflow-x-auto max-md:overflow-visible">
      <table data-slot="table" className={cn('w-full caption-bottom text-sm max-md:block', className)} {...props} />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b max-md:sr-only', className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      // The last desktop row loses its border-b; in card mode (≤720px) it is a
      // standalone card and keeps its full border.
      className={cn(
        '[&_tr:last-child]:border-0 max-md:grid max-md:w-full max-md:gap-4 max-md:[&_tr:last-child]:border',
        className
      )}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted',
        // ≤720px (the breakpoint.mobile cut-over): each row is a stacked card.
        'max-md:block max-md:min-w-0 max-md:overflow-hidden max-md:rounded-xl max-md:border max-md:border-border max-md:bg-card max-md:text-card-foreground max-md:shadow-sm max-md:hover:bg-card',
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-10 px-2 text-left align-middle text-xs font-extrabold uppercase tracking-wide whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0',
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, children, ...props }: React.ComponentProps<'td'> & { 'data-label'?: string }) {
  const labeled = Boolean(props['data-label'])
  const actions = !labeled && !props.colSpan
  return (
    <td
      data-slot="table-cell"
      data-card-actions={actions || undefined}
      className={cn(
        'px-3 py-3 align-middle [&:has([role=checkbox])]:pr-0',
        'max-md:min-w-0 max-md:max-w-none max-md:whitespace-normal max-md:px-4 max-md:py-3',
        labeled
          ? 'max-md:grid max-md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] max-md:items-start max-md:gap-4 max-md:first:grid-cols-1 max-md:first:gap-1 max-md:first:bg-muted/20 max-md:border-b max-md:border-border/60 max-md:last:border-b-0 max-md:before:content-[attr(data-label)] max-md:before:text-xs max-md:before:font-semibold max-md:before:leading-6 max-md:before:text-muted-foreground max-md:before:[overflow-wrap:anywhere]'
          : actions
            ? 'max-md:block max-md:bg-muted/40'
            : 'max-md:block',
        className
      )}
      {...props}
    >
      <div
        data-slot="table-cell-value"
        className={cn(
          'contents',
          actions
            ? 'max-md:flex max-md:flex-wrap max-md:items-center max-md:justify-end max-md:gap-2 max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11'
            : 'max-md:block max-md:min-w-0 max-md:whitespace-normal max-md:[overflow-wrap:anywhere] max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11'
        )}
      >
        {children}
      </div>
    </td>
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption data-slot="table-caption" className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
  )
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
