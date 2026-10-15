export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  const full = Math.round(value * 2) / 2;
  return (
    <span className="inline-flex text-clay" aria-label={`${value.toFixed(1)} out of 5`} role="img">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
          <defs>
            <linearGradient id={`h${i}`}>
              <stop offset={full >= i ? "100%" : full >= i - 0.5 ? "50%" : "0%"} stopColor="currentColor" />
              <stop offset={full >= i ? "100%" : full >= i - 0.5 ? "50%" : "0%"} stopColor="transparent" />
            </linearGradient>
          </defs>
          <path d="M10 1.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L1.4 7.8l6-.8z" fill={`url(#h${i})`} stroke="currentColor" strokeWidth="1" />
        </svg>
      ))}
    </span>
  );
}
