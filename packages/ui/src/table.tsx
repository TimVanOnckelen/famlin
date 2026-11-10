import * as React from 'react'
import { cn } from './lib/utils'

/**
 * `stacked` renders each row as a card of label/value pairs on compact
 * (≤720px) screens instead of a horizontally scrolling table: give every
 * TableCell a `label` (usually the column header text), leave it off the one
 * cell that identifies the row (it becomes the card title), and put row
 * buttons in a TableActionsCell. Styles live in styles.css.
 */
function Table({ className, stacked = false, ...props }: React.ComponentProps<'table'> & { stacked?: boolean }) {
  return (
    <div
      data-slot="table-container"
      data-stacked={stacked ? '' : undefined}
      className="relative w-full overflow-x-auto"
    >
      <table data-slot="table" className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />
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

function TableCell({ className, label, children, ...props }: React.ComponentProps<'td'> & { label?: string }) {
  return (
    <td
      data-slot="table-cell"
      data-label={label}
      className={cn('px-3 py-3 align-middle [&:has([role=checkbox])]:pr-0', className)}
      {...props}
    >
      {/* display: contents except in a stacked card, where it is the value column. */}
      {label === undefined ? children : <div data-slot="table-cell-value">{children}</div>}
    </td>
  )
}

/** The row's buttons; grouped at the bottom of the card in a stacked table. */
function TableActionsCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td data-slot="table-cell" data-actions="" className={cn('px-3 py-3 align-middle', className)} {...props} />
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption data-slot="table-caption" className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
  )
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableActionsCell, TableCaption }
