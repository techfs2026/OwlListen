export function SidebarIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <line x1="5" y1="2" x2="5" y2="14" stroke="currentColor" strokeWidth="1.2" />
      {open ? (
        <path
          d="M8.5 6L6.5 8L8.5 10"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M7.5 6L9.5 8L7.5 10"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export function SkipIcon({ direction }: { direction: "prev" | "next" }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      {direction === "prev" ? (
        <>
          <rect x="3" y="4" width="2" height="12" rx="1" fill="currentColor" />
          <path d="M15 4L7 10L15 16V4Z" fill="currentColor" />
        </>
      ) : (
        <>
          <rect x="15" y="4" width="2" height="12" rx="1" fill="currentColor" />
          <path d="M5 4L13 10L5 16V4Z" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

export function PlayingBars({
  size = 12,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <rect x="1" y="2" width="3" height="8" rx="1" fill={color}>
        <animate attributeName="height" values="8;4;8" dur="1s" repeatCount="indefinite" />
        <animate attributeName="y" values="2;4;2" dur="1s" repeatCount="indefinite" />
      </rect>
      <rect x="8" y="2" width="3" height="8" rx="1" fill={color}>
        <animate attributeName="height" values="8;6;3;8" dur="1.3s" repeatCount="indefinite" />
        <animate attributeName="y" values="2;3;4.5;2" dur="1.3s" repeatCount="indefinite" />
      </rect>
    </svg>
  );
}

export function PlayingBarsLarge() {
  return (
    <svg width="28" height="16" viewBox="0 0 28 16" fill="white">
      {[0, 8, 16, 24].map((x, i) => (
        <rect key={x} x={x} y="4" width="4" height="8" rx="2">
          <animate
            attributeName="height"
            values="8;14;8"
            dur="0.9s"
            repeatCount="indefinite"
            begin={`${i * 0.15}s`}
          />
          <animate
            attributeName="y"
            values="4;1;4"
            dur="0.9s"
            repeatCount="indefinite"
            begin={`${i * 0.15}s`}
          />
        </rect>
      ))}
    </svg>
  );
}

export function CloseIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path
        d="M3 3L11 11M11 3L3 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Spinner({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeOpacity="0.15" strokeWidth="3" />
      <path
        d="M16 3 a 13 13 0 0 1 13 13"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 16 16"
          to="360 16 16"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}
