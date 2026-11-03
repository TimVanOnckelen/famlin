import { render, screen } from '@testing-library/react'
import { ConnectAppQr } from '@/components/ConnectAppQr'

describe('ConnectAppQr', () => {
  it('renders a QR image and the /connect URL of this origin', async () => {
    render(<ConnectAppQr />)
    expect(screen.getByText(`${window.location.origin}/connect`)).toBeInTheDocument()
    const img = await screen.findByRole('img')
    expect(img.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
  })

  it('shows store links only when known', () => {
    const { rerender } = render(<ConnectAppQr url="https://famlin.example.com/connect" />)
    expect(screen.queryByRole('link')).toBeNull()
    rerender(<ConnectAppQr url="https://famlin.example.com/connect" appStoreUrl="https://apps.example/app" />)
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://apps.example/app')
  })
})
