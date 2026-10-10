import { render, screen } from '@testing-library/react';
import { Badge } from '@/components/Badge';

describe('Badge', () => {
  it('renders its content with the default solid primary pill', () => {
    render(<Badge>SHARED ALBUM</Badge>);
    const badge = screen.getByText('SHARED ALBUM');
    expect(badge.className).toBe('badge badge-primary');
  });

  it('applies the chosen color and outline variant', () => {
    render(<Badge color="info" variant="outline">TRIP · CLOSED</Badge>);
    expect(screen.getByText('TRIP · CLOSED').className).toBe('badge badge-info badge-outline');
  });

  it('keeps the warning hue and merges external positioning classes', () => {
    render(<Badge color="warning" className="milestone-badge-overlay">MILESTONE</Badge>);
    expect(screen.getByText('MILESTONE').className).toBe(
      'badge badge-warning milestone-badge-overlay'
    );
  });
});
