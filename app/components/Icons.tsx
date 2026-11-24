import type { SVGProps } from "react";

/** Inline icon set, 20px, stroke 1.5, currentColor (docs/ui-direction.md §6). */
type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size: number): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
});

export const Mic = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
);
export const MicOff = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 10V6a3 3 0 0 0-6 0M5 11a7 7 0 0 0 11.4 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M4 4l16 16" /></svg>
);
export const Waveform = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M8 9v6M12 5v14M16 9v6" /></svg>
);
export const ArrowUp = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 19V5M6 11l6-6 6 6" /></svg>
);
export const ArrowLeft = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
);
export const ArrowRight = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const ChevronDown = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M6 9l6 6 6-6" /></svg>
);
export const Check = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 12.5l4.5 4.5L19 7" /></svg>
);
export const Close = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const Loader = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} className={`spin ${p.className ?? ""}`} {...p}><path d="M12 3a9 9 0 1 0 9 9" /></svg>
);
export const Copy = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h10" /></svg>
);
export const Download = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 4v11M7 10l5 5 5-5M4 19h16" /></svg>
);
export const List = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 7h14M5 12h14M5 17h9" /></svg>
);
export const Skip = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 5l9 7-9 7zM18 5v14" /></svg>
);
export const Speaker = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></svg>
);
export const Stop = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
);
export const Keyboard = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" /></svg>
);
export const Sun = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const Moon = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
);
export const Shield = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z" /></svg>
);
export const Trash = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
);
export const Quote = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M7 7h4v5H8a3 3 0 0 0 3 3v2a5 5 0 0 1-5-5zM15 7h4v5h-3a3 3 0 0 0 3 3v2a5 5 0 0 1-5-5z" /></svg>
);
export const Link = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
);
export const MapIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 4v2M12 18v2M4 12h2M18 12h2" /></svg>
);
export const Clock = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>
);
export const Pencil = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z" /></svg>
);
export const Undo = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M9 14L4 9l5-5M4 9h9a6 6 0 0 1 0 12h-3" /></svg>
);
