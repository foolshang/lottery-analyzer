// predict.js — อ่าน Firestore → คำนวณทำนาย 4 กลุ่ม (A/B/C/D) → เขียน lastPredictions + experiment.pending
import { db, COL, DOC } from './_db.js';
import {
  parseAll, initWeights, analyze, analyzeGroupA, analyzeEnsemble,
  convertHintsToBoost, groupHintsBySourceCount,
} from '../src/engine.js';

const DRY_RUN  = process.argv.includes('--dry-run');
const DRAW_DATE = process.env.DRAW_DATE || null;

function initExperiment() {
  return {
    startedAt: new Date().toISOString(),
    A: { totalHits: 0, rounds: 0 },
    B: { totalHits: 0, rounds: 0 },
    C: { totalHits: 0, rounds: 0 },
    D: { totalHits: 0, rounds: 0, status: 'silent', unlockedAt: null },
    history: [],
    pending: null,
    sent:    { predictedDraw: null, resultsDraw: null },
  };
}

async function main() {
  console.log('=== predict.js (Phase E: 4 groups) ===');
  const ref    = db.collection(COL).doc(DOC);
  const snap   = await ref.get();
  const stored = snap.exists ? snap.data() : {};

  const rows        = parseAll(stored.data || '');
  const weights     = stored.weights     || initWeights();
  const hints       = stored.hints       || [];
  const lockedHints = stored.lockedHints || [];
  const experiment  = stored.experiment  || initExperiment();

  console.log(`rows: ${rows.length} | hints: ${hints.length} | lockedHints: ${lockedHints.length}`);
  if (rows.length === 0) { console.warn('ไม่มีข้อมูล rows'); return; }

  // ── Group B (current system) ──
  const { front: activeFront, back: activeBack } = convertHintsToBoost(hints);
  const { front: lockedFront, back: lockedBack } = convertHintsToBoost(lockedHints);
  const resB  = analyze(rows, activeFront, activeBack, lockedFront, lockedBack, weights);
  const predB = [...resB.front, ...resB.back];

  // ── Group A (no hints) ──
  const resA  = analyzeGroupA(rows, weights);
  const predA = resA ? [...resA.front, ...resA.back] : predB;

  // ── Group C (hints ≥ 3 sources) ──
  const hintCounts = groupHintsBySourceCount(hints);
  const hintsC3    = hintCounts
    .filter((h) => h.count >= 3)
    .flatMap((h) => Array(h.count).fill({ front: h.front, back: h.back }));
  const { front: activeFrontC, back: activeBackC } = convertHintsToBoost(hintsC3);
  const resC  = analyze(rows, activeFrontC, activeBackC, lockedFront, lockedBack, weights);
  const predC = [...resC.front, ...resC.back];

  // ── Group D (ensemble, weighted by cumulative hits) ──
  const statsA = experiment.A || { totalHits: 0, rounds: 0 };
  const statsB = experiment.B || { totalHits: 0, rounds: 0 };
  const statsC = experiment.C || { totalHits: 0, rounds: 0 };
  const predD  = analyzeEnsemble(predA, predB, predC, statsA, statsB, statsC) || predB;

  console.log('กลุ่ม A (no hints)    :', predA.join(''), `(${predA.slice(0,3).join('')}-${predA.slice(3).join('')})`);
  console.log('กลุ่ม B (current)     :', predB.join(''), `(${predB.slice(0,3).join('')}-${predB.slice(3).join('')})`);
  console.log('กลุ่ม C (hints ≥3src) :', predC.join(''), `(${predC.slice(0,3).join('')}-${predC.slice(3).join('')})`);
  console.log('กลุ่ม D (ensemble)    :', predD.join(''), `(${predD.slice(0,3).join('')}-${predD.slice(3).join('')})`,
    `[${experiment.D?.status || 'silent'}]`);
  console.log(`  D = weighted vote (wA=${statsA.rounds>0?(statsA.totalHits/statsA.rounds).toFixed(2):'0.10'} wB=${statsB.rounds>0?(statsB.totalHits/statsB.rounds).toFixed(2):'0.10'} wC=${statsC.rounds>0?(statsC.totalHits/statsC.rounds).toFixed(2):'0.10'})`);

  if (DRY_RUN) { console.log('[dry-run] ไม่เขียน Firestore'); return; }

  const newExperiment = {
    ...experiment,
    pending: { A: predA, B: predB, C: predC, D: predD },
    sent:    { ...(experiment.sent || {}), predictedDraw: DRAW_DATE },
  };

  await ref.set({
    lastPredictions: predB,  // keep existing field for web app
    lastResults:     null,
    experiment:      newExperiment,
    updatedAt:       new Date().toISOString(),
  }, { merge: true });

  console.log('✓ lastPredictions + experiment.pending เขียน Firestore แล้ว');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
