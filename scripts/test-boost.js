// test-boost.js — ตรวจสอบว่า normalize boost ของ lockedHints ไม่ตัน
// รัน: node scripts/test-boost.js
// ไม่ต้องการ Firestore / credentials

import { convertHintsToBoost, applyNormalizedBoost, MAX_LOCKED_BOOST, MAX_W } from '../src/engine.js';

// สร้าง lockedHints สังเคราะห์ 246 ชุด (82 งวด × 3 entries/งวด)
// format เหมือน hints-input-66-69.txt: {front, back}
function generateSyntheticLockedHints(seed = 42) {
  const rng = (() => { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xFFFFFFFF; }; })();
  const d = () => Math.floor(rng() * 10);
  const hints = [];
  for (let i = 0; i < 82; i++) {
    // entry 1: front=3ตัว, back=3ตัว
    hints.push({ front: `${d()}${d()}${d()}`, back: `${d()}${d()}${d()}` });
    // entry 2: front=3ตัว, back=3ตัว
    hints.push({ front: `${d()}${d()}${d()}`, back: `${d()}${d()}${d()}` });
    // entry 3: front="", back=2ตัว
    hints.push({ front: '', back: `${d()}${d()}` });
  }
  return hints;
}

// posFreq เริ่มต้น (ค่าศูนย์) — เพื่อดู boost ล้วนๆ
function zeroPosFreq() {
  return Array.from({ length: 3 }, () => {
    const o = {};
    for (let d = 0; d <= 9; d++) o[d] = 0;
    return o;
  });
}

function printPos(label, pf) {
  console.log(`\n${label}:`);
  for (let pos = 0; pos < 3; pos++) {
    const entries = Object.entries(pf[pos])
      .map(([d, v]) => `${d}:${v.toFixed(2)}`)
      .sort((a, b) => parseFloat(b.split(':')[1]) - parseFloat(a.split(':')[1]));
    const top3 = entries.slice(0, 3).join('  ');
    const maxVal = parseFloat(entries[0].split(':')[1]);
    const saturated = maxVal >= MAX_W ? ' ⚠️ SATURATED' : '';
    console.log(`  pos${pos + 1}: ${top3}${saturated}  (max=${maxVal.toFixed(2)}, MAX_W=${MAX_W})`);
  }
}

function checkSaturation(pf) {
  let saturated = false;
  for (let pos = 0; pos < 3; pos++) {
    const vals = Object.values(pf[pos]);
    if (Math.max(...vals) >= MAX_W) saturated = true;
  }
  return saturated;
}

// ── Main ──
console.log('=== test-boost.js: ตรวจสอบ normalize boost ===');
console.log(`MAX_LOCKED_BOOST = ${MAX_LOCKED_BOOST}, MAX_W = ${MAX_W}`);

const lockedHints = generateSyntheticLockedHints(42);
console.log(`\nlockedHints จำนวน: ${lockedHints.length} ชุด`);

const { front: lockedFront, back: lockedBack } = convertHintsToBoost(lockedHints);
console.log(`lockedFront entries: ${lockedFront.length}, lockedBack entries: ${lockedBack.length}`);

const zeroPF = zeroPosFreq();
const boostedFront = applyNormalizedBoost(zeroPF, lockedFront, MAX_LOCKED_BOOST);
const boostedBack  = applyNormalizedBoost(zeroPF, lockedBack,  MAX_LOCKED_BOOST);

printPos('Front boost (pos1-3)', boostedFront);
printPos('Back boost (pos4-6)', boostedBack);

const frontSat = checkSaturation(boostedFront);
const backSat  = checkSaturation(boostedBack);

console.log('\n=== ผลสรุป ===');
console.log(`Front saturated: ${frontSat ? '❌ ตัน' : '✅ ไม่ตัน'}`);
console.log(`Back  saturated: ${backSat  ? '❌ ตัน' : '✅ ไม่ตัน'}`);
console.log(`Boost สูงสุดที่เป็นไปได้ = ${MAX_LOCKED_BOOST} (จาก MAX_LOCKED_BOOST)`);
console.log(`Learning weight สูงสุด   = ${MAX_W} (MAX_W)`);
console.log(`Boost คิดเป็น ${((MAX_LOCKED_BOOST / MAX_W) * 100).toFixed(0)}% ของ MAX_W — ไม่ตัน`);
