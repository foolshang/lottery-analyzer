// discord.js — ส่งข้อความเข้า Discord webhook
// Usage: node discord.js predict | node discord.js results
import { db, COL, DOC } from './_db.js';

const WEBHOOK = process.env.DISCORD_WEBHOOK;
if (!WEBHOOK) throw new Error('DISCORD_WEBHOOK env var is not set');

async function send(payload) {
  const res = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Discord ${res.status}: ${txt}`);
  }
}

function avgHits(history) {
  if (!history.length) return '0.00';
  return (history.reduce((s, h) => s + (h.hits || 0), 0) / history.length).toFixed(2);
}

async function sendPredict(stored) {
  const pred = stored.lastPredictions;
  if (!pred || pred.length !== 6) { console.warn('ไม่มีทำนายใน Firestore'); return; }

  const front = pred.slice(0, 3).join('');
  const back  = pred.slice(3, 6).join('');

  await send({
    embeds: [{
      title: '🎱 ทำนายเลขงวดพรุ่งนี้',
      color: 0x1e40af,
      fields: [
        { name: '6 หลัก', value: `# ${front}  ${back}`, inline: false },
      ],
      timestamp: new Date().toISOString(),
    }],
  });
  console.log('✓ Prediction ส่ง Discord แล้ว');
}

async function sendResults(stored) {
  const lr = stored.lastResults;
  if (!lr) { console.warn('ไม่มี lastResults ใน Firestore'); return; }

  const { prizes, cmp, drawDate, prediction } = lr;
  const history = stored.history || [];

  const actual  = prizes.full.join('');
  const predStr = prediction ? prediction.join('') : null;
  const hits    = cmp ? cmp.hits6 : 0;

  const front3Win = cmp?.front3Results?.some(r => r.win);
  const back3Win  = cmp?.back3Results?.some(r => r.win);
  const back2Win  = cmp?.back2Result?.win;

  const f3str = (prizes.front3 || []).join(', ') || '-';
  const b3str = (prizes.back3  || []).join(', ') || '-';
  const b2str = prizes.back2 || '-';

  const color = hits >= 5 ? 0xfbbf24 : hits >= 3 ? 0x16a34a : hits >= 1 ? 0xf59e0b : 0x6b7280;

  const fields = [
    { name: '🏆 รางวัลที่ 1', value: `# ${actual.slice(0,3)}  ${actual.slice(3)}`, inline: false },
    { name: 'หน้า 3', value: f3str, inline: true  },
    { name: 'ท้าย 3', value: b3str, inline: true  },
    { name: 'ท้าย 2', value: b2str, inline: true  },
  ];

  if (predStr) {
    fields.push(
      { name: '🤖 ทำนายไว้', value: `${predStr.slice(0,3)}-${predStr.slice(3)}`, inline: true },
      { name: 'ถูก',         value: `${hits}/6 ตัว`,                             inline: true },
      { name: 'รางวัลย่อย',  value: [
          front3Win ? '✅ หน้า 3' : '❌ หน้า 3',
          back3Win  ? '✅ ท้าย 3' : '❌ ท้าย 3',
          back2Win  ? '✅ ท้าย 2' : '❌ ท้าย 2',
        ].join(' | '), inline: false },
    );
  }

  fields.push({
    name: `📊 สถิติ (${history.length} รอบล่าสุด)`,
    value: `เฉลี่ย **${avgHits(history)}** ตัว/รอบ  (baseline 0.60)`,
    inline: false,
  });

  await send({
    embeds: [{
      title: `📋 ผลหวย งวด ${drawDate || ''}`,
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

  const snap = await db.collection(COL).doc(DOC).get();
  const stored = snap.exists ? snap.data() : {};

  if (mode === 'predict') await sendPredict(stored);
  else                    await sendResults(stored);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
