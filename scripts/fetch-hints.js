// fetch-hints.js — ดึงเลขเด็ดจาก 5 สำนัก kapook → เขียน Firestore hints
import { db, COL, DOC } from './_db.js';

const SOURCES = [
  { name: 'แม่น้ำหนึ่ง',       url: 'https://lottery.kapook.com/' + encodeURIComponent('แม่น้ำหนึ่ง') },
  { name: 'แม่จำเนียร',         url: 'https://lottery.kapook.com/' + encodeURIComponent('หวยแม่จำเนียร') },
  { name: 'บ้านสีฟ้า',          url: 'https://lottery.kapook.com/' + encodeURIComponent('หวยบ้านสีฟ้า') },
  { name: 'คำชะโนด',            url: 'https://lottery.kapook.com/' + encodeURIComponent('คำชะโนด') },
  { name: 'หลวงพ่อปากแดง',     url: 'https://lottery.kapook.com/' + encodeURIComponent('หวยหลวงพ่อปากแดง') },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.text();
}

// ค้นหา URL บทความล่าสุด (viewXXXXXX.html) จากหน้าสำนัก
async function getLatestArticleUrl(srcUrl) {
  const html = await fetchText(srcUrl);
  const m = html.match(/href="((?:https?:\/\/lottery\.kapook\.com\/)?view\d+\.html)"/i);
  if (!m) return null;
  const href = m[1];
  if (href.startsWith('http')) return href;
  const base = new URL(srcUrl);
  return `${base.origin}${href.startsWith('/') ? '' : '/'}${href}`;
}

// ดึงตัวเลขจากบทความ — รูปแบบ "- NN" หรือ "- NNN"
function extractNumbers(html) {
  const text = html.replace(/<[^>]+>/g, ' ');
  const found = new Set();
  const re = /[–\-]\s*(\d{2,3})(?!\d)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = m[1];
    if (n.length === 2 || n.length === 3) found.add(n);
  }
  return [...found];
}

// รวมตัวเลขจากทุกสำนัก → counts = { "57": 3, "25": 1, ... }
async function collectCounts() {
  const counts = {};
  for (const src of SOURCES) {
    try {
      console.log(`[${src.name}] fetching index...`);
      const articleUrl = await getLatestArticleUrl(src.url);
      if (!articleUrl) { console.warn(`  ไม่พบ article URL`); continue; }
      await sleep(600);
      console.log(`  article: ${articleUrl}`);
      const html = await fetchText(articleUrl);
      const nums = extractNumbers(html);
      console.log(`  เลข: ${nums.join(', ')}`);
      for (const n of nums) counts[n] = (counts[n] || 0) + 1;
    } catch (e) {
      console.warn(`  [${src.name}] error: ${e.message}`);
    }
    await sleep(600);
  }
  return counts;
}

// แปลง counts → hints array (repeat N times = weight)
function toHints(counts) {
  const hints = [];
  for (const [num, n] of Object.entries(counts)) {
    // เลข 2 ตัว → back; เลข 3 ตัว → back (ท้าย 3)
    const entry = { front: '', back: num };
    for (let i = 0; i < n; i++) hints.push(entry);
  }
  return hints;
}

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('=== fetch-hints.js ===');
  const counts = await collectCounts();
  const hints = toHints(counts);

  const unique = Object.keys(counts).length;
  console.log(`\nรวม ${hints.length} entries จาก ${unique} เลขไม่ซ้ำ`);
  if (unique > 0) {
    console.log('เลขและน้ำหนัก:', Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}×${v}`).join(' '));
  }

  if (DRY_RUN) { console.log('[dry-run] ไม่เขียน Firestore'); return; }

  if (hints.length === 0) {
    console.warn('ไม่พบเลข — ไม่อัปเดต Firestore');
    return;
  }

  const ref = db.collection(COL).doc(DOC);
  await ref.set({ hints, updatedAt: new Date().toISOString() }, { merge: true });
  console.log('✓ hints เขียน Firestore แล้ว');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
