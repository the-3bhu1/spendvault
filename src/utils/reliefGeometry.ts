// ── Geometry for the bas-relief backdrops ────────────────────────────────────────────────────────
//
// Pure path arithmetic, kept out of the component module so both can be imported without dragging
// the other along. The COMPOSITION contract these serve is documented in components/relief.tsx.
export const VB = 400; // square: see COMPOSITION above
export const C = VB / 2; // 200 — the centre of the motif and of the hero content alike

export const f = (v: number) => v.toFixed(2);
export const polar = (r: number, a: number) => ({ x: C + r * Math.cos(a), y: C + r * Math.sin(a) });
export const deg = (a: number) => (a * 180) / Math.PI;

// A full ring with a hole punched in it (drawn with fillRule="evenodd"). A moulding needs a body to
// shade across its width — a stroked circle has no way to provide one.
export const ring = (rIn: number, rOut: number) =>
  `M ${C - rOut} ${C} A ${rOut} ${rOut} 0 1 0 ${C + rOut} ${C} A ${rOut} ${rOut} 0 1 0 ${C - rOut} ${C} Z ` +
  `M ${C - rIn} ${C} A ${rIn} ${rIn} 0 1 0 ${C + rIn} ${C} A ${rIn} ${rIn} 0 1 0 ${C - rIn} ${C} Z`;

export const arc = (r: number, a0: number, a1: number) => {
  const p0 = polar(r, a0);
  const p1 = polar(r, a1);
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M ${f(p0.x)} ${f(p0.y)} A ${r} ${r} 0 ${large} ${sweep} ${f(p1.x)} ${f(p1.y)}`;
};

// A tapered radial limb: wide at rIn, narrowing to (near) a point at rOut. Used for sunburst rays.
export const spike = (rIn: number, rOut: number, a: number, halfIn: number, halfOut: number) => {
  const p1 = polar(rIn, a - halfIn);
  const p2 = polar(rOut, a - halfOut);
  const p3 = polar(rOut, a + halfOut);
  const p4 = polar(rIn, a + halfIn);
  return `M ${f(p1.x)} ${f(p1.y)} L ${f(p2.x)} ${f(p2.y)} L ${f(p3.x)} ${f(p3.y)} L ${f(p4.x)} ${f(p4.y)} Z`;
};
