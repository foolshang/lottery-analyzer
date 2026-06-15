// ============================================================
// engine.js — Lottery Analyzer Computation Engine
// Pure functions only — no React, no DOM, no Firebase
// Runs on both browser (Vite) and Node.js (automation)
// ============================================================

// ── Constants ──
export const LEARN_RATE      = 2;
export const MAX_W           = 20;
export const MAX_LOCKED_BOOST = 5;

// Phase A1/A2: Color frequency helpers
export const FREQ_COLORS = ["#374151", "#1e40af", "#7c3aed", "#f59e0b"];
export const FREQ_LABELS = ["น้อย", "ปานกลาง", "บ่อย", "บ่อยมาก"];

// ── Parse helpers ──
export function extractDigits(str) {
  return String(str).replace(/[^0-9]/g, "").split("").map(Number);
}

export function parseLine(line) {
  const clean = line.trim();
  if (!clean) return null;
  const d = clean.replace(/[^0-9]/g, "").split("").map(Number);
  return d.length >= 6 ? d.slice(0, 6) : null;
}

export function parseAll(raw) {
  if (!raw || !raw.trim()) return [];
  return raw.trim().split(/\r?\n+/).map(parseLine).filter(Boolean);
}

// ── Weight init ──
export function initWeights() {
  return Array.from({ length: 6 }, () => {
    const w = {};
    for (let d = 0; d <= 9; d++) w[d] = 0;
    return w;
  });
}

// ── Frequency helpers ──

// Aggregate frequency for 3 positions (start index in a 6-digit row)
export function buildFreq(rows, start) {
  const f = {};
  for (let d = 0; d <= 9; d++) f[d] = 0;
  rows.forEach((r) => {
    for (let i = start; i < start + 3; i++) f[r[i]]++;
  });
  return f;
}

// Per-position frequency for 3 positions
export function buildPosFreq(rows, start) {
  const p = Array.from({ length: 3 }, () => {
    const o = {};
    for (let d = 0; d <= 9; d++) o[d] = 0;
    return o;
  });
  rows.forEach((r) => {
    for (let i = 0; i < 3; i++) p[i][r[start + i]]++;
  });
  return p;
}

// Full 6-position frequency from data rows (Phase A1)
export function buildFullPosFreq(rows) {
  const freq = Array.from({ length: 6 }, () => {
    const o = {};
    for (let d = 0; d <= 9; d++) o[d] = 0;
    return o;
  });
  rows.forEach((r) => {
    for (let pos = 0; pos < 6; pos++) freq[pos][r[pos]]++;
  });
  return freq;
}

// 6-position frequency from lockedHints (Phase A2)
// Maps front/back digits to absolute positions 0-5
export function buildLockedHintsFreq(lockedHints) {
  const freq = Array.from({ length: 6 }, () => {
    const o = {};
    for (let d = 0; d <= 9; d++) o[d] = 0;
    return o;
  });
  lockedHints.forEach((h) => {
    const fd = h.front ? String(h.front).replace(/[^0-9]/g, "").split("").map(Number).slice(0, 3) : [];
    const bd = h.back  ? String(h.back).replace(/[^0-9]/g, "").split("").map(Number).slice(0, 3)  : [];

    if (fd.length === 1)      { for (let p = 0; p < 6; p++) freq[p][fd[0]]++; }
    else if (fd.length === 2) { freq[0][fd[0]]++; freq[1][fd[1]]++; }
    else if (fd.length === 3) { freq[0][fd[0]]++; freq[1][fd[1]]++; freq[2][fd[2]]++; }

    if (bd.length === 1)      { for (let p = 0; p < 6; p++) freq[p][bd[0]]++; }
    else if (bd.length === 2) { freq[4][bd[0]]++; freq[5][bd[1]]++; }
    else if (bd.length === 3) { freq[3][bd[0]]++; freq[4][bd[1]]++; freq[5][bd[2]]++; }
  });
  return freq;
}

