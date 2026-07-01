/**
 * research/fetch-prizes.js
 * ดึงผลรางวัล (ที่ 1 + ที่ 2-5) ทุกงวดจาก myhora → research/data/prizes-history.json
 * Usage:
 *   node research/fetch-prizes.js          ดึงทั้งหมด (resume อัตโนมัติ)
 *   node research/fetch-prizes.js --smoke  ดึง 3 งวดล่าสุดเท่านั้น (ทดสอบ parse)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = join(__dirname, 'data');
const OUT_FILE  = join(DATA_DIR, 'prizes-history.json');

const UA          = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const TIMEOUT_MS  = 20_000;
const DELAY_DRAW  = 1_500;
const DELAY_YEAR  = 3_000;
const SMOKE       = process.argv.includes('--smoke');
const START_YEAR  = 2538; // BE
const END_YEAR    = 2569; // BE

// ─── HTTP ────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchText(url) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'th,en;q=0.9' },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.status === 404)                                    return { status: 404, text: null };
    if (res.status === 429 || res.status === 403 || res.status >= 500)
      throw new Error(`HTTP ${res.status}`);
    return { status: res.status, text: await res.text() };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function fetchWithRetry(url) {
  const backoffs = [30_000, 60_000, 120_000];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchText(url);
    } catch (e) {
      if (attempt === 2) throw e;
      const wait = backoffs[attempt];
      console.log(`  ⚠ retry ${attempt + 1}/3 in ${wait / 1000}s — ${e.message}`);
      await sleep(wait);
    }
  }
}

// ─── PARSE ───────────────────────────────────────────────────────────────────

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi,  ' ')
    .replace(/<[^>]+>/g,   ' ')
    .replace(/&nbsp;/gi,   ' ')
    .replace(/&amp;/gi,    '&')
    .replace(/&#\d+;/g,    ' ')
    .replace(/\s+/g,       ' ')
    .trim();
}

// ตรงกัน 6 หลักที่ไม่มีหลักติดข้างๆ — ปลอดภัยจากค่าเงินที่มี comma (6,000,000)
const RE6 = /(?<!\d)\d{6}(?!\d)/g;

function all6digit(text) {
  const hits = [];
  let m;
  const re = new RegExp(RE6.source, 'g');
  while ((m = re.exec(text)) !== null) hits.push(m[0]);
  return hits;
}

// หา section ระหว่าง startMarker กับ endMarker แรกที่เจอ
function extractSection(text, startMarkers, endMarkers) {
  for (const sm of startMarkers) {
    const si = text.indexOf(sm);
    if (si === -1) continue;
    const after = si + sm.length;
    let ei = text.length;
    for (const em of endMarkers) {
      const idx = text.indexOf(em, after);
      if (idx !== -1 && idx < ei) ei = idx;
    }
    return text.slice(after, ei);
  }
  return '';
}

function parsePrize1(html, text) {
  // รูปแบบที่พบใน meta / body: รางวัลที่ 1 (287184)
  const metaM = html.match(/รางวัลที่\s*1[^(]{0,60}\((\d{6})\)/);
  if (metaM) return metaM[1];

  // หาจาก section หลัง "รางวัลที่ 1"
  const ENDS = ['รางวัลที่ 2', 'รางวัลที่2', 'รางวัลข้างเคียง'];
  const sec = extractSection(text, ['รางวัลที่ 1', 'รางวัลที่1'], ENDS);
  const nums = all6digit(sec);
  if (nums.length > 0) return nums[0];

  // fallback: เลข 6 หลักตัวแรกในหน้า
  const m = text.match(RE6);
  return m ? m[0] : null;
}

function parsePrizes2to5(text) {
  const TAIL_ENDS = [
    'ตัวเลขสามหลัก', 'รางวัลสามตรง', 'เลขหน้าสามตัว', 'เลขท้ายสามตัว',
    'เลขท้ายสองตัว', 'รางวัลข้างเคียง', 'สถิติ', 'ดาวน์โหลด', 'แชร์',
  ];

  const p2 = extractSection(text,
    ['รางวัลที่ 2', 'รางวัลที่2'],
    ['รางวัลที่ 3', 'รางวัลที่3', ...TAIL_ENDS]);

  const p3 = extractSection(text,
    ['รางวัลที่ 3', 'รางวัลที่3'],
    ['รางวัลที่ 4', 'รางวัลที่4', ...TAIL_ENDS]);

  const p4 = extractSection(text,
    ['รางวัลที่ 4', 'รางวัลที่4'],
    ['รางวัลที่ 5', 'รางวัลที่5', ...TAIL_ENDS]);

  const p5 = extractSection(text,
    ['รางวัลที่ 5', 'รางวัลที่5'],
    TAIL_ENDS);

  return {
    prize2: all6digit(p2),
    prize3: all6digit(p3),
    prize4: all6digit(p4),
    prize5: all6digit(p5),
  };
}

function parseDraw(html) {
  const text = stripHtml(html);
  const prize1 = parsePrize1(html, text);
  const { prize2, prize3, prize4, prize5 } = parsePrizes2to5(text);
  return { prize1, prize2, prize3, prize4, prize5 };
}

// ─── LINKS ───────────────────────────────────────────────────────────────────

function parseYearLinks(html, yearBE) {
  const re   = /result-(\d{2})-(\d{2})-(\d{4})\.aspx/gi;
  const seen = new Set();
  const links = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    if (parseInt(m[3]) !== yearBE) continue;
    const filename = `result-${m[1]}-${m[2]}-${m[3]}.aspx`;
    if (!seen.has(filename)) { seen.add(filename); links.push(filename); }
  }
  return links;
}

function linkToDateKey(filename) {
  // result-DD-MM-YYYY.aspx → YYYY-MM-DD (BE year ใช้ sort string ได้)
  const m = filename.match(/result-(\d{2})-(\d{2})-(\d{4})\.aspx/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function sortLinksChronological(links) {
  return [...links].sort((a, b) => {
    const ka = linkToDateKey(a) ?? '';
    const kb = linkToDateKey(b) ?? '';
    return ka.localeCompare(kb);
  });
}

// ─── DATA ────────────────────────────────────────────────────────────────────

function loadData() {
  if (!existsSync(OUT_FILE)) return {};
  try { return JSON.parse(readFileSync(OUT_FILE, 'utf8')); }
  catch { return {}; }
}

function saveData(data) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const data = loadData();
  console.log(`📂 โหลดข้อมูลเดิม: ${Object.keys(data).length} งวด`);
  if (SMOKE) console.log('🔬 smoke mode: ดึง 3 งวดล่าสุดเท่านั้น');

  const years = [];
  for (let y = START_YEAR; y <= END_YEAR; y++) years.push(y);

  let smokeCount   = 0;
  let totalFetched = 0;

  outerLoop: for (const yearBE of (SMOKE ? [END_YEAR] : years)) {
    const yearUrl = `https://myhora.com/lottery/result-${yearBE}.aspx`;
    console.log(`\n📅 ปี ${yearBE}: ${yearUrl}`);

    let yearHtml;
    try {
      const r = await fetchWithRetry(yearUrl);
      if (r.status === 404) { console.log('  → 404 ข้ามปีนี้'); continue; }
      yearHtml = r.text;
    } catch (e) {
      console.log(`  ❌ ดึงปี ${yearBE} ล้มเหลว: ${e.message}`);
      saveData(data);
      console.log('\nโดน limit — รันสคริปต์นี้ใหม่เพื่อดึงต่อจากงวดที่ค้าง');
      process.exit(0);
    }

    const links  = parseYearLinks(yearHtml, yearBE);
    const sorted = sortLinksChronological(links); // เก่า→ใหม่
    // smoke: ใช้ 3 ล่าสุด (reverse เพื่อเริ่มจากใหม่สุด)
    const toFetch = SMOKE ? sorted.slice(-5).reverse() : sorted;
    console.log(`  พบ ${links.length} งวด`);

    for (const link of toFetch) {
      if (SMOKE && smokeCount >= 3) break outerLoop;

      const dateKey = linkToDateKey(link);
      if (!dateKey) continue;

      // resume: ข้ามงวดที่มี prize1 แล้ว
      if (data[dateKey]?.prize1) {
        if (!SMOKE) process.stdout.write(`  ✓ ${dateKey}\r`);
        continue;
      }

      const drawUrl = `https://myhora.com/lottery/${link}`;
      process.stdout.write(`  ⬇ ${dateKey} ... `);

      let drawHtml;
      try {
        const r = await fetchWithRetry(drawUrl);
        if (r.status === 404) { console.log('404 ข้าม'); continue; }
        drawHtml = r.text;
      } catch (e) {
        console.log(`❌ ${e.message}`);
        saveData(data);
        console.log('\nโดน limit — รันสคริปต์นี้ใหม่เพื่อดึงต่อจากงวดที่ค้าง');
        process.exit(0);
      }

      const parsed = parseDraw(drawHtml);

      if (!parsed.prize1) {
        console.log('⚠ parse prize1 ไม่ได้ ข้าม');
        continue;
      }

      const p25total = parsed.prize2.length + parsed.prize3.length
                     + parsed.prize4.length + parsed.prize5.length;
      if (p25total === 0) console.log(`⚠ prize1=${parsed.prize1} (ไม่มีรางวัล 2-5)`);
      else                console.log(`✅ prize1=${parsed.prize1}  p2=${parsed.prize2.length} p3=${parsed.prize3.length} p4=${parsed.prize4.length} p5=${parsed.prize5.length}`);

      data[dateKey] = { date: dateKey, ...parsed };
      saveData(data); // เซฟทันทีหลังสำเร็จ 1 งวด
      totalFetched++;
      smokeCount++;

      await sleep(DELAY_DRAW);
    }

    if (!SMOKE) await sleep(DELAY_YEAR);
  }

  console.log(`\n✅ เสร็จ — รวม ${Object.keys(data).length} งวด (ดึงใหม่ ${totalFetched})`);
  console.log(`📄 → ${OUT_FILE}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
