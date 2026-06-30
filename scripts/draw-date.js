// draw-date.js — หาวันงวดถัดไปจาก kapook + ตัดสินใจว่าส่งทำนายไหม
// Output (GITHUB_OUTPUT): send=true/false, drawDate=YYYY-MM-DD
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath }               from 'node:url';
import { dirname, join }               from 'node:path';
import { db, COL, DOC }               from './_db.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const DATES_PATH = join(__dirname, '..', 'lottery-dates.txt');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

function todayICT() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function daysBetween(from, to) {
  return Math.round((new Date(to) - new Date(from)) / 86400000);
}

function setOutput(name, val) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${val}\n`);
  }
}

// ── Primary: ดึงจาก kapook (ลิงก์ /check/DDMMYY → เลือกวันใหม่สุด) ──────────
async function getNextDrawDateFromKapook() {
  const url = 'https://lottery.kapook.com/';
  console.log(`Fetching ${url}`);
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`kapook HTTP ${res.status}`);
  const html = await res.text();

  // เก็บรหัสวันงวดทั้งหมดจากลิงก์ /check/DDMMYY
  const codes = [...html.matchAll(/\/check\/(\d{2})(\d{2})(\d{2})\b/g)];
  if (codes.length === 0) throw new Error('ไม่พบ /check/DDMMYY ใน kapook');

  // แปลง DDMMYY (ปี พ.ศ. 2 หลักท้าย) → ISO YYYY-MM-DD + validate วันจริง
  const isoDates = [];
  for (const [, dd, mm, yy] of codes) {
    const day   = parseInt(dd, 10);
    const month = parseInt(mm, 10);
    const year  = (2500 + parseInt(yy, 10)) - 543; // BE2 → BE → CE
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    if (year < 2024 || year > 2035) continue;
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // กันวันที่ไม่มีจริง เช่น 310269
    const d = new Date(`${iso}T00:00:00+07:00`);
    if (Number.isNaN(d.getTime())) continue;
    isoDates.push(iso);
  }
  if (isoDates.length === 0) throw new Error('แปลงวันงวดจาก kapook ไม่ได้');

  // งวดถัดไป = วันใหม่สุด
  isoDates.sort();
  const next = isoDates[isoDates.length - 1];
  console.log(`kapook /check codes พบ ${isoDates.length} วัน → งวดถัดไป (ใหม่สุด) = ${next}`);
  return next;
}

// ── Fallback: อ่านจาก lottery-dates.txt ──────────────────────────────────
function getNextDrawDateFromCalendar() {
  const lines = readFileSync(DATES_PATH, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && /^\d{4}-\d{2}-\d{2}$/.test(l));

  const today    = todayICT();
  const upcoming = lines.filter((d) => d > today).sort();
  if (upcoming.length === 0) throw new Error('lottery-dates.txt ไม่มีวันที่หลังจากวันนี้');
  return upcoming[0];
}

// ── Export สำหรับ test ────────────────────────────────────────────────────
export async function getNextDrawDate() {
  try {
    return await getNextDrawDateFromKapook();
  } catch (err) {
    console.warn(`[warning] kapook: ${err.message}`);
    console.warn('[warning] ใช้ lottery-dates.txt เป็น fallback');
    return getNextDrawDateFromCalendar();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const FORCE = process.env.FORCE === 'true';

  const nextDraw = await getNextDrawDate();
  const today    = todayICT();
  const days     = daysBetween(today, nextDraw);

  // อ่าน Firestore marker กันซ้ำ
  let sentDraw = null;
  try {
    const snap = await db.collection(COL).doc(DOC).get();
    if (snap.exists) sentDraw = snap.data()?.experiment?.sent?.predictedDraw || null;
  } catch (err) {
    console.warn(`[warning] อ่าน Firestore ล้มเหลว: ${err.message} — ถือว่ายังไม่เคยส่ง`);
  }

  const alreadySent = sentDraw === nextDraw;
  const shouldSend  = FORCE ? true : (days === 2 && !alreadySent);

  console.log(`วันนี้ ICT      = ${today}`);
  console.log(`งวดถัดไป       = ${nextDraw}`);
  console.log(`อีกกี่วัน      = ${days}`);
  console.log(`เคยส่งงวดนี้แล้ว = ${alreadySent} (sentDraw=${sentDraw})`);
  console.log(`จะส่ง           = ${shouldSend}${FORCE ? ' (force)' : ''}`);

  setOutput('send', String(shouldSend));
  setOutput('drawDate', nextDraw);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