// Map count → color level 0-3 using linear scale
export function getFreqLevel(count, globalMin, globalMax) {
  if (globalMax === globalMin) return 0;
  const ratio = (count - globalMin) / (globalMax - globalMin);
  if (ratio <= 0.25) return 0;
  if (ratio <= 0.50) return 1;
  if (ratio <= 0.75) return 2;
  return 3;
}

// Get global min/max from a 6-position freq map
export function getFreqMinMax(posFreq) {
  let min = Infinity, max = -Infinity;
  posFreq.forEach((pf) => {
    Object.values(pf).forEach((v) => {
      if (v < min) min = v;
      if (v > max) max = v;
    });
  });
  return { min: min === Infinity ? 0 : min, max: max === -Infinity ? 0 : max };
}

// ── Boost helpers ──

// Flat +3 boost per hint entry (active hints, low count)
export function boostPosFreq(pf, hints) {
  const b = pf.map((x) => ({ ...x }));
  hints.forEach(({ digits, offsetPositions }) => {
    digits.forEach((d, i) => {
      const pos = offsetPositions[i];
      if (pos >= 0 && pos < 3) b[pos][d] = (b[pos][d] || 0) + 3;
    });
  });
  return b;
}

// Normalized boost (locked hints) — frequency-proportional, prevents saturation
export function applyNormalizedBoost(pf, hintEntries, maxBoost) {
  if (!hintEntries || !hintEntries.length) return pf.map((x) => ({ ...x }));
  const counts = Array.from({ length: 3 }, () => {
    const o = {};
    for (let d = 0; d <= 9; d++) o[d] = 0;
    return o;
  });
  hintEntries.forEach(({ digits, offsetPositions }) => {
    digits.forEach((d, i) => {
      const pos = offsetPositions[i];
      if (pos >= 0 && pos < 3) counts[pos][d]++;
    });
  });
  const b = pf.map((x) => ({ ...x }));
  for (let pos = 0; pos < 3; pos++) {
    const maxCount = Math.max(...Object.values(counts[pos]));
    if (maxCount === 0) continue;
    for (let d = 0; d <= 9; d++) {
      b[pos][d] = (b[pos][d] || 0) + (counts[pos][d] / maxCount) * maxBoost;
    }
  }
  return b;
}

// Convert raw hint {front, back} → boost entries for front/back separately
export function convertHintsToBoost(hintList) {
  const front = [], back = [];
  hintList.forEach((h) => {
    const fd = h.front ? String(h.front).replace(/[^0-9]/g, "").split("").map(Number).slice(0, 3) : [];
    const bd = h.back  ? String(h.back).replace(/[^0-9]/g, "").split("").map(Number).slice(0, 3)  : [];

    if (fd.length === 1) {
      const d = fd[0];
      front.push({ digits: [d, d, d], offsetPositions: [0, 1, 2] });
      back.push ({ digits: [d, d, d], offsetPositions: [0, 1, 2] });
    } else if (fd.length === 2) {
      front.push({ digits: fd, offsetPositions: [0, 1] });
    } else if (fd.length === 3) {
      front.push({ digits: fd, offsetPositions: [0, 1, 2] });
    }

    if (bd.length === 1) {
      const d = bd[0];
      front.push({ digits: [d, d, d], offsetPositions: [0, 1, 2] });
      back.push ({ digits: [d, d, d], offsetPositions: [0, 1, 2] });
    } else if (bd.length === 2) {
      back.push({ digits: bd, offsetPositions: [1, 2] });
    } else if (bd.length === 3) {
      back.push({ digits: bd, offsetPositions: [0, 1, 2] });
    }
  });
  return { front, back };
}

// ── Core computation ──

// Weighted-random pick for 3 positions
export function pickHalf(pf, lw) {
  return [0, 1, 2].map((p) => {
    const c = {};
    for (let d = 0; d <= 9; d++) c[d] = Math.max(0.1, (pf[p][d] || 0) + (lw[p][d] || 0));
    const t = Object.values(c).reduce((s, v) => s + v, 0);
    let r = Math.random() * t;
    for (let d = 0; d <= 9; d++) {
      r -= c[d];
      if (r <= 0) return d;
    }
    return 0;
  });
}

