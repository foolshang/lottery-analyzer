/**
 * research/backtest-25.js
 * รัน backtest จาก research/data/prizes-history.json (ไม่ดึงเน็ต)
 * Usage: node research/backtest-25.js
 * Output: console + research/data/backtest-log.txt
 *
 * คำถาม: รางวัล 2-5 ของงวด N ทำนายรางวัลที่ 1 ของงวด N+1 ได้ดีกว่าสุ่มไหม?
 * สูตร:
 *   A (freq)  — ความถี่ prize1 สะสม งวด 1..N (out-of-sample)
 *   B-count   — ความถี่ดิบของ prize2-5 งวด N
 *   B-ladder  — B แต่ถ่วงน้ำหนัก (1-2→1, 3-4→2, 5-6→3, 7+→4)
 *   C-raw     — A count + B count รวมกัน
 *   C-norm    — normalize A,B ต่างหาก แล้ว 0.5A + 0.5B
 *   RAND      — สุ่มล้วน (control baseline)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, 'data', 'prizes-history.json');
const LOG_FILE  = join(__dirname, 'data', 'backtest-log.txt');

// ─── DIGIT HELPERS ───────────────────────────────────────────────────────────

function toDigits(str) {
  if (!str || !/^\d{6}$/.test(str)) return null;
  return str.split('').map(Number);
}

/** freq[pos][digit] = count ข้ามทุก numbers (array ของ string 6 หลัก) */
function buildFreq(numbers) {
  const freq = Array.from({ length: 6 }, () => Array(10).fill(0));
  for (const num of numbers) {
    const d = toDigits(num);
    if (!d) continue;
    for (let p = 0; p < 6; p++) freq[p][d[p]]++;
  }
  return freq;
}

function addFreq(a, b) {
  return a.map((pos, p) => pos.map((v, d) => v + b[p][d]));
}

function normalizeFreq(freq) {
  return freq.map(pos => {
    const total = pos.reduce((s, v) => s + v, 0);
    return total === 0
      ? Array(10).fill(0.1)       // uniform ถ้าไม่มีข้อมูล
      : pos.map(v => v / total);
  });
}

function argmaxFreq(freq) {
  return freq.map(pos => {
    let best = 0, bestV = -Infinity;
    for (let d = 0; d < 10; d++) if (pos[d] > bestV) { bestV = pos[d]; best = d; }
    return best;
  });
}

function ladderWeight(count) {
  if (count >= 7) return 4;
  if (count >= 5) return 3;
  if (count >= 3) return 2;
  if (count >= 1) return 1;
  return 0;
}

function randomPred() {
  return Array.from({ length: 6 }, () => Math.floor(Math.random() * 10));
}

// ─── SCORE ───────────────────────────────────────────────────────────────────

function countHits(pred, actual) {
  if (!pred || !actual) return null;
  return pred.filter((d, i) => d === actual[i]).length;
}

// ─── STATS ───────────────────────────────────────────────────────────────────

