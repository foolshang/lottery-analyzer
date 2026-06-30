// draw-date.js — หาวันงวดถัดไปจากไทยรัฐ + ตัดสินใจว่าส่งทำนายไหม
// Output (GITHUB_OUTPUT): send=true/false, drawDate=YYYY-MM-DD
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath }               from 'node:url';
import { dirname, join }               from 'node:path';
import { db, COL, DOC }               from './_db.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const DATES_PATH = join(__dirname, '..', 'lottery-dates.txt');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const MONTH_MAP = {
  'มกราคม':    1,
  'กุมภาพันธ์':  2,
  'มีนาคม':    3,
  'เมษายน':    4,
  'พฤษภาคม':   5,
  'มิถุนายน':   6,
  'กรกฎาคม':   7,
  'สิงหาคม':   8,
  'กันยายน':   9,
  'ตุลาคม':    10,
  'พฤศจิกายน': 11,
  'ธันวาคม':   12,
};

function parseThaiDate(d, m, y) {
  const month = MONTH_MAP[m];
  if (!month) return null;
  const year = parseInt(y, 10) - 543; // BE → CE
  if (year < 2024 || year > 2035) return null;
  const day = parseInt(d, 10);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

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

// ── Primary: ดึงจากไทยรัฐ ──────────────────────────────────────────────────
async function getNextDrawDateFromThairath() {
  const url = 'https://www.thairath.co.th/lottery';
  console.log(`Fetching ${url}`);
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Thairath HTTP ${res.status}`);
  const html = await res.text();

  // หา "งวดประจำวันที่ D monthname YYYY"
  const m = html.match(/งวดประจำวันที่\s+(\d{1,2})\s+([฀-๿]+)\s+(\d{4})/);
  if (!m) throw new Error('ไม่พบ "งวดประจำวันที่" ใน HTML ไทยรัฐ');

  const [, day, monthName, year] = m;
  console.log(`ไทยรัฐแสดงงวด: ${day} ${monthName} ${year}`);

  // ตรวจว่าผลยังไม่ออก
  if (!html.includes('XXXXXX')) {
    throw new Error(`ผลงวดนี้ออกแล้ว ไม่ใช่งวดถัดไป (ไม่พบ XXXXXX)`);
  }

  const iso = parseThaiDate(day, monthName, year);
  if (!iso) throw new Error(`parse วันที่ล้มเหลว: ${day} ${monthName} ${year}`);

  return iso;
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
    return await getNextDrawDateFromThairath();
  } catch (err) {
    console.warn(`[warning] ไทยรัฐ: ${err.message}`);
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
