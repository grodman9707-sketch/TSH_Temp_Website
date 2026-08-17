export function Crest({ className = "h-16 w-auto", title = true }) {
  return (
    <svg viewBox="0 0 180 180" className={className} aria-label="TSH Darts League">
      <defs>
        <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f6d36a" />
          <stop offset="50%" stopColor="#e0b13a" />
          <stop offset="100%" stopColor="#b8861e" />
        </linearGradient>
      </defs>
      <path
        d="M90 8 L154 32 L162 92 C162 132 128 160 90 172 C52 160 18 132 18 92 L26 32 Z"
        fill="#0b1018"
        stroke="url(#gold)"
        strokeWidth="4"
      />
      <circle cx="90" cy="58" r="26" fill="#1a1208" stroke="url(#gold)" strokeWidth="2" />
      <circle cx="90" cy="58" r="18" fill="#0e0a06" />
      <circle cx="90" cy="58" r="6" fill="#c81e1e" />
      <circle cx="90" cy="58" r="2" fill="#f6d36a" />
      {title ? (
        <>
          <text x="90" y="112" textAnchor="middle" fill="url(#gold)" fontFamily="Inter, sans-serif" fontWeight="800" fontSize="28">
            TSH
          </text>
          <text x="90" y="132" textAnchor="middle" fill="#f6d36a" fontFamily="Inter, sans-serif" fontWeight="600" fontSize="7" letterSpacing="1.6">
            DARTS LEAGUE
          </text>
        </>
      ) : null}
    </svg>
  );
}
