import { describe, expect, it } from 'vitest';
import { EDGE_ENCODINGS, type EdgeEncoding, type EdgeRole } from '../src/ui/encoding';

/**
 * Color-vision-deficiency check (§10, Milestone 5). Colors are simulated with the Machado et al.
 * (2009) severity-1.0 matrices in linear RGB and compared with CIE76 ΔE in CIELAB.
 */
const SIMULATIONS: Record<string, number[][]> = {
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const CANVAS_BACKGROUND = '#FBFBFC';

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

function simulate(hex: string, matrix: number[][]): number[] {
  const rgb = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16)));
  return matrix.map((row) => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2])));
}

function lab([r, g, b]: number[]): number[] {
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function deltaE(a: string, b: string, matrix: number[][]): number {
  const la = lab(simulate(a, matrix));
  const lb = lab(simulate(b, matrix));
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/** Non-color channels on which two encodings differ. */
function redundantChannels(a: EdgeEncoding, b: EdgeEncoding): string[] {
  const out: string[] = [];
  if (a.lineStyle !== b.lineStyle) out.push('line style');
  if (a.width !== b.width) out.push('width');
  if (a.marker !== b.marker) out.push('marker');
  if (a.text !== b.text) out.push('text label');
  if (a.outline !== b.outline) out.push('outline');
  return out;
}

// Roles drawn as an edge's own stroke (the current-configuration outline is an overlay).
const STROKE_ROLES: EdgeRole[] = ['host', 'source', 'target', 'both', 'added', 'removed'];

describe('visual encoding (color-blind safety)', () => {
  it('uses only Okabe-Ito colors (plus neutral gray and black)', () => {
    const allowed = ['#999999', '#000000', '#0072B2', '#D55E00', '#CC79A7', '#009E73', '#E69F00', '#56B4E9', '#F0E442'];
    for (const e of Object.values(EDGE_ENCODINGS)) expect(allowed).toContain(e.color.toUpperCase());
  });

  it('every pair of roles differs in at least one non-color channel', () => {
    const roles = Object.keys(EDGE_ENCODINGS) as EdgeRole[];
    for (let i = 0; i < roles.length; i++) {
      for (let j = i + 1; j < roles.length; j++) {
        const channels = redundantChannels(EDGE_ENCODINGS[roles[i]], EDGE_ENCODINGS[roles[j]]);
        expect(channels.length, `${roles[i]} vs ${roles[j]}`).toBeGreaterThan(0);
      }
    }
  });

  it('pairs that are hard to tell apart under any simulated deficiency differ in two or more non-color channels', () => {
    const report: string[] = [];
    for (const [name, matrix] of Object.entries(SIMULATIONS)) {
      for (let i = 0; i < STROKE_ROLES.length; i++) {
        for (let j = i + 1; j < STROKE_ROLES.length; j++) {
          const a = EDGE_ENCODINGS[STROKE_ROLES[i]];
          const b = EDGE_ENCODINGS[STROKE_ROLES[j]];
          const d = deltaE(a.color, b.color, matrix);
          if (d < 20) {
            const channels = redundantChannels(a, b);
            report.push(`${name}: ${a.role}/${b.role} ΔE=${d.toFixed(1)} → ${channels.join(', ')}`);
            expect(channels.length, `${name} ${a.role}/${b.role} ΔE=${d.toFixed(1)}`).toBeGreaterThanOrEqual(2);
          }
        }
      }
    }
    // The close pairs are known and each is reinforced (documented for review).
    expect(report.length).toBeGreaterThan(0);
  });

  it('every stroke color stays clearly visible against the canvas under every simulation', () => {
    for (const [name, matrix] of Object.entries(SIMULATIONS)) {
      for (const role of STROKE_ROLES) {
        const d = deltaE(EDGE_ENCODINGS[role].color, CANVAS_BACKGROUND, matrix);
        expect(d, `${name} ${role}`).toBeGreaterThan(30);
      }
    }
  });
});
