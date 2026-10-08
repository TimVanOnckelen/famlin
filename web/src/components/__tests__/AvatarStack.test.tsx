import { render, screen } from '@testing-library/react';
import { AvatarStack } from '@/components/AvatarStack';

const people = [
  { id: 'u1', name: 'Grandpa John' },
  { id: 'u2', name: 'Sophie' },
  { id: 'u3', name: 'Pavel' },
];

describe('AvatarStack', () => {
  it('renders one avatar per person, up to max', () => {
    render(<AvatarStack people={people} size={26} max={2} />);
    expect(screen.getByText('GJ')).toBeInTheDocument();
    expect(screen.getByText('SO')).toBeInTheDocument();
    expect(screen.queryByText('PA')).not.toBeInTheDocument();
  });

  it('renders img avatars for people with an avatarUrl', () => {
    render(
      <AvatarStack people={[{ id: 'u1', name: 'Sophie', avatarUrl: 'https://example.com/sophie.jpg' }]} />
    );
    expect(screen.getByAltText('Sophie')).toHaveAttribute('src', 'https://example.com/sophie.jpg');
  });

  it('renders initials-only avatars the same way', () => {
    const { container } = render(<AvatarStack people={people} />);
    expect(container).toHaveTextContent('GJ');
    expect(container).toHaveTextContent('SO');
  });

  it('renders nothing for an empty list', () => {
    const { container } = render(<AvatarStack people={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('carries the overlap as a CSS variable and merges extra classes', () => {
    const { container } = render(<AvatarStack people={people} overlap={12} className="chat-panel-avatars" />);
    const stack = container.firstChild as HTMLElement;
    expect(stack.style.getPropertyValue('--avatar-stack-overlap')).toBe('-12px');
    expect(stack.className).toBe('avatar-stack chat-panel-avatars');
  });
});