function computeStats(hitsArr) {
  const valid = hitsArr.filter(h => h !== null);
  if (valid.length === 0) return { n: 0, mean: 0, sd: 0, z: 0, ge1: 0, ge3: 0 };
  const n    = valid.length;
  const mean = valid.reduce((s, h) => s + h, 0) / n;
  const variance = n < 2
    ? 0
    : valid.reduce((s, h) => s + (h - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  const z  = sd === 0 ? 0 : (mean - 0.6) / (sd / Math.sqrt(n));
  const ge1 = valid.filter(h => h >= 1).length / n;
  const ge3 = valid.filter(h => h >= 3).length / n;
  return { n, mean, sd, z, ge1, ge3 };
}

// ─── FORMAT ──────────────────────────────────────────────────────────────────

function fmtRow(name, s, note) {
  let verdict = '';
  if (s.n < 30)             verdict = '(ข้อมูลน้อย)';
  else if (s.z >= 1.96)     verdict = '★ ชนะสุ่ม (p<0.05)';
  else if (s.z <= -1.96)    verdict = '✗ แย่กว่าสุ่ม (p<0.05)';
  else                       verdict = '— เสมอสุ่ม';

  return (
    name.padEnd(12) +
    String(s.n).padStart(6) +
    s.mean.toFixed(4).padStart(10) +
    s.sd.toFixed(4).padStart(10) +
    s.z.toFixed(3).padStart(9) +
    `${(s.ge1 * 100).toFixed(1)}%`.padStart(8) +
    `${(s.ge3 * 100).toFixed(1)}%`.padStart(8) +
    '  ' + verdict
  );
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

  // สะสม freq prize1 แบบ rolling (out-of-sample: ใส่ draw N ก่อนทำนาย N+1)
  const cumulFreq = Array.from({ length: 6 }, () => Array(10).fill(0));

  const hitsA = [], hitsBC = [], hitsBL = [], hitsCR = [], hitsCN = [], hitsRand = [];
  let nSkipped = 0, nNoPrizes25 = 0;

  for (let i = 0; i < draws.length - 1; i++) {
    const drawN  = draws[i];
    const drawN1 = draws[i + 1];

    // อัปเดต cumul freq ด้วย prize1 ของงวด N (รู้ผลแล้วตอนทำนาย N+1)
    const d1 = toDigits(drawN.prize1);
    if (d1) for (let p = 0; p < 6; p++) cumulFreq[p][d1[p]]++;

    const actual = toDigits(drawN1.prize1);
    if (!actual) { nSkipped++; continue; }

    // ── Formula A: cumulative freq ──
    const predA = argmaxFreq(cumulFreq);
    hitsA.push(countHits(predA, actual));

    // ── รวม prize2-5 ของงวด N ──
    const allP25 = [
      ...(drawN.prize2 || []), ...(drawN.prize3 || []),
      ...(drawN.prize4 || []), ...(drawN.prize5 || []),
    ].filter(n => /^\d{6}$/.test(n));

    if (allP25.length === 0) {
      nNoPrizes25++;
      hitsBC.push(null); hitsBL.push(null); hitsCR.push(null); hitsCN.push(null);
    } else {
      const freqB = buildFreq(allP25);

      // Formula B-count: raw freq argmax
      hitsBC.push(countHits(argmaxFreq(freqB), actual));

      // Formula B-ladder: weighted freq argmax
      const freqBL = freqB.map(pos => pos.map(ladderWeight));
      hitsBL.push(countHits(argmaxFreq(freqBL), actual));

      // Formula C-raw: (cumul A) + (B raw) combined
      hitsCR.push(countHits(argmaxFreq(addFreq(cumulFreq, freqB)), actual));

      // Formula C-norm: 0.5×norm(A) + 0.5×norm(B)
      const normA    = normalizeFreq(cumulFreq);
      const normB    = normalizeFreq(freqB);
      const blended  = normA.map((pos, p) => pos.map((v, d) => 0.5 * v + 0.5 * normB[p][d]));
      hitsCN.push(countHits(argmaxFreq(blended), actual));
    }

    // RAND control
    hitsRand.push(countHits(randomPred(), actual));
  }

  const totalPairs = hitsA.length;
  console.log(`  คู่ทดสอบ: ${totalPairs}  ข้าม: ${nSkipped}  ไม่มีรางวัล2-5: ${nNoPrizes25}\n`);

  const formulas = [
    { name: 'A (freq)',  arr: hitsA,   note: 'ความถี่ prize1 สะสม งวด 1..N' },
    { name: 'B-count',  arr: hitsBC,   note: 'ความถี่ดิบ prize2-5 ของงวด N' },
    { name: 'B-ladder', arr: hitsBL,   note: 'B ถ่วงน้ำหนัก ladder (1-2→1, 3-4→2, 5-6→3, 7+→4)' },
    { name: 'C-raw',    arr: hitsCR,   note: 'A count + B count รวมกัน' },
    { name: 'C-norm',   arr: hitsCN,   note: '0.5×norm(A) + 0.5×norm(B) ต่อหลัก' },
    { name: 'RAND',     arr: hitsRand, note: 'สุ่มล้วน (control)' },
  ];

  const hdr = 'สูตร        ' + '     n' + '   mean/6' + '        sd' + '         z' + '      ≥1' + '      ≥3' + '  ผลสรุป';
  const sep = '─'.repeat(88);

  const resultLines = formulas.map(({ name, arr, note }) => {
    const s = computeStats(arr);
    return fmtRow(name, s, note);
  });

  const footer = [
    '',
    'baseline สุ่ม = 0.6/6 (แต่ละตำแหน่งมีโอกาสถูก 1/10 = 0.1, รวม 6 ตำแหน่ง = 0.6)',
    'z > 1.96  → ชนะสุ่มอย่างมีนัยสำคัญ (one-tailed p < 0.05)',
    'z < -1.96 → แย่กว่าสุ่มอย่างมีนัยสำคัญ',
    '',
    'หมายเหตุสูตร:',
    ...formulas.map(f => `  ${f.name.padEnd(10)} — ${f.note}`),
    '',
    '★ หมายถึงสูตรที่น่าสนใจสำหรับต่อยอดเป็นกลุ่ม C ใน experiment',
  ];

  const lines = [
    `=== Backtest: รางวัล 2-5 (งวด N) → ทำนาย รางวัลที่ 1 (งวด N+1) ===`,
    `รัน: ${new Date().toISOString()}`,
    `งวดทั้งหมด: ${draws.length}  คู่ทดสอบ: ${totalPairs}  ข้าม: ${nSkipped}  ไม่มีรางวัล2-5: ${nNoPrizes25}`,
    '',
    hdr,
    sep,
    ...resultLines,
    sep,
    ...footer,
  ];

  const out = lines.join('\n');
  console.log(out);
  writeFileSync(LOG_FILE, out + '\n', 'utf8');
  console.log(`\n📄 บันทึกผล → ${LOG_FILE}`);
}

main();