/**
 * Main analyze function
 * activeFront/activeBack: converted boost entries from active hints (flat +3)
 * lockedFront/lockedBack: converted boost entries from locked hints (normalized)
 */
export function analyze(rows, activeFront, activeBack, lockedFront, lockedBack, lw) {
  const freqF = buildFreq(rows, 0), freqB = buildFreq(rows, 3);
  const posF  = buildPosFreq(rows, 0), posB  = buildPosFreq(rows, 3);

  let useFront = applyNormalizedBoost(posF, lockedFront, MAX_LOCKED_BOOST);
  let useBack  = applyNormalizedBoost(posB, lockedBack,  MAX_LOCKED_BOOST);

  useFront = boostPosFreq(useFront, activeFront);
  useBack  = boostPosFreq(useBack,  activeBack);

  return {
    front: pickHalf(useFront, lw.slice(0, 3)),
    back:  pickHalf(useBack,  lw.slice(3, 6)),
    freqF, freqB, posF, posB, total: rows.length,
  };
}

// Adjust learning weights based on prediction vs actual
export function adjustWeights(w, pred, actual) {
  const n = w.map((x) => ({ ...x }));
  for (let i = 0; i < 6; i++) {
    if (pred[i] === actual[i]) {
      n[i][pred[i]] = Math.min(MAX_W, (n[i][pred[i]] || 0) + LEARN_RATE);
    } else {
      n[i][pred[i]] = Math.max(-MAX_W, (n[i][pred[i]] || 0) - LEARN_RATE);
      n[i][actual[i]] = Math.min(MAX_W, (n[i][actual[i]] || 0) + LEARN_RATE);
    }
  }
  return n;
}

// Build comparison between prediction and actual prizes
export function buildComparison(pred, prizes) {
  const cmp = pred.map((p, i) => ({
    pos: i + 1, pred: p, real: prizes.full[i], hit: p === prizes.full[i],
  }));
  const hits6 = cmp.filter((c) => c.hit).length;

  const front3Results = prizes.front3.map((f3) => ({
    digits: f3,
    hits: [0, 1, 2].filter((i) => pred[i] === f3[i]).length,
    win:  [0, 1, 2].every((i) => pred[i] === f3[i]),
  }));

  const back3Results = prizes.back3.map((b3) => ({
    digits: b3,
    hits: [0, 1, 2].filter((i) => pred[i + 3] === b3[i]).length,
    win:  [0, 1, 2].every((i) => pred[i + 3] === b3[i]),
  }));

  const back2Result = prizes.back2.length === 2 ? {
    digits: prizes.back2,
    hits: [0, 1].filter((i) => pred[i + 4] === prizes.back2[i]).length,
    win:  [0, 1].every((i) => pred[i + 4] === prizes.back2[i]),
  } : null;

  return { cmp, hits6, front3Results, back3Results, back2Result };
}

// Chi-square test for digit uniformity (H0: uniform 0-9 in each position)
export function chiSquareDigits(rows) {
  if (rows.length < 30) return null;
  const positions = [];
  for (let pos = 0; pos < 6; pos++) {
    const observed = Array(10).fill(0);
    rows.forEach((r) => { if (r[pos] !== undefined) observed[r[pos]]++; });
    const expected = rows.length / 10;
    let chi2 = 0;
    for (let d = 0; d < 10; d++) {
      const diff = observed[d] - expected;
      chi2 += (diff * diff) / expected;
    }
    const random = chi2 < 16.92; // df=9, p=0.05
    positions.push({ pos: pos + 1, chi2: chi2.toFixed(2), random, observed });
  }
  const avgChi2 = positions.reduce((s, p) => s + parseFloat(p.chi2), 0) / 6;
  const allRandom = positions.every((p) => p.random);
  return { positions, avgChi2: avgChi2.toFixed(2), allRandom };
}
