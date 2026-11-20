/**
 * True Nature brand moments. Imagery is used as a moment at the top of a screen, never as wallpaper,
 * and never carries words. Files live in public/brand (see brand/true-nature in the repo for the full set).
 */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export type PlateName = "roots" | "lake" | "embers" | "grain" | "spark" | "ripples" | "island" | "water";
export const plateSrc = (name: PlateName) => `${BASE}/brand/${name}.webp`;

/** A photo band that dissolves into the page ground. Decorative: hidden from screen readers. */
export function Plate({ name, size = "sm", rounded = false, position = "50% 50%", className = "" }: { name: PlateName; size?: "sm" | "md"; rounded?: boolean; position?: string; className?: string }) {
  return (
    <div className={`plate-band plate-${size} ${rounded ? "rounded" : ""} ${className}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={plateSrc(name)} alt="" decoding="async" style={{ objectPosition: position }} />
    </div>
  );
}

/** The Sacred Delta mark: the water triangle with the river held inside it, standing on the gold thread. */
export function DeltaMark({ size = 28, thread = false, className = "" }: { size?: number; thread?: boolean; className?: string }) {
  return (
    <span className={`delta-mark ${className}`} aria-hidden="true">
      {thread && <span className="thread" />}
      <svg viewBox="0 0 140 84" height={size} fill="none" style={{ width: "auto", overflow: "visible" }}>
        <defs><clipPath id="tn-delta"><path d="M6 8 H134 L70 80 Z" /></clipPath></defs>
        <g clipPath="url(#tn-delta)" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
          {[24, 38, 52, 66].map((y) => <path key={y} d={`M0 ${y} q8.75 -9 17.5 0 t17.5 0 t17.5 0 t17.5 0 t17.5 0 t17.5 0 t17.5 0 t17.5 0 t17.5 0`} />)}
        </g>
        <path d="M6 8 H134 L70 80 Z" stroke="currentColor" strokeWidth="3.4" strokeLinejoin="miter" />
      </svg>
    </span>
  );
}
