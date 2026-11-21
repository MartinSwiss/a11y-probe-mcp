/**
 * WCAG 2.2 contrast for caller-supplied colors. No network and no page content.
 * Ratios use the relative-luminance formula in WCAG 2.2.
 */

const MAX_PAIRS = 50;

export interface ContrastPairInput {
  foreground: string;
  background: string;
  fontSizePx?: number;
  bold?: boolean;
}

export interface ContrastPairResult {
  foreground: string;
  background: string;
  ratio: number;
  aa: { normal: boolean; large: boolean };
  aaa: { normal: boolean; large: boolean };
  nonText: boolean;
  /** Null when the foreground already meets AA for the text size in use. */
  suggestion: string | null;
}

export interface ContrastRequest {
  pairs: ContrastPairInput[];
  fontSizePx?: number;
  bold?: boolean;
}

export interface ContrastOutcome {
  ok: true;
  result: { pairs: ContrastPairResult[] };
}

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  olive: "#808000",
  lime: "#00ff00",
  aqua: "#00ffff",
  teal: "#008080",
  navy: "#000080",
  fuchsia: "#ff00ff",
  rebeccapurple: "#663399",
  transparent: "#00000000",
};

export function checkContrast(input: ContrastRequest): ContrastOutcome | { ok: false; message: string } {
  if (!Array.isArray(input.pairs) || input.pairs.length < 1 || input.pairs.length > MAX_PAIRS) {
    return { ok: false, message: `pairs must contain 1 to ${MAX_PAIRS} colors` };
  }
  const pairs: ContrastPairResult[] = [];
  for (const pair of input.pairs) {
    const foreground = parseColor(pair.foreground);
    const background = parseColor(pair.background);
    if (!foreground || !background) return { ok: false, message: "A color could not be parsed" };
    const bg = composite(background, { r: 1, g: 1, b: 1, a: 1 });
    const fg = composite(foreground, bg);
    const ratio = contrastRatio(fg, bg);
    const fontSize = pair.fontSizePx ?? input.fontSizePx;
    const bold = pair.bold ?? input.bold ?? false;
    const large = isLargeText(fontSize, bold);
    const target = large ? 3 : 4.5;
    pairs.push({
      foreground: toHex(fg),
      background: toHex(bg),
      ratio: round2(ratio),
      aa: { normal: ratio >= 4.5, large: ratio >= 3 },
      aaa: { normal: ratio >= 7, large: ratio >= 4.5 },
      nonText: ratio >= 3,
      suggestion: ratio >= target ? null : suggestForeground(fg, bg, target),
    });
  }
  return { ok: true, result: { pairs } };
}

export function parseColor(input: string): Rgb | null {
  const value = input.trim().toLowerCase();
  const named = NAMED[value];
  if (named) return parseColor(named);
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
  if (hex?.[1]) return hexToRgb(hex[1]);
  const rgb = /^rgba?\(\s*([0-9.]+%?)\s*[, ]\s*([0-9.]+%?)\s*[, ]\s*([0-9.]+%?)(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/.exec(value);
  if (rgb?.[1] && rgb[2] && rgb[3]) {
    const r = channel(rgb[1]);
    const g = channel(rgb[2]);
    const b = channel(rgb[3]);
    const a = rgb[4] ? alpha(rgb[4]) : 1;
    if (r === null || g === null || b === null || a === null) return null;
    return { r, g, b, a };
  }
  const hsl = /^hsla?\(\s*([0-9.]+)(?:deg)?\s*[, ]\s*([0-9.]+)%\s*[, ]\s*([0-9.]+)%(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/.exec(value);
  if (hsl?.[1] && hsl[2] && hsl[3]) {
    const a = hsl[4] ? alpha(hsl[4]) : 1;
    if (a === null) return null;
    const [r, g, b] = hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100);
    return { r, g, b, a };
  }
  return null;
}

function hexToRgb(hex: string): Rgb | null {
  const full = hex.length <= 4 ? [...hex].map((char) => char + char).join("") : hex;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  const a = full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1;
  if ([r, g, b].some((part) => Number.isNaN(part))) return null;
  return { r: r / 255, g: g / 255, b: b / 255, a };
}

function channel(value: string): number | null {
  if (value.endsWith("%")) {
    const parsed = Number(value.slice(0, -1));
    if (!Number.isFinite(parsed)) return null;
    return clamp01(parsed / 100);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clamp01(parsed / 255);
}

function alpha(value: string): number | null {
  if (value.endsWith("%")) {
    const parsed = Number(value.slice(0, -1));
    return Number.isFinite(parsed) ? clamp01(parsed / 100) : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp01(parsed) : null;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [f(0), f(8), f(4)];
}

function rgbToHsl(rgb: Rgb): { h: number; s: number; l: number } {
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === rgb.r) h = ((rgb.g - rgb.b) / d) % 6;
  else if (max === rgb.g) h = (rgb.b - rgb.r) / d + 2;
  else h = (rgb.r - rgb.g) / d + 4;
  return { h: h * 60, s, l };
}

function composite(fg: Rgb, bg: Rgb): Rgb {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
    a,
  };
}

function luminance(rgb: Rgb): number {
  const lin = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

export function contrastRatio(fg: Rgb, bg: Rgb): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function suggestForeground(fg: Rgb, bg: Rgb, target: number): string | null {
  const { h, s } = rgbToHsl(fg);
  let best: { delta: number; rgb: Rgb } | null = null;
  for (let step = 0; step <= 1000; step++) {
    const l = step / 1000;
    const [r, g, b] = hslToRgb(h, s, l);
    const candidate = { r, g, b, a: 1 };
    const rounded = parseColor(toHex(candidate));
    if (!rounded || contrastRatio(rounded, bg) < target) continue;
    const delta = Math.abs(l - rgbToHsl(fg).l);
    if (!best || delta < best.delta) best = { delta, rgb: candidate };
  }
  return best ? toHex(best.rgb) : null;
}

function isLargeText(fontSizePx: number | undefined, bold: boolean): boolean {
  if (fontSizePx === undefined) return false;
  return fontSizePx >= 24 || (bold && fontSizePx >= 18.67);
}

function toHex(rgb: Rgb): string {
  const part = (value: number) => Math.round(clamp01(value) * 255).toString(16).padStart(2, "0");
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
