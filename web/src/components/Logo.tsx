// House mark from design/Famlin Styleguide.dc.html — a rounded house
// silhouette with an arched door and round window in negative space,
// on the 150° teal icon gradient. App-icon radius = 22% of size.
export function AppIcon({ size = 76 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: 'var(--fam-grad)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: '0 8px 24px rgba(0, 110, 148, 0.34)',
      }}
    >
      <svg width={size * 0.53} height={size * 0.53} viewBox="0 0 48 48" fill="none">
        <path
          d="M24 6 Q25.6 6 26.9 6.95 L40.4 17.4 Q42 18.65 42 20.7 L42 38 Q42 42 38 42 L10 42 Q6 42 6 38 L6 20.7 Q6 18.65 7.6 17.4 L21.1 6.95 Q22.4 6 24 6 Z"
          fill="white"
        />
        <circle cx="24" cy="20.5" r="2.6" fill="#006e94" />
        <path d="M18.5 42 L18.5 31 Q18.5 26 24 26 Q29.5 26 29.5 31 L29.5 42 Z" fill="#006e94" />
      </svg>
    </div>
  );
}
