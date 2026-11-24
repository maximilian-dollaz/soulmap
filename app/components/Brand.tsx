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

/**
 * The Sacred Delta mark, v2: the water triangle with two waves running through it. Two flows meet inside one shape.
 * Always gold and centred. Full mark (two waves, hairline) at 56px or taller; compact (one wave) from 24 to 55px.
 * `thread` draws the gold thread above it, for openers and finales. `draw` lets it draw itself on, once per page.
 */
export function DeltaMark({ size = 56, thread = false, draw = false, className = "" }: { size?: number; thread?: boolean; draw?: boolean; className?: string }) {
  const full = size >= 56;
  const waves = full ? [34, 52] : [38];
  const dip = full ? 6 : 7;
  const cls = draw ? "mark-draw" : undefined;
  return (
    <span className={`delta-mark ${className}`} aria-hidden="true">
      {thread && <span className="thread" />}
      <svg viewBox="0 0 140 84" height={size} fill="none" style={{ width: "auto", overflow: "visible" }}>
        <defs><clipPath id="tn-delta"><path d="M6 8 H134 L70 80 Z" /></clipPath></defs>
        <g clipPath="url(#tn-delta)" stroke="currentColor" strokeWidth={full ? 1.7 : 2.6} strokeLinecap="round">
          {waves.map((y, i) => <path key={y} className={cls ? `${cls} mark-wave` : undefined} pathLength={1} style={{ ["--w" as string]: i }} d={`M0 ${y} q8.75 -${dip} 17.5 0 t17.5 0 t17.5 0 t17.5 0 t17.5 0 t17.5 0 t17.5 0 t17.5 0 t17.5 0`} />)}
        </g>
        <path className={cls} pathLength={1} d="M6 8 H134 L70 80 Z" stroke="currentColor" strokeWidth={full ? 2.2 : 3.2} strokeLinejoin="miter" />
      </svg>
    </span>
  );
}
