// discord.js — ส่งข้อความเข้า Discord webhook (Phase E: 4 groups)
// Usage: node discord.js predict | node discord.js results
import { db, COL, DOC } from './_db.js';

const WEBHOOK = process.env.DISCORD_WEBHOOK;
if (!WEBHOOK) throw new Error('DISCORD_WEBHOOK env var is not set');

async function send(payload) {
  const res = await fetch(WEBHOOK, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Discord ${res.status}: ${txt}`);
  }
}

function avgStr(s) {
  if (!s || s.rounds === 0) return '-';
  return (s.totalHits / s.rounds).toFixed(2);
}

async function sendPredict(stored) {
  const pred       = stored.lastPredictions;
  const experiment = stored.experiment;
  if (!pred || pred.length !== 6) { console.warn('ไม่มีทำนายใน Firestore'); return; }

  // ฟอร์แมตเลข 6 ตัว → "front  back"
  const fmt = (arr) => `${arr.slice(0, 3).join('')}  ${arr.slice(3, 6).join('')}`;

  const pending = experiment?.pending;
  const fields  = [];

  // แสดง 3 ชุด A/B/C (อ่านจาก experiment.pending; fallback B ชุดเดียวถ้าข้อมูลเก่า)
  if (pending?.A && pending?.B && pending?.C) {
    fields.push(
      { name: 'A (ไม่ใช้ hints)',  value: `# ${fmt(pending.A)}`, inline: false },
      { name: 'B (หลัก)',          value: `# ${fmt(pending.B)}`, inline: false },
      { name: 'C (hints ≥3 สำนัก)', value: `# ${fmt(pending.C)}`, inline: false },
    );
  } else {
    fields.push({ name: '6 หลัก (กลุ่ม B)', value: `# ${fmt(pred)}`, inline: false });
  }

  // แสดงกลุ่ม D ต่อเมื่อปลดล็อกแล้วเท่านั้น
  const dStatus = experiment?.D?.status || 'silent';
  if (dStatus !== 'silent' && pending?.D) {
    fields.push({ name: '🔓 D (ensemble)', value: `**${fmt(pending.D)}**`, inline: false });
  }

  if (experiment) {
    const n = experiment.B?.rounds || 0;
    if (n > 0) {
      fields.push({
        name:  `📊 สถิติ ${n} งวด`,
        value: `A: ${avgStr(experiment.A)} | B: ${avgStr(experiment.B)} | C: ${avgStr(experiment.C)} | D: ${avgStr(experiment.D)} | baseline 0.60`,
        inline: false,
      });
    }
  }

  await send({
    embeds: [{
      title:     '🎱 ทำนายเลขงวดพรุ่งนี้',
      color:     0x1e40af,
      fields,
      timestamp: new Date().toISOString(),
    }],
  });
  console.log('✓ Prediction ส่ง Discord แล้ว');
}

async function sendResults(stored) {
  const lr = stored.lastResults;
  if (!lr) { console.warn('ไม่มี lastResults ใน Firestore'); return; }

  const { prizes, cmp, drawDate, prediction } = lr;
  const history    = stored.history    || [];
  const experiment = stored.experiment || {};

  const actual  = prizes.full.join('');
  const predStr = prediction ? prediction.join('') : null;
  const hits    = cmp ? cmp.hits6 : 0;

  const front3Win = cmp?.front3Results?.some((r) => r.win);
  const back3Win  = cmp?.back3Results?.some((r) => r.win);
  const back2Win  = cmp?.back2Result?.win;

  const f3str = (prizes.front3 || []).join(', ') || '-';
  const b3str = (prizes.back3  || []).join(', ') || '-';
  const b2str = prizes.back2 || '-';

  const color = hits >= 5 ? 0xfbbf24 : hits >= 3 ? 0x16a34a : hits >= 1 ? 0xf59e0b : 0x6b7280;

  const fields = [
    { name: '🏆 รางวัลที่ 1', value: `# ${actual.slice(0, 3)}  ${actual.slice(3)}`, inline: false },
    { name: 'หน้า 3', value: f3str, inline: true },
    { name: 'ท้าย 3', value: b3str, inline: true },
    { name: 'ท้าย 2', value: b2str, inline: true },
  ];

  if (predStr) {
    fields.push(
      { name: '🤖 ทำนายไว้ (B)', value: `${predStr.slice(0, 3)}-${predStr.slice(3)}`, inline: true },
      { name: 'ถูก',              value: `${hits}/6 ตัว`,                              inline: true },
      {
        name:   'รางวัลย่อย',
        value:  [
          front3Win ? '✅ หน้า 3' : '❌ หน้า 3',
          back3Win  ? '✅ ท้าย 3' : '❌ ท้าย 3',
          back2Win  ? '✅ ท้าย 2' : '❌ ท้าย 2',
        ].join(' | '),
        inline: false,
      },
    );
  }

  // Phase E: สถิติเทียบกลุ่ม
  const nRounds = experiment.B?.rounds || 0;
  if (nRounds > 0) {
    // ดึง hits งวดนี้ จาก experiment history รายการล่าสุด
    const lastExp = (experiment.history || []).slice(-1)[0];
    const lineA = lastExp ? `A: ${lastExp.hitsA}/6` : `A: -`;
    const lineB = lastExp ? `B: ${lastExp.hitsB}/6` : `B: -`;
    const lineC = lastExp ? `C: ${lastExp.hitsC}/6` : `C: -`;
    const lineD = lastExp ? `D: ${lastExp.hitsD}/6` : `D: -`;

    fields.push({
      name:   `🔬 การทดลอง (${nRounds} งวด)`,
      value:  [
        `งวดนี้ — ${lineA} | ${lineB} | ${lineC} | ${lineD}`,
        `สะสม — A: **${avgStr(experiment.A)}** | B: **${avgStr(experiment.B)}** | C: **${avgStr(experiment.C)}** | D: **${avgStr(experiment.D)}**`,
        `baseline 0.60${experiment.D?.status === 'unlocked' ? ' | 🔓 D ปลดล็อกแล้ว' : ''}`,
      ].join('\n'),
      inline: false,
    });
  } else {
    const avg = history.length > 0
      ? (history.reduce((s, h) => s + (h.hits || 0), 0) / history.length).toFixed(2)
      : '0.00';
    fields.push({
      name:   `📊 สถิติ (${history.length} รอบ)`,
      value:  `เฉลี่ย **${avg}** ตัว/รอบ  (baseline 0.60)`,
      inline: false,
    });
  }

  await send({
    embeds: [{
      title:     `📋 ผลหวย งวด ${drawDate || ''}`,
      color,
      fields,
      timestamp: new Date().toISOString(),
    }],
  });
  console.log('✓ Results ส่ง Discord แล้ว');
}

async function main() {
  const mode = process.argv[2];
  if (mode !== 'predict' && mode !== 'results') {
    console.error('Usage: node discord.js predict | node discord.js results');
    process.exit(1);
  }
  const snap   = await db.collection(COL).doc(DOC).get();
  const stored = snap.exists ? snap.data() : {};
  if (mode === 'predict') await sendPredict(stored);
  else                    await sendResults(stored);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
