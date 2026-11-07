import { screen } from '@testing-library/react'
import { WikiContent } from '../WikiContent'
import { renderWithQueryClient } from '@/test/fixtures'
import { getUploadUrl } from '@famlin/api-client'

vi.mock('@famlin/api-client', async (original) => ({
  ...(await original<typeof import('@famlin/api-client')>()),
  getUploadUrl: vi.fn((path: string) => `https://server.test${path}?token=t`),
}))

const UPLOAD = '/uploads/123e4567-e89b-12d3-a456-426614174000.jpg'

it('renders headings, lists and checklists', () => {
  const { container } = renderWithQueryClient(
    <WikiContent content={'# Big\n\n## Medium\n\n- one\n- two\n\n1. first\n2. second\n\n- [ ] todo\n- [x] done'} />
  )
  // The page title is the <h1>, so content headings start at <h2>.
  expect(screen.getByRole('heading', { level: 2, name: 'Big' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 3, name: 'Medium' })).toBeInTheDocument()
  expect(screen.getAllByRole('list')).toHaveLength(3)
  expect(screen.getByText('first').closest('ol')).toBeInTheDocument()
  const boxes = container.querySelectorAll<HTMLInputElement>('.wiki-checklist input[type="checkbox"]')
  expect(boxes).toHaveLength(2)
  expect(boxes[0].checked).toBe(false)
  expect(boxes[1].checked).toBe(true)
})

it('renders an internal link as an in-app link and an external one in a new tab', () => {
  renderWithQueryClient(<WikiContent content={'[our trip](/posts/x) and [site](https://example.com)'} />)
  const internal = screen.getByRole('link', { name: 'our trip' })
  expect(internal).toHaveAttribute('href', '/posts/x')
  expect(internal).not.toHaveAttribute('target')
  const external = screen.getByRole('link', { name: 'site' })
  expect(external).toHaveAttribute('href', 'https://example.com')
  expect(external).toHaveAttribute('target', '_blank')
  expect(external).toHaveAttribute('rel', expect.stringContaining('noopener'))
})

it('renders a javascript: link as plain text', () => {
  renderWithQueryClient(<WikiContent content={'[click](javascript:alert(1))'} />)
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  expect(screen.getByText(/click/)).toBeInTheDocument()
})

it('renders an uploaded image through getUploadUrl', () => {
  renderWithQueryClient(<WikiContent content={`![Lasagna](${UPLOAD})`} />)
  expect(getUploadUrl).toHaveBeenCalledWith(UPLOAD)
  expect(screen.getByAltText('Lasagna')).toHaveAttribute('src', `https://server.test${UPLOAD}?token=t`)
})

it('does not render an external image', () => {
  const { container } = renderWithQueryClient(<WikiContent content={'![x](https://evil.test/a.png)'} />)
  expect(container.querySelector('img')).toBeNull()
})

it('never injects raw HTML', () => {
  const { container } = renderWithQueryClient(<WikiContent content={'<img src=x onerror=alert(1)>'} />)
  expect(container.querySelector('img')).toBeNull()
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
})
