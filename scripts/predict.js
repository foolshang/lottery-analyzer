// predict.js — กลุ่ม A/B/C จาก freq(prize1) + hints(รางวัล 2-3 งวดก่อน)
import { db, COL, DOC } from './_db.js';
import { parseAll }     from '../src/engine.js';

const DRY_RUN   = process.argv.includes('--dry-run');
const DRAW_DATE = process.env.DRAW_DATE || null;

// น้ำหนักกลุ่ม B (ปรับได้)
const WEIGHTS = { freq: 0.7, hints: 0.3 };

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildFreqFromRows(rows) {
  const freq = Array.from({ length: 6 }, () => Array(10).fill(0));
  for (const row of rows) {
    for (let p = 0; p < 6; p++) freq[p][row[p]]++;
  }
  return freq;
}

function buildFreqFromNumbers(numbers) {
  const freq = Array.from({ length: 6 }, () => Array(10).fill(0));
  for (const num of numbers) {
    if (!/^\d{6}$/.test(num)) continue;
    const d = num.split('').map(Number);
    for (let p = 0; p < 6; p++) freq[p][d[p]]++;
  }
  return freq;
}

function normalize(freq) {
  return freq.map(pos => {
    const total = pos.reduce((s, v) => s + v, 0);
    return total === 0
      ? Array(10).fill(0.1)
      : pos.map(v => v / total);
  });
}

function argmaxArr(arr) {
  let best = 0, bestV = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > bestV) { bestV = arr[i]; best = i; }
  }
  return best;
}

function blendPredict(freqNorm, hintsNorm, wFreq, wHints) {
  return freqNorm.map((pos, p) =>
    argmaxArr(pos.map((v, d) => wFreq * v + wHints * hintsNorm[p][d]))
  );
}

function initExperiment() {
  return {
    startedAt: new Date().toISOString(),
    A: { totalHits: 0, rounds: 0 },
    B: { totalHits: 0, rounds: 0 },
    C: { totalHits: 0, rounds: 0 },
    history: [],
    pending: null,
    sent:    { predictedDraw: null, resultsDraw: null },
  };
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== predict.js (A=freq, B=blend, C=hints รางวัล2-3) ===');
  const ref    = db.collection(COL).doc(DOC);
  const snap   = await ref.get();
  const stored = snap.exists ? snap.data() : {};

  const rows = parseAll(stored.data || '');
  console.log(`rows: ${rows.length}`);
  if (rows.length === 0) { console.warn('ไม่มีข้อมูล rows'); return; }

  // reset อัตโนมัติถ้า experiment format เก่า (มีกลุ่ม D = ระบบเก่า)
  let experiment = stored.experiment || initExperiment();
  if ('D' in experiment) {
    console.log('[reset] experiment format เก่า (มีกลุ่ม D) → reset สำหรับ A/B/C ใหม่');
    experiment = { ...initExperiment(), sent: experiment.sent || {} };
  }

  // ── ความถี่ prize1 สะสมทั้งประวัติ ──
  const freqTable = buildFreqFromRows(rows);
  const freqNorm  = normalize(freqTable);

  // ── hints จาก hintsSource (รางวัล 2-3 ของงวดที่เพิ่งออก) ──
  const hintsSource = stored.hintsSource || null;
  let hintsNorm;
  let hintsAvailable = false;

  if (hintsSource?.prize2?.length > 0 || hintsSource?.prize3?.length > 0) {
    const allNums    = [...(hintsSource.prize2 || []), ...(hintsSource.prize3 || [])];
    const hintsTable = buildFreqFromNumbers(allNums);
    hintsNorm        = normalize(hintsTable);
    hintsAvailable   = true;
    console.log(`hintsSource งวด ${hintsSource.drawDate}: prize2=${hintsSource.prize2?.length || 0} prize3=${hintsSource.prize3?.length || 0} (รวม ${allNums.length} ชุด)`);
  } else {
    hintsNorm = Array.from({ length: 6 }, () => Array(10).fill(0.1));
    console.warn('[warning] ไม่มี hintsSource — ใช้ uniform fallback (B≈A, C=predA)');
  }

  // ── 3 กลุ่ม ──
  const predA = freqNorm.map(pos => argmaxArr(pos));

  const predB = hintsAvailable
    ? blendPredict(freqNorm, hintsNorm, WEIGHTS.freq, WEIGHTS.hints)
    : [...predA];

  const predC = hintsAvailable
    ? hintsNorm.map(pos => argmaxArr(pos))
    : [...predA];

  const fmt = arr => `${arr.slice(0, 3).join('')}-${arr.slice(3).join('')}`;
  console.log(`กลุ่ม A (freq ล้วน)                   : ${fmt(predA)}`);
  console.log(`กลุ่ม B (${WEIGHTS.freq}×freq + ${WEIGHTS.hints}×hints รางวัล2-3): ${fmt(predB)}`);
  console.log(`กลุ่ม C (hints รางวัล2-3 ล้วน)        : ${fmt(predC)}`);
  if (!hintsAvailable) console.log('[fallback] B=A, C=A');

  if (DRY_RUN) { console.log('[dry-run] ไม่เขียน Firestore'); return; }

  const newExperiment = {
    ...experiment,
    pending: { A: predA, B: predB, C: predC },
    sent:    { ...(experiment.sent || {}), predictedDraw: DRAW_DATE },
  };

  await ref.set({
    lastPredictions: predB,
    lastResults:     null,
    experiment:      newExperiment,
    updatedAt:       new Date().toISOString(),
  }, { merge: true });

  console.log('✓ lastPredictions + experiment.pending เขียน Firestore แล้ว');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
