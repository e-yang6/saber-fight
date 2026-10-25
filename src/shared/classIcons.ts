import type { ClassName } from './protocol.js';

/** Inner SVG markup for each class icon, drawn in a 48×48 viewBox */
export const CLASS_ICON_PATHS: Record<ClassName, string> = {
  guardian: `
    <path d="M24 4 L42 10 V24 C42 34 33 42 24 45 C15 42 6 34 6 24 V10 Z" fill="#3b82f6" stroke="#2d1e0f" stroke-width="3" stroke-linejoin="round"/>
    <path d="M24 10 L36 14 V24 C36 31 30 37 24 39 C18 37 12 31 12 24 V14 Z" fill="#60a5fa" stroke="#2d1e0f" stroke-width="2" stroke-linejoin="round"/>
    <path d="M24 16 L26.5 21.5 L32 22.5 L28 26.5 L29 32 L24 29 L19 32 L20 26.5 L16 22.5 L21.5 21.5 Z" fill="#ffffff" stroke="#2d1e0f" stroke-width="1.5" stroke-linejoin="round"/>`,
  striker: `
    <path d="M10 38 L34 10 L38 14 L14 42 Z" fill="#ef4444" stroke="#2d1e0f" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M34 10 L40 6 L42 8 L38 14 Z" fill="#fef08a" stroke="#2d1e0f" stroke-width="2"/>
    <path d="M7 35 L13 41 L10 44 L4 38 Z" fill="#b91c1c" stroke="#2d1e0f" stroke-width="2"/>
    <path d="M38 38 L14 10 L10 14 L34 42 Z" fill="#f97316" stroke="#2d1e0f" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M14 10 L8 6 L6 8 L10 14 Z" fill="#fef08a" stroke="#2d1e0f" stroke-width="2"/>
    <path d="M41 35 L35 41 L38 44 L44 38 Z" fill="#c2410c" stroke="#2d1e0f" stroke-width="2"/>
    <circle cx="24" cy="24" r="3.5" fill="#ffffff" stroke="#2d1e0f" stroke-width="2"/>`,
  mystic: `
    <circle cx="24" cy="24" r="13" fill="#a855f7" stroke="#2d1e0f" stroke-width="3"/>
    <circle cx="21" cy="21" r="9" fill="#c084fc"/>
    <circle cx="18" cy="18" r="3" fill="#ffffff"/>
    <ellipse cx="24" cy="24" rx="19" ry="6.5" transform="rotate(-25 24 24)" stroke="#2d1e0f" stroke-width="3" fill="none"/>
    <ellipse cx="24" cy="24" rx="19" ry="6.5" transform="rotate(-25 24 24)" stroke="#fef08a" stroke-width="1.8" fill="none"/>
    <path d="M37 10 L38.5 13.5 L42 15 L38.5 16.5 L37 20 L35.5 16.5 L32 15 L35.5 13.5 Z" fill="#ffffff" stroke="#2d1e0f" stroke-width="1.5"/>`,
  phantom: `
    <path d="M8 20 L16 20 M6 26 L18 26 M10 32 L20 32" stroke="#047857" stroke-width="3" stroke-linecap="round"/>
    <path d="M28 4 L14 26 H26 L20 44 L40 18 H26 Z" fill="#10b981" stroke="#2d1e0f" stroke-width="3" stroke-linejoin="round"/>
    <path d="M26 10 L19 24 H28 L23 37 L34 20 H25 Z" fill="#a7f3d0"/>`,
};

export function classIconSvg(name: ClassName, className: string): string {
  return `<svg viewBox="0 0 48 48" class="${className}" fill="none" aria-hidden="true">${CLASS_ICON_PATHS[name]}</svg>`;
}
