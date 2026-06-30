// fetch-results.js — ดึงผลจาก myhora → learning → เขียน Firestore (Phase E: record 4 groups)
import { appendFileSync } from 'node:fs';
import { db, COL, DOC }  from './_db.js';
import {
  parseAll, adjustWeights, buildComparison, initWeights,
  isStatisticallySignificant,
} from '../src/engine.js';

function setOutput(name, val) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${val}\n`);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

function thaiYear() { return new Date().getFullYear() + 543; }

// ดึงผลล่าสุดจาก myhora
async function fetchLatestResult() {
  const year = thaiYear();
  const url  = `https://myhora.com/lottery/result-${year}.aspx`;
  console.log(`Fetching ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const p1m = html.match(/รางวัลที่หนึ่ง[\s\S]{1,400}?(\d{6})/);
  if (!p1m) throw new Error('ไม่พบ รางวัลที่หนึ่ง ใน HTML');
  const full = p1m[1].split('').map(Number);

  const front3 = [];
  const f3m = html.match(/เลขหน้า\s*3\s*ตัว[\s\S]{1,2000}/);
  if (f3m) {
    const nums = [...f3m[0].matchAll(/\b(\d{3})\b/g)].slice(0, 2);
    nums.forEach((n) => front3.push(n[1].split('').map(Number)));
  }

  const back3 = [];
  const b3m = html.match(/เลขท้าย\s*3\s*ตัว[\s\S]{1,2000}/);
  if (b3m) {
    const nums = [...b3m[0].matchAll(/\b(\d{3})\b/g)].slice(0, 2);
    nums.forEach((n) => back3.push(n[1].split('').map(Number)));
  }

  let back2 = [];
  const b2m = html.match(/เลขท้าย\s*2\s*ตัว[\s\S]{1,300}?\b(\d{2})\b/);
  if (b2m) back2 = b2m[1].split('').map(Number);

  const drawDateStr = (() => {
    const before = html.slice(0, html.indexOf('รางวัลที่หนึ่ง'));
    const dm = before.match(/(\d{1,2})\s*(ม\.?ค\.?|ก\.?พ\.?|มี\.?ค\.?|เม\.?ย\.?|พ\.?ค\.?|มิ\.?ย\.?|ก\.?ค\.?|ส\.?ค\.?|ก\.?ย\.?|ต\.?ค\.?|พ\.?ย\.?|ธ\.?ค\.?)\s*(\d{4})/);
    return dm ? `${dm[1]} ${dm[2]} ${dm[3]}` : `${year}`;
  })();

  return { full, front3, back3, back2, drawDateStr };
}

function countHits(pred, actual) {
  if (!pred || pred.length !== 6) return 0;
  return pred.filter((d, i) => d === actual[i]).length;
}

function initExperiment() {
  return {
    startedAt: new Date().toISOString(),
    A: { totalHits: 0, rounds: 0 },
    B: { totalHits: 0, rounds: 0 },
    C: { totalHits: 0, rounds: 0 },
    D: { totalHits: 0, rounds: 0, status: 'silent', unlockedAt: null },
    history: [],
    pending: null,
  };
}

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.env.FORCE === 'true';

async function main() {
  console.log('=== fetch-results.js (Phase E) ===');
  const prizes = await fetchLatestResult();
  console.log('รางวัลที่ 1 :', prizes.full.join(''));
  console.log('หน้า 3     :', prizes.front3.map((d) => d.join('')).join(', '));
  console.log('ท้าย 3     :', prizes.back3.map((d) => d.join('')).join(', '));
  console.log('ท้าย 2     :', prizes.back2.join(''));
  console.log('งวด        :', prizes.drawDateStr);

  if (DRY_RUN) { console.log('[dry-run] ไม่เขียน Firestore'); return; }

  const ref    = db.collection(COL).doc(DOC);
  const snap   = await ref.get();
  const stored = snap.exists ? snap.data() : {};

  const rawData = stored.data || '';
  const newRow  = prizes.full.join('');

  // ป้องกัน duplicate
  const lastRow = rawData.trim().split('\n').pop();
  if (!FORCE && lastRow === newRow) {
    console.log('ผลนี้มีในข้อมูลแล้ว — ข้าม');
    setOutput('send', 'false');
    return;
  }

  const lastPred   = stored.lastPredictions || null;
  const weights    = stored.weights || initWeights();
  const history    = stored.history || [];
  const experiment = stored.experiment || initExperiment();
  const pending    = experiment.pending || {};

  // Learning + comparison (ใช้ B = lastPredictions)
  const newWeights = lastPred ? adjustWeights(weights, lastPred, prizes.full) : weights;
  const cmp        = lastPred ? buildComparison(lastPred, prizes) : null;
  const hits       = cmp ? cmp.hits6 : 0;

  if (cmp) {
    console.log(`ทำนาย (B): ${lastPred.join('')} → ถูก ${hits}/6 ตัว`);
    if (cmp.front3Results.some((r) => r.win)) console.log('✓ หน้า 3 ถูก!');
    if (cmp.back3Results.some((r) => r.win))  console.log('✓ ท้าย 3 ถูก!');
    if (cmp.back2Result?.win)                 console.log('✓ ท้าย 2 ถูก!');
  }

  // ── Phase E: คำนวณ hits สำหรับทุกกลุ่ม ──
  const hitsA = countHits(pending.A, prizes.full);
  const hitsB = countHits(pending.B || lastPred, prizes.full);
  const hitsC = countHits(pending.C, prizes.full);
  const hitsD = countHits(pending.D, prizes.full);

  if (pending.A) console.log(`กลุ่ม A hits: ${hitsA} | B: ${hitsB} | C: ${hitsC} | D: ${hitsD}`);

  // อัปเดต experiment stats
  const newA = { ...experiment.A, totalHits: (experiment.A?.totalHits || 0) + hitsA, rounds: (experiment.A?.rounds || 0) + (pending.A ? 1 : 0) };
  const newB = { ...experiment.B, totalHits: (experiment.B?.totalHits || 0) + hitsB, rounds: (experiment.B?.rounds || 0) + (pending.B || lastPred ? 1 : 0) };
  const newC = { ...experiment.C, totalHits: (experiment.C?.totalHits || 0) + hitsC, rounds: (experiment.C?.rounds || 0) + (pending.C ? 1 : 0) };
  const newD = { ...experiment.D, totalHits: (experiment.D?.totalHits || 0) + hitsD, rounds: (experiment.D?.rounds || 0) + (pending.D ? 1 : 0) };

  // ตรวจเกณฑ์ปลดล็อก D: 30+ งวด + อย่างน้อย 1 กลุ่มมีนัยสำคัญ
  const dStatus = experiment.D?.status || 'silent';
  if (dStatus === 'silent') {
    const minRounds = Math.min(newA.rounds, newB.rounds, newC.rounds);
    const sigA = isStatisticallySignificant(newA.totalHits, newA.rounds);
    const sigB = isStatisticallySignificant(newB.totalHits, newB.rounds);
    const sigC = isStatisticallySignificant(newC.totalHits, newC.rounds);
    if (minRounds >= 30 && (sigA || sigB || sigC)) {
      newD.status     = 'unlocked';
      newD.unlockedAt = new Date().toISOString();
      const which = [sigA && 'A', sigB && 'B', sigC && 'C'].filter(Boolean).join('/');
      console.log(`🔓 กลุ่ม D ปลดล็อกแล้ว! (${minRounds} งวด, กลุ่มที่มีนัยสำคัญ: ${which})`);
    }
  }

  // เพิ่ม experiment history (newest-last)
  const expEntry = {
    drawDate: prizes.drawDateStr,
    predA: pending.A || null,
    predB: pending.B || lastPred || null,
    predC: pending.C || null,
    predD: pending.D || null,
    actual: prizes.full,
    hitsA, hitsB, hitsC, hitsD,
    createdAt: new Date().toISOString(),
  };
  const newExpHistory = [...(experiment.history || []), expEntry].slice(-100);

  const newExperiment = {
    ...experiment,
    A: newA, B: newB, C: newC, D: newD,
    history: newExpHistory,
    pending: null,
    sent:    { ...(experiment.sent || {}), resultsDraw: prizes.drawDateStr },
  };

  const newData = rawData ? rawData + '\n' + newRow : newRow;

  // history (newest-last) + createdAt
  const histEntry = {
    pred:      lastPred || [],
    hits,
    front3Win: cmp ? cmp.front3Results.some((r) => r.win) : false,
    back3Win:  cmp ? cmp.back3Results.some((r) => r.win)  : false,
    back2Win:  cmp ? (cmp.back2Result?.win || false)       : false,
    date:      prizes.drawDateStr,
    createdAt: new Date().toISOString(),
  };
  const newHistory = [...history, histEntry].slice(-50);

  // Flatten prizes for Firestore (no nested arrays)
  const prizesFlat = {
    full:   prizes.full,
    front3: prizes.front3.map((d) => d.join('')),
    back3:  prizes.back3.map((d) => d.join('')),
    back2:  prizes.back2.join(''),
  };

  await ref.set({
    data:            newData,
    weights:         newWeights,
    history:         newHistory,
    experiment:      newExperiment,
    lastResults:     { prizes: prizesFlat, cmp, drawDate: prizes.drawDateStr, prediction: lastPred },
    lastPredictions: null,
    updatedAt:       new Date().toISOString(),
  }, { merge: true });

  console.log(`✓ Firestore อัปเดตแล้ว (hits B=${hitsB}/6, A=${hitsA}, C=${hitsC}, D=${hitsD})`);
  setOutput('send', 'true');

  // แสดง experiment สรุป
  const avgFmt = (s) => s.rounds > 0 ? (s.totalHits / s.rounds).toFixed(2) : '-';
  console.log(`\n📊 สรุป experiment (${newB.rounds} งวด):`);
  console.log(`  A (no hints):   avg ${avgFmt(newA)} (${newA.rounds} งวด)`);
  console.log(`  B (current):    avg ${avgFmt(newB)} (${newB.rounds} งวด)`);
  console.log(`  C (hints≥3src): avg ${avgFmt(newC)} (${newC.rounds} งวด)`);
  console.log(`  D (ensemble):   avg ${avgFmt(newD)} (${newD.rounds} งวด) [${newD.status}]`);
  console.log(`  baseline = 0.60`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
