// fetch-results.js — ดึงผลจาก myhora → learning → เขียน Firestore
import { db, COL, DOC } from './_db.js';
import { parseAll, adjustWeights, buildComparison, initWeights } from '../src/engine.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

function thaiYear() {
  return new Date().getFullYear() + 543;
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

// ดึงผลล่าสุดจาก myhora — returns { full, front3, back3, back2, drawDateStr }
async function fetchLatestResult() {
  const year = thaiYear();
  const url = `https://myhora.com/lottery/result-${year}.aspx`;
  console.log(`Fetching ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  // รางวัลที่หนึ่ง → 6-digit
  const p1m = html.match(/รางวัลที่หนึ่ง[\s\S]{1,400}?(\d{6})/);
  if (!p1m) throw new Error('ไม่พบ รางวัลที่หนึ่ง ใน HTML');
  const full = p1m[1].split('').map(Number);

  // เลขหน้า 3 ตัว → สองชุด
  const front3 = [];
  const f3m = html.match(/เลขหน้า\s*3\s*ตัว[\s\S]{1,2000}/);
  if (f3m) {
    const nums = [...f3m[0].matchAll(/\b(\d{3})\b/g)].slice(0, 2);
    nums.forEach(n => front3.push(n[1].split('').map(Number)));
  }

  // เลขท้าย 3 ตัว → สองชุด
  const back3 = [];
  const b3m = html.match(/เลขท้าย\s*3\s*ตัว[\s\S]{1,2000}/);
  if (b3m) {
    const nums = [...b3m[0].matchAll(/\b(\d{3})\b/g)].slice(0, 2);
    nums.forEach(n => back3.push(n[1].split('').map(Number)));
  }

  // เลขท้าย 2 ตัว → หนึ่งชุด
  let back2 = [];
  const b2m = html.match(/เลขท้าย\s*2\s*ตัว[\s\S]{1,300}?\b(\d{2})\b/);
  if (b2m) back2 = b2m[1].split('').map(Number);

  // วันที่งวด — หาจาก text ก่อน รางวัลที่หนึ่ง
  const drawDateStr = (() => {
    const before = html.slice(0, html.indexOf('รางวัลที่หนึ่ง'));
    const dm = before.match(/(\d{1,2})\s*(ม\.?ค\.?|ก\.?พ\.?|มี\.?ค\.?|เม\.?ย\.?|พ\.?ค\.?|มิ\.?ย\.?|ก\.?ค\.?|ส\.?ค\.?|ก\.?ย\.?|ต\.?ค\.?|พ\.?ย\.?|ธ\.?ค\.?)\s*(\d{4})/);
    return dm ? `${dm[1]} ${dm[2]} ${dm[3]}` : `${year}`;
  })();

  return { full, front3, back3, back2, drawDateStr };
}

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('=== fetch-results.js ===');
  const prizes = await fetchLatestResult();
  console.log('รางวัลที่ 1 :', prizes.full.join(''));
  console.log('หน้า 3     :', prizes.front3.map(d => d.join('')).join(', '));
  console.log('ท้าย 3     :', prizes.back3.map(d => d.join('')).join(', '));
  console.log('ท้าย 2     :', prizes.back2.join(''));
  console.log('งวด        :', prizes.drawDateStr);

  if (DRY_RUN) { console.log('[dry-run] ไม่เขียน Firestore'); return; }

  const ref = db.collection(COL).doc(DOC);
  const snap = await ref.get();
  const stored = snap.exists ? snap.data() : {};

  const rawData = stored.data || '';
  const newRow = prizes.full.join('');

  // ป้องกัน duplicate — ถ้าผลล่าสุดเหมือนกันแล้ว ข้ามไป
  const lastRow = rawData.trim().split('\n').pop();
  if (lastRow === newRow) {
    console.log('ผลนี้มีในข้อมูลแล้ว — ข้าม');
    return;
  }

  const lastPred   = stored.lastPredictions || null;
  const weights    = stored.weights || initWeights();
  const history    = stored.history  || [];

  // เรียนรู้ถ้ามีการทำนายไว้
  const newWeights = lastPred ? adjustWeights(weights, lastPred, prizes.full) : weights;
  const cmp        = lastPred ? buildComparison(lastPred, prizes) : null;
  const hits       = cmp ? cmp.hits6 : 0;

  if (cmp) {
    console.log(`ทำนาย: ${lastPred.join('')} → ถูก ${hits}/6 ตัว`);
    if (cmp.front3Results.some(r => r.win)) console.log('✓ หน้า 3 ถูก!');
    if (cmp.back3Results.some(r => r.win))  console.log('✓ ท้าย 3 ถูก!');
    if (cmp.back2Result?.win)               console.log('✓ ท้าย 2 ถูก!');
  }

  const newData = rawData ? rawData + '\n' + newRow : newRow;

  const histEntry = {
    pred:      lastPred || [],
    hits,
    front3Win: cmp ? cmp.front3Results.some(r => r.win) : false,
    back3Win:  cmp ? cmp.back3Results.some(r => r.win)  : false,
    back2Win:  cmp ? (cmp.back2Result?.win || false)     : false,
    date:      prizes.drawDateStr,
  };
  const newHistory = [...history, histEntry].slice(-50);

  await ref.set({
    data:             newData,
    weights:          newWeights,
    history:          newHistory,
    lastResults:      { prizes, cmp, drawDate: prizes.drawDateStr, prediction: lastPred },
    lastPredictions:  null,
    updatedAt:        new Date().toISOString(),
  }, { merge: true });

  console.log(`✓ Firestore อัปเดตแล้ว (hits ${hits}/6)`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
