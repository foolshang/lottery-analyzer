/**
 * research/backtest-overlap.js
 * รัน backtest จาก research/data/prizes-history.json (ไม่ดึงเน็ต)
 * Usage: node research/backtest-overlap.js
 * Output: console + research/data/backtest-overlap-log.txt
 *
 * คำถาม: เวลาทายพลาดตำแหน่ง เรา "เลือกเลขโดดถูก" มากแค่ไหน?
 * วัด 2 มิติสำหรับทุกคู่งวด N→N+1 (ทำนายรางวัลที่ 1 งวด N+1 ด้วย freq สะสมงวด 1..N):
 *   1. Positional match — ตรงตำแหน่งกี่หลัก/6 (เหมือน backtest-25.js Formula A)
 *   2. Digit-set overlap — นับเลขโดดที่ทายถูกไม่สนตำแหน่ง (multiset intersection) 0-6
 * RAND control — ทายด้วยเลขสุ่มล้วน ใช้เป็นเส้นฐาน (baseline) ของ digit-overlap
 * (แทนสูตรคณิตศาสตร์วิเคราะห์ตรง ๆ เพราะ joint distribution ของ multiset ซับซ้อน —
 *  ใช้ RAND control จริงเทียบแบบ paired z-test ต่องวดแทน)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, 'data', 'prizes-history.json');
const LOG_FILE  = join(__dirname, 'data', 'backtest-overlap-log.txt');

// ─── DIGIT HELPERS ───────────────────────────────────────────────────────────

function toDigits(str) {
  if (!str || !/^\d{6}$/.test(str)) return null;
  return str.split('').map(Number);
}

function buildFreq(numbers) {
  const freq = Array.from({ length: 6 }, () => Array(10).fill(0));
  for (const num of numbers) {
    const d = toDigits(num);
    if (!d) continue;
    for (let p = 0; p < 6; p++) freq[p][d[p]]++;
  }
  return freq;
}

function argmaxFreq(freq) {
  return freq.map(pos => {
    let best = 0, bestV = -Infinity;
    for (let d = 0; d < 10; d++) if (pos[d] > bestV) { bestV = pos[d]; best = d; }
    return best;
  });
}

function randomPred() {
  return Array.from({ length: 6 }, () => Math.floor(Math.random() * 10));
}

// ─── SCORE ───────────────────────────────────────────────────────────────────

function positionalHits(pred, actual) {
  if (!pred || !actual) return null;
  return pred.filter((d, i) => d === actual[i]).length;
}

// multiset intersection: นับเลขโดดที่ตรงกัน ไม่สนตำแหน่ง (0-6)
function digitOverlap(pred, actual) {
  if (!pred || !actual) return null;
  const cP = Array(10).fill(0);
  const cA = Array(10).fill(0);
  for (const d of pred)   cP[d]++;
  for (const d of actual) cA[d]++;
  let overlap = 0;
  for (let v = 0; v < 10; v++) overlap += Math.min(cP[v], cA[v]);
  return overlap;
}

// ─── STATS ───────────────────────────────────────────────────────────────────

function mean(arr) { return arr.reduce((s, v) => s + v, 0) / arr.length; }

function sd(arr, m) {
  if (arr.length < 2) return 0;
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function computeStats(valuesArr, baseline) {
  const valid = valuesArr.filter(v => v !== null);
  if (valid.length === 0) return { n: 0, mean: 0, sd: 0, z: 0 };
  const n = valid.length;
  const m = mean(valid);
  const s = sd(valid, m);
  const z = s === 0 ? 0 : (m - baseline) / (s / Math.sqrt(n));
  return { n, mean: m, sd: s, z };
}

// paired z-test: diff_i = a_i - b_i ต่องวดเดียวกัน (คุมความแปรปรวนระหว่างงวด)
function pairedZ(aArr, bArr) {
  const diffs = [];
  for (let i = 0; i < aArr.length; i++) {
    if (aArr[i] === null || bArr[i] === null) continue;
    diffs.push(aArr[i] - bArr[i]);
  }
  if (diffs.length === 0) return { n: 0, meanDiff: 0, sd: 0, z: 0 };
  const n = diffs.length;
  const m = mean(diffs);
  const s = sd(diffs, m);
  const z = s === 0 ? 0 : m / (s / Math.sqrt(n));
  return { n, meanDiff: m, sd: s, z };
}

function verdictFor(z) {
  if (z >= 1.96)  return '★ ชนะ baseline อย่างมีนัยสำคัญ (p<0.05)';
  if (z <= -1.96) return '✗ แย่กว่า baseline อย่างมีนัยสำคัญ';
  return '— เสมอ baseline';
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

function main() {
  if (!existsSync(DATA_FILE)) {
    console.error(`❌ ไม่พบ ${DATA_FILE}\nรัน: node research/fetch-prizes.js ก่อน`);
    process.exit(1);
  }

  const raw   = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const draws = Object.values(raw)
    .filter(d => d.prize1 && /^\d{6}$/.test(d.prize1))
    .sort((a, b) => a.date.localeCompare(b.date));

  console.log(`📊 โหลด ${draws.length} งวด (ทั้งหมดในไฟล์: ${Object.keys(raw).length})`);

  if (draws.length < 2) {
    console.error('❌ ต้องการข้อมูล ≥2 งวด');
    process.exit(1);
  }

  const cumulFreq = Array.from({ length: 6 }, () => Array(10).fill(0));

  const posFreq = [], posRand = [];
  const ovFreq  = [], ovRand  = [];
  let nSkipped = 0;
  let zeroPositionalHighOverlap = 0; // ทายตำแหน่งถูก 0 หลัก แต่ overlap >= 3
  let freqRounds = 0;

  for (let i = 0; i < draws.length - 1; i++) {
    const drawN  = draws[i];
    const drawN1 = draws[i + 1];

    const d1 = toDigits(drawN.prize1);
    if (d1) for (let p = 0; p < 6; p++) cumulFreq[p][d1[p]]++;

    const actual = toDigits(drawN1.prize1);
    if (!actual) { nSkipped++; continue; }

    const predFreq = argmaxFreq(cumulFreq);
    const predRand = randomPred();

    const pHitsFreq = positionalHits(predFreq, actual);
    const pHitsRand = positionalHits(predRand, actual);
    const ovHitsFreq = digitOverlap(predFreq, actual);
    const ovHitsRand = digitOverlap(predRand, actual);

    posFreq.push(pHitsFreq);
    posRand.push(pHitsRand);
    ovFreq.push(ovHitsFreq);
    ovRand.push(ovHitsRand);

    freqRounds++;
    if (pHitsFreq === 0 && ovHitsFreq >= 3) zeroPositionalHighOverlap++;
  }

  const totalPairs = posFreq.length;
  console.log(`  คู่ทดสอบ: ${totalPairs}  ข้าม: ${nSkipped}\n`);

  const posFreqStats = computeStats(posFreq, 0.6);
  const posRandStats = computeStats(posRand, 0.6);
  const ovRandStats  = computeStats(ovRand, 0); // เก็บ mean/sd ไว้แสดงเป็น baseline เชิงประจักษ์
  const ovFreqVsRandBaseline = computeStats(ovFreq, ovRandStats.mean);
  const paired = pairedZ(ovFreq, ovRand);

  const pct = freqRounds > 0 ? (zeroPositionalHighOverlap / freqRounds * 100) : 0;

  const hdr = 'รายการ                       ' + '     n' + '     mean' + '        sd' + '         z' + '  ผลสรุป';
  const sep = '─'.repeat(96);

  const rows = [];
  rows.push([
    'Positional (freq, base=0.6)'.padEnd(29) +
    String(posFreqStats.n).padStart(6) +
    posFreqStats.mean.toFixed(4).padStart(10) +
    posFreqStats.sd.toFixed(4).padStart(10) +
    posFreqStats.z.toFixed(3).padStart(10) +
    '  ' + verdictFor(posFreqStats.z),
  ]);
  rows.push([
    'Positional (RAND, base=0.6)'.padEnd(29) +
    String(posRandStats.n).padStart(6) +
    posRandStats.mean.toFixed(4).padStart(10) +
    posRandStats.sd.toFixed(4).padStart(10) +
    posRandStats.z.toFixed(3).padStart(10) +
    '  ' + verdictFor(posRandStats.z),
  ]);
  rows.push([
    `Digit-overlap (freq, base=RAND mean ${ovRandStats.mean.toFixed(4)})`.padEnd(29) +
    String(ovFreqVsRandBaseline.n).padStart(6) +
    ovFreqVsRandBaseline.mean.toFixed(4).padStart(10) +
    ovFreqVsRandBaseline.sd.toFixed(4).padStart(10) +
    ovFreqVsRandBaseline.z.toFixed(3).padStart(10) +
    '  ' + verdictFor(ovFreqVsRandBaseline.z),
  ]);
  rows.push([
    'Digit-overlap (RAND control)'.padEnd(29) +
    String(ovRandStats.n).padStart(6) +
    ovRandStats.mean.toFixed(4).padStart(10) +
    ovRandStats.sd.toFixed(4).padStart(10) +
    '        —'.padStart(10) +
    '  (เส้นฐานเชิงประจักษ์)',
  ]);

  const pairedLine =
    `Paired z-test (freq overlap − RAND overlap ต่องวด): n=${paired.n}  meanDiff=${paired.meanDiff.toFixed(4)}  sd=${paired.sd.toFixed(4)}  z=${paired.z.toFixed(3)}  ${verdictFor(paired.z)}`;

  const pctLine =
    `เคส "ทายตำแหน่งถูก 0 หลัก แต่ digit-overlap ≥3" : ${zeroPositionalHighOverlap}/${freqRounds} (${pct.toFixed(1)}%)`;

  const footer = [
    '',
    'positional baseline = 0.6/6 (แต่ละตำแหน่งมีโอกาสถูก 1/10 = 0.1, รวม 6 ตำแหน่ง = 0.6)',
    'digit-overlap baseline = ไม่มีสูตรวิเคราะห์ตรง ๆ (multiset joint distribution ซับซ้อน)',
    '  → ใช้ RAND control (ทายเลขสุ่มล้วน) เป็นเส้นฐานเชิงประจักษ์แทน',
    'z > 1.96  → ชนะ baseline อย่างมีนัยสำคัญ (one-tailed p < 0.05)',
    'z < -1.96 → แย่กว่า baseline อย่างมีนัยสำคัญ',
    '',
    pairedLine,
    pctLine,
    '',
    'สรุป: ถ้า digit-overlap (freq) ก็ไม่เกิน RAND control เหมือนกัน = การเลือกเลขไม่ได้ดีกว่าเดา (ต่อยอดไม่คุ้ม)',
    '     ถ้าเกิน = มีของให้เล่นเรื่อง "ปรับตำแหน่ง" ต่อ (เลือกเลขถูกแต่วางตำแหน่งผิด)',
  ];

  const lines = [
    '=== Backtest: Digit-overlap vs Positional match (freq สะสม งวด N → รางวัลที่ 1 งวด N+1) ===',
    `รัน: ${new Date().toISOString()}`,
    `งวดทั้งหมด: ${draws.length}  คู่ทดสอบ: ${totalPairs}  ข้าม: ${nSkipped}`,
    '',
    hdr,
    sep,
    ...rows,
    sep,
    ...footer,
  ];

  const out = lines.join('\n');
  console.log(out);
  writeFileSync(LOG_FILE, out + '\n', 'utf8');
  console.log(`\n📄 บันทึกผล → ${LOG_FILE}`);
}

main();
