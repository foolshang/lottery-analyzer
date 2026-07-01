/**
 * research/backtest-tail.js
 * ทดสอบ bias + ทำนาย out-of-sample สำหรับหลักต่างๆ ของ prize1
 *
 * ส่วนที่ 1: Chi-square bias ระยะยาว (ทุกหลัก + เลขท้าย 2 ตัว)
 * ส่วนที่ 2: ทำนาย out-of-sample — argmax ความถี่สะสม vs baseline สุ่ม
 *
 * Usage: node research/backtest-tail.js
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, 'data', 'prizes-history.json');
const LOG_FILE  = join(__dirname, 'data', 'backtest-tail-log.txt');

const CHI2_CRIT_DF9  = 16.919;  // chi-square critical, df=9,  p=0.05
const CHI2_CRIT_DF99 = 123.225; // chi-square critical, df=99, p=0.05

// ─── HELPERS ────────────────────────────────────────────────────────────────

function chiSquare(observed, expected) {
  return observed.reduce((sum, obs) => sum + (obs - expected) ** 2 / expected, 0);
}

// argmax ที่ไม่ใช้ spread (ปลอดภัยกับ array ใหญ่)
function argmax(arr) {
  let best = 0, bestV = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > bestV) { bestV = arr[i]; best = i; }
  }
  return best;
}

function zScore(pHat, p0, n) {
  const se = Math.sqrt(p0 * (1 - p0) / n);
  return se === 0 ? 0 : (pHat - p0) / se;
}

function verdictZ(z) {
  if (z >= 2.58)  return '★★ p<0.01';
  if (z >= 1.96)  return '★ p<0.05';
  if (z <= -1.96) return '✗ แย่กว่าสุ่ม';
  return '— เสมอสุ่ม';
}

function toDigits6(str) {
  if (!str || !/^\d{6}$/.test(str)) return null;
  return str.split('').map(Number);
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

function main() {
  if (!existsSync(DATA_FILE)) {
    console.error(`❌ ไม่พบ ${DATA_FILE}\nรัน: node research/fetch-prizes.js ก่อน`);
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const draws = Object.values(raw)
    .filter(d => d.prize1 && /^\d{6}$/.test(d.prize1))
    .sort((a, b) => a.date.localeCompare(b.date));

  const N = draws.length;
  console.log(`📊 โหลด ${N} งวด`);
  if (N < 10) { console.error('❌ ต้องการข้อมูล ≥10 งวด'); process.exit(1); }

  // ══════════════════════════════════════════════════════════
  //  PART 1: CHI-SQUARE BIAS
  // ══════════════════════════════════════════════════════════

  // 1a: ความถี่เลขโดด 0-9 ต่อหลัก (6 หลัก × 10 เลข)
  const posFreq = Array.from({ length: 6 }, () => Array(10).fill(0));
  for (const draw of draws) {
    const d = toDigits6(draw.prize1);
    if (!d) continue;
    for (let p = 0; p < 6; p++) posFreq[p][d[p]]++;
  }
  const exp1a   = N / 10;
  const chi2Pos = posFreq.map(pos => chiSquare(pos, exp1a));

  // 1b: เลขท้าย 2 ตัว (00-99)
  const tail2Freq = Array(100).fill(0);
  for (const draw of draws) {
    if (!draw.prize1) continue;
    tail2Freq[parseInt(draw.prize1.slice(-2))]++;
  }
  const exp1b      = N / 100;
  const chi2Tail2  = chiSquare(tail2Freq, exp1b);
  const tail2Sorted = tail2Freq
    .map((cnt, i) => ({ val: String(i).padStart(2, '0'), cnt }))
    .sort((a, b) => b.cnt - a.cnt);
  const top5 = tail2Sorted.slice(0, 5);
  const bot5 = tail2Sorted.slice(-5).reverse(); // น้อยสุดก่อน

  // ══════════════════════════════════════════════════════════
  //  PART 2: OUT-OF-SAMPLE PREDICTION
  // ══════════════════════════════════════════════════════════

  // Rolling cumulative accumulators
  const cumPos    = Array.from({ length: 6 }, () => Array(10).fill(0));
  const cumTail2  = Array(100).fill(0);
  const cumTail3  = Array(1000).fill(0);
  const cumFront3 = Array(1000).fill(0);

  // [pred_hits, rand_hits] ต่อเป้า
  const hPos    = Array.from({ length: 6 }, () => [0, 0]);
  const hTail2  = [0, 0];
  const hTail3  = [0, 0];
  const hFront3 = [0, 0];
  let nPairs = 0;

  for (let i = 0; i < draws.length - 1; i++) {
    const dN  = toDigits6(draws[i].prize1);
    const dN1 = toDigits6(draws[i + 1].prize1);
    if (!dN || !dN1) continue;

    // อัปเดต cumulative ด้วยงวด N (รู้ผลแล้วตอนทำนาย N+1)
    for (let p = 0; p < 6; p++) cumPos[p][dN[p]]++;
    cumTail2[parseInt(draws[i].prize1.slice(-2))]++;
    cumTail3[parseInt(draws[i].prize1.slice(-3))]++;
    cumFront3[parseInt(draws[i].prize1.slice(0, 3))]++;

    const actTail2  = parseInt(draws[i + 1].prize1.slice(-2));
    const actTail3  = parseInt(draws[i + 1].prize1.slice(-3));
    const actFront3 = parseInt(draws[i + 1].prize1.slice(0, 3));

    // ทำนายต่อหลัก
    for (let p = 0; p < 6; p++) {
      if (argmax(cumPos[p]) === dN1[p]) hPos[p][0]++;
      if (Math.floor(Math.random() * 10) === dN1[p]) hPos[p][1]++;
    }

    // ทำนาย multi-digit
    if (argmax(cumTail2)  === actTail2)  hTail2[0]++;
    if (argmax(cumTail3)  === actTail3)  hTail3[0]++;
    if (argmax(cumFront3) === actFront3) hFront3[0]++;

    // RAND control
    if (Math.floor(Math.random() * 100)  === actTail2)  hTail2[1]++;
    if (Math.floor(Math.random() * 1000) === actTail3)  hTail3[1]++;
    if (Math.floor(Math.random() * 1000) === actFront3) hFront3[1]++;

    nPairs++;
  }

  // ══════════════════════════════════════════════════════════
  //  BUILD OUTPUT
  // ══════════════════════════════════════════════════════════

  const L = [];
  const SEP = '─'.repeat(72);

  L.push('=== Backtest: Bias + ทำนาย เลขหน้า/ท้ายของรางวัลที่ 1 ===');
  L.push(`รัน: ${new Date().toISOString()}`);
  L.push(`งวดทั้งหมด: ${N}  คู่ทดสอบ: ${nPairs}`);
  L.push('');
  L.push('[หมายเหตุสำคัญ] ข้อมูลนี้เป็น หลักหน้า/หลักท้ายของรางวัลที่ 1');
  L.push('  ≠ รางวัลเลขหน้า 3 ตัว / เลขท้าย 2-3 ตัว ที่จับแยกจริง');
  L.push('  ใช้ดู bias ของการสุ่มได้ แต่ไม่ตรงกับรางวัลที่ประกาศ');
  L.push('  (ตัวจับแยกต้องดึงเพิ่มทีหลังถ้าเจอสัญญาณ)');
  L.push('');
  L.push(SEP);
  L.push('');

  // ── 1a ──
  L.push('── 1a. Chi-square ต่อหลัก (ทั้ง 6 หลักของ prize1) ──');
  L.push(`     expected = ${exp1a.toFixed(2)} ต่อเลข   วิกฤต chi2 df=9 p=0.05 = ${CHI2_CRIT_DF9}`);
  L.push('');
  L.push('     หลัก            chi2     flag          top-3 (ครั้ง)');
  L.push('     ' + '─'.repeat(58));
  for (let p = 0; p < 6; p++) {
    const chi2  = chi2Pos[p];
    const flag  = chi2 > CHI2_CRIT_DF9 ? '⚠ เกินวิกฤต' : '';
    const group = p < 3 ? `หน้า-${p + 1}` : `ท้าย-${p - 2}`;
    const top3  = [...posFreq[p].entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([d, cnt]) => `${d}(${cnt})`).join(' ');
    L.push(
      `     หลัก ${p + 1} (${group})   ` +
      chi2.toFixed(2).padStart(7) +
      `    ${flag.padEnd(14)}` +
      top3
    );
  }
  L.push('');

  // ── 1b ──
  L.push('── 1b. Chi-square เลขท้าย 2 ตัว (00-99) ──');
  L.push(`     expected = ${exp1b.toFixed(2)} ต่อค่า   วิกฤต chi2 df=99 p=0.05 = ${CHI2_CRIT_DF99}`);
  L.push(`     chi2 = ${chi2Tail2.toFixed(2)}  ${chi2Tail2 > CHI2_CRIT_DF99 ? '⚠ เกินวิกฤต' : '(ปกติ)'}`);
  L.push(`     ออกบ่อยสุด 5: ${top5.map(x => `${x.val}(${x.cnt})`).join('  ')}`);
  L.push(`     ออกน้อยสุด 5: ${bot5.map(x => `${x.val}(${x.cnt})`).join('  ')}`);
  L.push('');

  // ── 1c ──
  L.push('── 1c. หน้า 3 ตัว / ท้าย 3 ตัว (อ้างอิงจาก 1a) ──');
  L.push('     หน้า 3 ตัว = หลัก 1,2,3 ของ prize1 (ดูแถว 1a หลัก 1-3)');
  L.push('     ท้าย 3 ตัว = หลัก 4,5,6 ของ prize1 (ดูแถว 1a หลัก 4-6)');
  const flagFront = chi2Pos.slice(0, 3).some(c => c > CHI2_CRIT_DF9) ? '⚠ มีหลักเกินวิกฤต' : '(ปกติ)';
  const flagTail3 = chi2Pos.slice(3, 6).some(c => c > CHI2_CRIT_DF9) ? '⚠ มีหลักเกินวิกฤต' : '(ปกติ)';
  L.push(`     หน้า 3: chi2 = ${chi2Pos[0].toFixed(1)}, ${chi2Pos[1].toFixed(1)}, ${chi2Pos[2].toFixed(1)}  ${flagFront}`);
  L.push(`     ท้าย 3: chi2 = ${chi2Pos[3].toFixed(1)}, ${chi2Pos[4].toFixed(1)}, ${chi2Pos[5].toFixed(1)}  ${flagTail3}`);
  L.push('');
  L.push('⚠ Multiple-comparison: ทดสอบหลายหลักพร้อมกัน → โอกาสเจอ "เกินวิกฤต" โดยบังเอิญ ~1/20');
  L.push('  ต้องเกินวิกฤตชัดเจน (chi2 >> วิกฤต หรือ z>3) ถึงจะน่าสนใจจริง');
  L.push('');
  L.push(SEP);
  L.push('');

  // ── Part 2 ──
  L.push('── ส่วนที่ 2: ทำนาย out-of-sample (argmax ความถี่สะสม) ──');
  L.push('');
  L.push(
    'เป้าทำนาย           ' +
    '    n' + '  hit rate' + '  baseline' + '       z' + '  ผลสรุป'
  );
  L.push(SEP);

  function addRow(label, hits, randHits, p0) {
    const pHat  = hits / nPairs;
    const pRand = randHits / nPairs;
    const z     = zScore(pHat,  p0, nPairs);
    const zRand = zScore(pRand, p0, nPairs);
    L.push(
      label.padEnd(20) +
      String(nPairs).padStart(5) +
      pHat.toFixed(4).padStart(10) +
      p0.toFixed(4).padStart(10) +
      z.toFixed(2).padStart(8) +
      '  ' + verdictZ(z)
    );
    L.push(
      '  └(RAND)'.padEnd(20) +
      String(nPairs).padStart(5) +
      pRand.toFixed(4).padStart(10) +
      p0.toFixed(4).padStart(10) +
      zRand.toFixed(2).padStart(8) +
      '  ' + verdictZ(zRand)
    );
  }

  const posLabels = [
    'หลัก 1 (หน้า-1)', 'หลัก 2 (หน้า-2)', 'หลัก 3 (หน้า-3)',
    'หลัก 4 (ท้าย-3)', 'หลัก 5 (ท้าย-2)', 'หลัก 6 (หน่วย)',
  ];
  for (let p = 0; p < 6; p++) {
    addRow(posLabels[p], hPos[p][0], hPos[p][1], 0.10);
  }
  L.push(SEP);
  addRow('ท้าย 2 ตัว (เป๊ะ)', hTail2[0],  hTail2[1],  0.01);
  addRow('ท้าย 3 ตัว (เป๊ะ)', hTail3[0],  hTail3[1],  0.001);
  addRow('หน้า 3 ตัว (เป๊ะ)', hFront3[0], hFront3[1], 0.001);
  L.push('');

  // ── Summary ──
  const biasSig = [];
  chi2Pos.forEach((c, p) => { if (c > CHI2_CRIT_DF9)  biasSig.push(`หลัก${p + 1}(${c.toFixed(1)})`); });
  if (chi2Tail2 > CHI2_CRIT_DF99) biasSig.push(`ท้าย2(${chi2Tail2.toFixed(1)})`);

  const allPred = [
    ...hPos.map(([h], p) => ({ label: `หลัก${p + 1}`, z: zScore(h / nPairs, 0.10, nPairs) })),
    { label: 'ท้าย2',  z: zScore(hTail2[0]  / nPairs, 0.01,  nPairs) },
    { label: 'ท้าย3',  z: zScore(hTail3[0]  / nPairs, 0.001, nPairs) },
    { label: 'หน้า3',  z: zScore(hFront3[0] / nPairs, 0.001, nPairs) },
  ];
  const predSig    = allPred.filter(r => r.z >= 1.96);
  const predStrong = allPred.filter(r => r.z >= 2.58);

  L.push(SEP);
  L.push('── สรุปรวม ──');
  if (biasSig.length === 0 && predSig.length === 0) {
    L.push('✓ ไม่พบ bias หรือสัญญาณทำนายเกินสุ่มอย่างมีนัยสำคัญ → ยืนยัน "สุ่มจริง"');
  } else {
    if (biasSig.length > 0) {
      L.push(`  Bias:   ${biasSig.join(', ')}  (${biasSig.length}/7 ทดสอบ เกินวิกฤต) ⚠ ระวัง multiple-comparison`);
    }
    if (predSig.length > 0) {
      const tags = predSig.map(r => `${r.label}(z=${r.z.toFixed(2)})`).join(', ');
      const strength = predStrong.length > 0 ? '★★ น่าสนใจ — ควรตรวจซ้ำ' : '★ เฉียด — ระวัง multiple-comparison';
      L.push(`  ทำนาย: ${tags}  ${strength}`);
    }
  }
  L.push('');
  L.push('⚠ Multiple-comparison: ทดสอบรวม 7 (bias) + 9 (ทำนาย) = 16 เป้าพร้อมกัน');
  L.push('  คาดเจอ "p<0.05" โดยบังเอิญ ~0.8 เป้า — ต้องการ z>3 หรือ ≥3 เป้าเกิน p<0.05 จึงน่าเชื่อ');

  const out = L.join('\n');
  console.log('\n' + out);
  writeFileSync(LOG_FILE, out + '\n', 'utf8');
  console.log(`\n📄 บันทึกผล → ${LOG_FILE}`);
}

main();
