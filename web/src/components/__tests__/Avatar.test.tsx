import { render, screen } from '@testing-library/react';
import { Avatar } from '@/components/Avatar';

describe('Avatar', () => {
  it('renders two-letter initials when there is no avatar image', () => {
    const { container } = render(<Avatar name="Grandpa John" />);
    expect(container).toHaveTextContent('GJ');
  });

  it('derives a second initial from a single name', () => {
    const { container } = render(<Avatar name="Sophie" />);
    expect(container).toHaveTextContent('SO');
  });

  it('keeps the same color for the same name', () => {
    const first = render(<Avatar name="Sophie" />).container.firstChild as HTMLElement;
    const second = render(<Avatar name="Sophie" />).container.firstChild as HTMLElement;
    expect(first.style.background).toBe(second.style.background);
    expect(first.style.background).not.toBe('');
  });

  it('renders an img when an avatarUrl is set', () => {
    render(<Avatar name="Sophie" avatarUrl="https://example.com/sophie.jpg" />);
    expect(screen.getByAltText('Sophie')).toHaveAttribute('src', 'https://example.com/sophie.jpg');
  });
});
