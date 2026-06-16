// predict.js — อ่าน Firestore → คำนวณทำนาย → เขียน lastPredictions
import { db, COL, DOC } from './_db.js';
import {
  parseAll, initWeights, analyze, convertHintsToBoost,
} from '../src/engine.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('=== predict.js ===');
  const ref = db.collection(COL).doc(DOC);
  const snap = await ref.get();
  const stored = snap.exists ? snap.data() : {};

  const rows        = parseAll(stored.data || '');
  const weights     = stored.weights     || initWeights();
  const hints       = stored.hints       || [];
  const lockedHints = stored.lockedHints || [];

  console.log(`rows: ${rows.length} | hints: ${hints.length} | lockedHints: ${lockedHints.length}`);

  if (rows.length === 0) {
    console.warn('ไม่มีข้อมูล rows — ไม่สามารถทำนายได้');
    return;
  }

  const { front: activeFront, back: activeBack }   = convertHintsToBoost(hints);
  const { front: lockedFront, back: lockedBack }   = convertHintsToBoost(lockedHints);

  const result = analyze(rows, activeFront, activeBack, lockedFront, lockedBack, weights);
  const pred   = [...result.front, ...result.back];

  console.log('ทำนาย:', pred.join(''), `(${pred.slice(0,3).join('')}-${pred.slice(3).join('')})`);

  if (DRY_RUN) { console.log('[dry-run] ไม่เขียน Firestore'); return; }

  await ref.set({
    lastPredictions: pred,
    lastResults:     null,
    updatedAt:       new Date().toISOString(),
  }, { merge: true });

  console.log('✓ lastPredictions เขียน Firestore แล้ว');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
