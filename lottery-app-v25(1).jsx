// ============================================================
// Lottery Analyzer — Version 25
// ============================================================
// CHANGELOG v25:
//   + เพิ่ม: Real-time sync ระหว่างเครื่อง (onSnapshot listener)
//   ~ แก้: saveAll ใช้ merge:true เพื่อไม่ลบ field ที่ไม่ได้ส่ง
//   ~ แก้: applySnapshot — partial data ไม่ทับ state ที่มีอยู่ + รองรับ null
//   ~ แก้: ป้องกัน loop เมื่อ listener trigger save ทับตัวเอง
//   ~ แก้: lockHintAt / unlockAll / removeLockedHint — เรียก saveAll() ทันที
//          (เก่า: ล็อกแล้วไม่ save → ปิดเว็บแล้วล็อกหาย)
// ============================================================

import { useState, useCallback, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot, collection, addDoc, getDocs, orderBy, query, serverTimestamp } from "firebase/firestore";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "firebase/auth";

const firebaseConfig = {
  apiKey:            "AIzaSyBI4Fg5Sh7vt3X2TINBy6vEnYYWQV2KV8Q",
  authDomain:        "lottary-d8ebd.firebaseapp.com",
  projectId:         "lottary-d8ebd",
  storageBucket:     "lottary-d8ebd.firebasestorage.app",
  messagingSenderId: "6424789017",
  appId:             "1:6424789017:web:aba84dd2960e5ede432a88",
};

let app, db, auth;
let firebaseReady = false;
try {
  app  = initializeApp(firebaseConfig);
  db   = getFirestore(app);
  auth = getAuth(app);
  firebaseReady = true;
} catch (_) {}

const DOC_ID    = "shared_data";
const LOCAL_KEY = "lottery_v7";
const LEARN_RATE = 2;
const MAX_W      = 20;

const P = {
  bg: "#08080f", card: "#10101a", border: "#1e1e30",
  accent: "#f0c040", green: "#4ade80", blue: "#60a5fa",
  purple: "#c084fc", red: "#f87171", orange: "#fb923c",
  cyan: "#22d3ee", text: "#e8e8f0", muted: "#55556a",
};

/* ── helpers ── */
function extractDigits(str) {
  return String(str).replace(/[^0-9]/g, "").split("").map(Number);
}
// กรองเฉพาะตัวเลขและ space (สำหรับ input ที่มีหลายตัว)
function filterDigitsSpace(str) {
  return String(str).replace(/[^0-9 ]/g, "");
}
// กรองเฉพาะตัวเลข + space + newline (สำหรับ textarea)
function filterDigitsSpaceNewline(str) {
  return String(str).replace(/[^0-9 \r\n]/g, "");
}
function parseLine(line) {
  const clean = line.trim();
  if (!clean) return null;
  const d = clean.replace(/[^0-9]/g, "").split("").map(Number);
  return d.length >= 6 ? d.slice(0, 6) : null;
}
function parseAll(raw) {
  if (!raw.trim()) return [];
  return raw.trim().split(/\r?\n+/).map(parseLine).filter(Boolean);
}
function parseSheetRows(wb) {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const result = [];
  for (const row of rows) {
    const ne = row.filter((c) => String(c).trim() !== "");
    if (!ne.length) continue;
    const d = ne.flatMap((c) => String(c).trim().replace(/[^0-9]/g, "").split("").map(Number));
    if (d.length >= 6) result.push(d.slice(0, 6).join(" "));
  }
  return result;
}
function initWeights() {
  return Array.from({ length: 6 }, () => {
    const w = {}; for (let d = 0; d <= 9; d++) w[d] = 0; return w;
  });
}
function buildFreq(rows, start) {
  const f = {}; for (let d = 0; d <= 9; d++) f[d] = 0;
  rows.forEach((r) => { for (let i = start; i < start + 3; i++) f[r[i]]++; });
  return f;
}
function buildPosFreq(rows, start) {
  const p = Array.from({ length: 3 }, () => { const o = {}; for (let d = 0; d <= 9; d++) o[d] = 0; return o; });
  rows.forEach((r) => { for (let i = 0; i < 3; i++) p[i][r[start + i]]++; });
  return p;
}
/**
 * boost pf ของฝั่งหนึ่ง (pf คือ array 3 ตำแหน่ง — 0,1,2)
 * hints: array ของ { digits: [...], offsetPositions: [...] }
 *   - offsetPositions = array ของ index ใน pf ที่จะ boost (0..2)
 *   - digits.length ต้องเท่ากับ offsetPositions.length
 */
function boostPosFreq(pf, hints) {
  const b = pf.map((x) => ({ ...x }));
  hints.forEach(({ digits, offsetPositions }) => {
    digits.forEach((d, i) => {
      const pos = offsetPositions[i];
      if (pos >= 0 && pos < 3) b[pos][d] = (b[pos][d] || 0) + 3;
    });
  });
  return b;
}
function pickHalf(pf, lw) {
  return [0, 1, 2].map((p) => {
    const c = {}; for (let d = 0; d <= 9; d++) c[d] = Math.max(0.1, (pf[p][d] || 0) + (lw[p][d] || 0));
    const t = Object.values(c).reduce((s, v) => s + v, 0);
    let r = Math.random() * t;
    for (let d = 0; d <= 9; d++) { r -= c[d]; if (r <= 0) return d; }
    return 0;
  });
}
/**
 * analyze
 * hintsFront: array of { digits, offsetPositions } — boost ฝั่งหน้า (pos 0-2)
 * hintsBack:  array of { digits, offsetPositions } — boost ฝั่งหลัง (pos 0-2 ของฝั่งหลัง = ตำแหน่งจริง 3-5)
 */
function analyze(rows, hintsFront, hintsBack, lw) {
  const freqF = buildFreq(rows, 0), freqB = buildFreq(rows, 3);
  const posF  = buildPosFreq(rows, 0), posB  = buildPosFreq(rows, 3);
  const useFront = boostPosFreq(posF, hintsFront);
  const useBack  = boostPosFreq(posB, hintsBack);

  return {
    front: pickHalf(useFront, lw.slice(0, 3)),
    back:  pickHalf(useBack, lw.slice(3, 6)),
    freqF, freqB, posF, posB, total: rows.length,
  };
}
function adjustWeights(w, pred, actual) {
  const n = w.map((x) => ({ ...x }));
  for (let i = 0; i < 6; i++) {
    if (pred[i] === actual[i]) {
      n[i][pred[i]] = Math.min(MAX_W, (n[i][pred[i]] || 0) + LEARN_RATE);
    } else {
      n[i][pred[i]] = Math.max(-MAX_W, (n[i][pred[i]] || 0) - LEARN_RATE);
      n[i][actual[i]] = Math.min(MAX_W, (n[i][actual[i]] || 0) + LEARN_RATE);
    }
  }
  return n;
}

/* ── Chi-square test for digit uniformity ──
   H0: เลขแต่ละตัว (0-9) ออกในแต่ละตำแหน่งด้วยความน่าจะเป็นเท่ากัน (10%)
   ถ้า p-value > 0.05 → ยอมรับ H0 (เป็นการสุ่ม)
   ถ้า p-value < 0.05 → ปฏิเสธ H0 (ไม่สุ่ม)
*/
function chiSquareDigits(rows) {
  if (rows.length < 30) return null;
  const positions = [];
  for (let pos = 0; pos < 6; pos++) {
    const observed = Array(10).fill(0);
    rows.forEach((r) => { if (r[pos] !== undefined) observed[r[pos]]++; });
    const expected = rows.length / 10;
    let chi2 = 0;
    for (let d = 0; d < 10; d++) {
      const diff = observed[d] - expected;
      chi2 += (diff * diff) / expected;
    }
    // df = 9, critical values: 16.92 (p=0.05), 21.67 (p=0.01)
    const random = chi2 < 16.92;
    positions.push({ pos: pos + 1, chi2: chi2.toFixed(2), random, observed });
  }
  // เฉลี่ยทั้ง 6 ตำแหน่ง
  const avgChi2 = positions.reduce((s, p) => s + parseFloat(p.chi2), 0) / 6;
  const allRandom = positions.every((p) => p.random);
  return { positions, avgChi2: avgChi2.toFixed(2), allRandom };
}

function buildComparison(pred, prizes) {
  const cmp = pred.map((p, i) => ({ pos: i + 1, pred: p, real: prizes.full[i], hit: p === prizes.full[i] }));
  const hits6 = cmp.filter((c) => c.hit).length;

  const front3Results = prizes.front3.map((f3) => ({
    digits: f3,
    hits: [0, 1, 2].filter((i) => pred[i] === f3[i]).length,
    win: [0, 1, 2].every((i) => pred[i] === f3[i]),
  }));

  const back3Results = prizes.back3.map((b3) => ({
    digits: b3,
    hits: [0, 1, 2].filter((i) => pred[i + 3] === b3[i]).length,
    win: [0, 1, 2].every((i) => pred[i + 3] === b3[i]),
  }));

  const back2Result = prizes.back2.length === 2 ? {
    digits: prizes.back2,
    hits: [0, 1].filter((i) => pred[i + 4] === prizes.back2[i]).length,
    win: [0, 1].every((i) => pred[i + 4] === prizes.back2[i]),
  } : null;

  return { cmp, hits6, front3Results, back3Results, back2Result };
}

/* ── UI components ── */
const Bar = ({ value, max, color }) => (
  <div style={{ background: P.border, borderRadius: 3, height: 6, width: "100%", overflow: "hidden" }}>
    <div style={{ width: max > 0 ? `${Math.max(0, value/max)*100}%` : "0%", height: "100%", background: color, borderRadius: 3, transition: "width .5s" }} />
  </div>
);

function Ball({ n, color, size=52, glow }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: `radial-gradient(circle at 35% 35%, ${color}cc, ${color}55)`,
      border: `2px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "monospace", fontWeight: 900, fontSize: size*.4, color: "#fff",
      boxShadow: glow ? `0 0 18px ${color}88` : "none" }}>{n}</div>
  );
}

function SmallBall({ n, highlight, color }) {
  return (
    <div style={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
      background: highlight ? `radial-gradient(circle at 35% 35%, ${color}cc, ${color}44)` : "transparent",
      border: `1.5px solid ${highlight ? color : P.border}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "monospace", fontWeight: 800, fontSize: 11,
      color: highlight ? "#fff" : P.muted }}>{n}</div>
  );
}

function MiniDot({ n, color, filled }) {
  return (
    <div style={{ width: 28, height: 28, borderRadius: "50%",
      background: filled ? `radial-gradient(circle at 35% 35%, ${color}cc, ${color}55)` : "transparent",
      border: `1.5px solid ${filled ? color : P.border}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "monospace", fontWeight: 900, fontSize: 12,
      color: filled ? "#fff" : P.muted, flexShrink: 0 }}>{filled ? n : "·"}</div>
  );
}

function HintRow({ idx, front, back, onChangeFront, onChangeBack, onRemove, onLock, onEnter, dupFront, dupBack }) {
  const fd = extractDigits(front).slice(0, 3);
  const bd = extractDigits(back).slice(0, 3);
  const hasData = fd.length > 0 || bd.length > 0;
  const isDup = dupFront || dupBack;

  const handleKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onEnter && onEnter();
    }
  };

  return (
    <div style={{
      background: isDup ? P.red+"11" : P.bg,
      border: `1px solid ${isDup ? P.red : P.border}`,
      borderRadius: 10, padding: "12px 14px", marginBottom: 8,
      transition: "all .2s"
    }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: isDup ? P.red : P.muted, fontWeight: 700 }}>ชุดที่ {idx+1}</span>
        <span style={{ fontSize: 10, color: P.muted, marginLeft: 10 }}>(หน้า, หลัง, หรือทั้งสอง)</span>
        <button onClick={onRemove} title="ลบชุดนี้" style={{ marginLeft: "auto", background: "transparent", border: "none", color: P.muted, cursor: "pointer", fontSize: 15 }}>✕</button>
      </div>

      <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: dupFront ? P.red : P.accent, marginBottom: 4, textAlign: "center", letterSpacing: 1 }}>
            3 ตัวหน้า{dupFront && " ⚠ ซ้ำ"}
          </div>
          <input value={front} onChange={(e) => onChangeFront(filterDigitsSpace(e.target.value))} inputMode="numeric" onKeyDown={handleKey} placeholder="1 2 3" maxLength={5}
            style={{ width: "100%", boxSizing: "border-box",
              background: P.card,
              border: `1px solid ${dupFront ? P.red : P.accent}44`,
              borderRadius: "7px 0 0 7px", borderRight: "none",
              padding: "8px 10px", color: dupFront ? P.red : P.accent,
              fontFamily: "monospace", fontSize: 16, fontWeight: 800,
              letterSpacing: 3, outline: "none", textAlign: "center" }} />
          <div style={{ display: "flex", gap: 4, marginTop: 6, justifyContent: "center" }}>
            {[0,1,2].map((p) => {
              const offset = 3 - fd.length;
              const dIdx = p - offset;
              const digit = (dIdx >= 0 && dIdx < fd.length) ? fd[dIdx] : undefined;
              return <MiniDot key={p} n={digit} color={dupFront ? P.red : P.accent} filled={digit !== undefined} />;
            })}
          </div>
        </div>

        <div style={{ width: 2, background: P.border, alignSelf: "stretch", marginTop: 18 }} />

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: dupBack ? P.red : P.purple, marginBottom: 4, textAlign: "center", letterSpacing: 1 }}>
            3 ตัวหลัง{dupBack && " ⚠ ซ้ำ"}
          </div>
          <input id={`hint-back-${idx}`} value={back} onChange={(e) => onChangeBack(filterDigitsSpace(e.target.value))} inputMode="numeric" onKeyDown={handleKey} placeholder="4 5 6" maxLength={5}
            style={{ width: "100%", boxSizing: "border-box",
              background: P.card,
              border: `1px solid ${dupBack ? P.red : P.purple}44`,
              borderRadius: "0 7px 7px 0", borderLeft: "none",
              padding: "8px 10px", color: dupBack ? P.red : P.purple,
              fontFamily: "monospace", fontSize: 16, fontWeight: 800,
              letterSpacing: 3, outline: "none", textAlign: "center" }} />
          <div style={{ display: "flex", gap: 4, marginTop: 6, justifyContent: "center" }}>
            {[0,1,2].map((p) => {
              const offset = 3 - bd.length;
              const dIdx = p - offset;
              const digit = (dIdx >= 0 && dIdx < bd.length) ? bd[dIdx] : undefined;
              return <MiniDot key={p} n={digit} color={dupBack ? P.red : P.purple} filled={digit !== undefined} />;
            })}
          </div>
        </div>
      </div>

      {/* แถวล่าง: สถานะ + ปุ่มล็อก */}
      <div style={{ marginTop:10, display:"flex", alignItems:"center", gap:8 }}>
        <div style={{ fontSize:10, color:P.muted, flex:1 }}>
          {!hasData && <span>ยังไม่ได้ใส่</span>}
          {hasData && (
            <span style={{ color:P.muted }}>
              → ใช้ {[
                fd.length > 0 && `หน้า ${fd.length}`,
                bd.length > 0 && `หลัง ${bd.length}`,
              ].filter(Boolean).join(", ")}
            </span>
          )}
        </div>
        <button onClick={onLock} disabled={!hasData} title={hasData ? "ล็อกชุดนี้" : "ใส่ข้อมูลก่อน"}
          style={{
            background: hasData ? P.accent+"22" : "transparent",
            color: hasData ? P.accent : P.muted,
            border:`1px solid ${hasData ? P.accent+"55" : P.border}`,
            borderRadius:7, padding:"6px 12px",
            fontWeight:700, fontSize:13,
            cursor: hasData ? "pointer" : "not-allowed",
            display:"flex", alignItems:"center", gap:4
          }}>
          🔒 ล็อก
        </button>
      </div>
    </div>
  );
}

function PrizeInput({ id, label, color, value, onChange, maxLen, placeholder, slots, onEnter }) {
  const digits = extractDigits(value).slice(0, maxLen);
  const handleKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // เลื่อนเฉพาะกรอกครบ
      if (digits.length === maxLen && onEnter) onEnter();
    }
  };
  return (
    <div style={{ background: P.bg, border: `1px solid ${color}33`, borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
      <div style={{ fontSize: 10, color, fontWeight: 700, marginBottom: 7, letterSpacing: 1 }}>{label}</div>
      <input id={id} value={value} onChange={(e) => onChange(filterDigitsSpace(e.target.value))} inputMode="numeric" onKeyDown={handleKey} placeholder={placeholder} maxLength={maxLen + 2}
        style={{ width: "100%", boxSizing: "border-box", background: P.card, border: `1px solid ${color}44`, borderRadius: 7, padding: "8px 12px", color, fontFamily: "monospace", fontSize: 17, fontWeight: 800, letterSpacing: 3, outline: "none" }} />
      <div style={{ display: "flex", gap: 5, marginTop: 8 }}>
        {Array.from({ length: slots }).map((_, i) => (
          <MiniDot key={i} n={digits[i]} color={color} filled={digits[i] !== undefined} />
        ))}
      </div>
    </div>
  );
}

function PrizeResult({ label, color, win, hits, total, digits, pred, positions }) {
  return (
    <div style={{ background: P.bg, border: `1px solid ${win ? color : P.border}44`, borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, color, fontWeight: 700 }}>{label}</span>
        <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 900, color: win ? color : P.muted }}>
          {win ? "✓ ถูก!" : "✗ ไม่ถูก"}
        </span>
        <span style={{ fontSize: 12, color: P.muted }}>{hits}/{total}</span>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {positions.map((pos, i) => {
          const predVal = pred[pos];
          const realVal = digits[i];
          const hit = predVal === realVal;
          return (
            <div key={i} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 9, color: P.muted, marginBottom: 3 }}>ตำแหน่ง {pos+1}</div>
              <div style={{ width: 36, height: 36, borderRadius: "50%",
                background: hit ? `radial-gradient(circle at 35% 35%, ${color}cc, ${color}55)` : P.red+"22",
                border: `2px solid ${hit ? color : P.red}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "monospace", fontWeight: 900, fontSize: 14,
                color: hit ? "#fff" : P.red }}>
                {realVal !== undefined ? realVal : "?"}
              </div>
              <div style={{ fontSize: 9, color: P.muted, marginTop: 2 }}>ทาย:{predVal}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SyncBadge({ status }) {
  const map = {
    synced:  { color: P.green,  icon: "☁", text: "Sync แล้ว" },
    syncing: { color: P.blue,   icon: "↻", text: "กำลัง Sync..." },
    offline: { color: P.muted,  icon: "○", text: "Offline" },
    error:   { color: P.red,    icon: "!", text: "Sync ผิดพลาด" },
  };
  const s = map[status] || map.offline;
  return (
    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10,
      background: s.color+"22", color: s.color, border: `1px solid ${s.color}44` }}>
      {s.icon} {s.text}
    </span>
  );
}

/* ── App ── */
export default function App() {
  const importRef = useRef(null);

  const [histRaw, setHistRaw] = useState("");
  const [newLine, setNewLine] = useState("");
  const [hints,   setHints]   = useState([{ front: "", back: "" }]);
  const [lockedHints, setLockedHints] = useState([]);  // ชุดที่ถูกล็อกไว้
  // Learning น้ำหนัก (โหมดเดียว)
  const [weights, setWeights] = useState(initWeights());
  const [history, setHistory] = useState([]);

  const [results,   setResults]   = useState(null);
  const [lastPreds, setLastPreds] = useState(null);
  const [comparison, setComparison] = useState(null);

  const [prizeFull,   setPrizeFull]   = useState("");
  const [prizeFront3, setPrizeFront3] = useState(["", ""]);
  const [prizeBack3,  setPrizeBack3]  = useState(["", ""]);
  const [prizeBack2,  setPrizeBack2]  = useState("");

  const [tab,        setTab]        = useState("data");
  const [animKey,    setAnimKey]    = useState(0);
  const [error,      setError]      = useState("");
  const [addError,   setAddError]   = useState("");
  const [saveMsg,    setSaveMsg]    = useState("");
  const [syncStatus, setSyncStatus] = useState("offline");
  const [showGraph,  setShowGraph]  = useState(false);
  const [showLog,    setShowLog]    = useState(false);
  const [graphType,  setGraphType]  = useState("full");
  const [showChiSquare, setShowChiSquare] = useState(false);
  const [dupHighlight, setDupHighlight] = useState({ left: new Set(), lockedSide: {} });

  const getSnapshot = useCallback(() => ({
    data: histRaw, hints, lockedHints, weights, history,
    lastPredictions: lastPreds,
    lastResults: results,
    updatedAt: new Date().toISOString(),
  }), [histRaw, hints, lockedHints, weights, history, lastPreds, results]);

  // ใช้ ref เก็บเวลา save ล่าสุด เพื่อไม่ apply snapshot ของตัวเองที่เพิ่ง write ไป
  const lastSaveAt = useRef(0);

  const applySnapshot = (snap, opts = {}) => {
    if (!snap) return;
    const { fromRemote = false } = opts;

    // ถ้ามาจาก remote และเพิ่ง save ภายใน 2 วินาที — ข้าม (กัน loop)
    if (fromRemote && Date.now() - lastSaveAt.current < 2000) return;

    if (snap.data    !== undefined) setHistRaw(snap.data);
    if (snap.hints   !== undefined) setHints(snap.hints);
    if (snap.lockedHints !== undefined) setLockedHints(snap.lockedHints);
    // รองรับข้อมูลเก่าจาก v22 ที่มี weightsAll
    if (snap.weights !== undefined) setWeights(snap.weights);
    else if (snap.weightsAll !== undefined && snap.weightsAll.normal) {
      setWeights(snap.weightsAll.normal);
    }
    if (snap.history !== undefined) setHistory(snap.history);

    // จัดการ lastPredictions แบบ explicit — ครอบคลุม null ด้วย
    if ("lastPredictions" in snap) {
      if (snap.lastPredictions === null) {
        // ยืนยันผลแล้ว — ล้าง prediction ทั้งหมด
        setLastPreds(null); setResults(null); setComparison(null);
      } else {
        // รองรับข้อมูลเก่า v22 ที่ lastPredictions เป็น { normal, no_hints, hints_only }
        const pred = Array.isArray(snap.lastPredictions) ? snap.lastPredictions : snap.lastPredictions.normal;
        if (pred) {
          setLastPreds(pred);
          if (snap.lastResults) {
            const res = snap.lastResults.normal || snap.lastResults;
            setResults(res);
            // ถ้ามาจาก remote ไม่ต้องสลับ tab อัตโนมัติ
            if (!fromRemote) setTab("result");
          }
        }
      }
    }
  };

  useEffect(() => {
    try { const s = localStorage.getItem(LOCAL_KEY); if (s) applySnapshot(JSON.parse(s)); } catch (_) {}
  }, []);

  useEffect(() => {
    if (!firebaseReady) return;
    setSyncStatus("syncing");
    signInWithPopup(auth, new GoogleAuthProvider()).catch(() => setSyncStatus("error"));

    let unsubSnap = null;
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubSnap) { unsubSnap(); unsubSnap = null; }
      if (!user) return;
      const ref = doc(db, "lottery", DOC_ID);
      unsubSnap = onSnapshot(ref, (snap) => {
        if (snap.exists()) { applySnapshot(snap.data(), { fromRemote: true }); setSyncStatus("synced"); }
        else setSyncStatus("synced");
      }, () => setSyncStatus("error"));
    });
    return () => {
      if (unsubSnap) unsubSnap();
      unsubAuth();
    };
  }, []);

  const saveAll = useCallback(async (override = {}) => {
    const snap = { ...getSnapshot(), ...override };
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(snap)); } catch (_) {}
    if (firebaseReady && db) {
      setSyncStatus("syncing");
      lastSaveAt.current = Date.now();  // mark ก่อน write (กัน loop เมื่อ onSnapshot fire กลับมา)
      try {
        // ใช้ merge:true เพื่อไม่ลบ field ที่ไม่ได้ส่ง (เช่น subcollection meta)
        await setDoc(doc(db, "lottery", DOC_ID), snap, { merge: true });
        setSyncStatus("synced");
        setSaveMsg("✓ บันทึกและ Sync แล้ว"); setTimeout(() => setSaveMsg(""), 2500);
      }
      catch (_) {
        setSyncStatus("error");
        setSaveMsg("⚠ Sync ผิดพลาด"); setTimeout(() => setSaveMsg(""), 2500);
      }
    } else {
      setSaveMsg("✓ บันทึกแล้ว (Local)"); setTimeout(() => setSaveMsg(""), 2500);
    }
  }, [getSnapshot]);

  // บันทึก log แต่ละรอบลง Firestore subcollection
  const saveLogToFirestore = async (logData) => {
    if (!firebaseReady || !db) return;
    try {
      await addDoc(collection(db, "lottery", DOC_ID, "logs"), {
        ...logData,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("บันทึก log ไม่สำเร็จ:", e);
    }
  };

  // ดึง log ทั้งหมดจาก Firestore (สำหรับ export)
  const fetchAllLogs = async () => {
    if (!firebaseReady || !db) return [];
    try {
      const q = query(collection(db, "lottery", DOC_ID, "logs"), orderBy("createdAt", "asc"));
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data());
    } catch (e) {
      console.error("ดึง log ไม่สำเร็จ:", e);
      return [];
    }
  };

  const processLines = (lines) => {
    if (!lines.length) { setSaveMsg("ไม่พบข้อมูลที่ถูกต้อง"); return; }
    setHistRaw((prev) => prev.trim() ? prev.trim() + "\n" + lines.join("\n") : lines.join("\n"));
    setSaveMsg(`นำเข้า ${lines.length} งวดสำเร็จ`); setTimeout(() => setSaveMsg(""), 2500);
  };

  const handleImport = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      const r = new FileReader();
      r.onload = (ev) => {
        try { processLines(parseSheetRows(XLSX.read(new Uint8Array(ev.target.result), { type: "array" }))); }
        catch (_) { setSaveMsg("อ่านไฟล์ไม่ได้"); }
      };
      r.readAsArrayBuffer(file);
    } else {
      const r = new FileReader();
      r.onload = (ev) => {
        processLines(ev.target.result.split(/\r?\n+/).map((l) => {
          const d = l.trim().replace(/[^0-9]/g, "").split("").map(Number);
          return d.length >= 6 ? d.slice(0, 6).join(" ") : null;
        }).filter(Boolean));
      };
      r.readAsText(file);
    }
    e.target.value = "";
  };

  const handleExportTxt = () => {
    const blob = new Blob([histRaw], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "lottery_data.txt"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const handleExportXlsx = () => {
    const rows = parseAll(histRaw);
    const data = rows.map((r) => ({ A:r[0],B:r[1],C:r[2],D:r[3],E:r[4],F:r[5] }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "ข้อมูล");
    XLSX.writeFile(wb, "lottery_data.xlsx");
  };

  const rows = parseAll(histRaw);

  const handleAddLine = () => {
    setAddError(""); if (!newLine.trim()) return;
    const d = extractDigits(newLine);
    if (d.length < 6) { setAddError("ต้องมี 6 ตัวเลข"); return; }
    setHistRaw((p) => p.trim() ? p.trim()+"\n"+d.slice(0,6).join(" ") : d.slice(0,6).join(" "));
    setNewLine("");
  };

  const addHint    = () => setHints((h) => [...h, { front:"", back:"" }]);
  const removeHint = (i) => setHints((h) => h.filter((_,j) => j!==i));
  const updateHint = (i,f,v) => setHints((h) => h.map((x,j) => j===i ? {...x,[f]:v} : x));

  // กด Enter ในชุดที่ idx → เพิ่มชุดใหม่ + cursor focus ที่ช่อง "3 หลัง" ของชุดใหม่
  const handleHintEnter = (idx) => {
    setHints((prev) => {
      if (idx === prev.length - 1) {
        return [...prev, { front:"", back:"" }];
      }
      return prev;
    });
    setTimeout(() => {
      const nextInput = document.getElementById(`hint-back-${idx+1}`);
      if (nextInput) nextInput.focus();
    }, 50);
  };

  // เช็คซ้ำในรายการ hints
  // นิยามซ้ำ: ความยาวเท่ากัน + เลขเหมือนกัน + ตำแหน่งเหมือนกัน
  const findDuplicates = (list1, list2 = []) => {
    const dups = [];
    const checkPair = (a, b, aIdx, bIdx, isSame) => {
      if (isSame && aIdx >= bIdx) return;
      const aF = extractDigits(a.front).slice(0,3);
      const aB = extractDigits(a.back).slice(0,3);
      const bF = extractDigits(b.front).slice(0,3);
      const bB = extractDigits(b.back).slice(0,3);
      // เช็คหน้าซ้ำ
      if (aF.length > 0 && aF.length === bF.length && aF.every((v,i) => v === bF[i])) {
        dups.push({ aIdx, bIdx, side: "front", digits: aF.join("") });
      }
      // เช็คหลังซ้ำ
      if (aB.length > 0 && aB.length === bB.length && aB.every((v,i) => v === bB[i])) {
        dups.push({ aIdx, bIdx, side: "back", digits: aB.join("") });
      }
    };
    const isSame = list1 === list2;
    list1.forEach((a, i) => {
      list2.forEach((b, j) => checkPair(a, b, i, j, isSame));
    });
    return dups;
  };

  // เช็คว่าชุดใดบ้างที่มี dup (เพื่อ highlight)
  const getDupFlags = (dups, count, side) => {
    // คืน Set ของ index ที่ซ้ำในด้านนั้น (เฉพาะใน list ที่กำลังโชว์)
    const set = new Set();
    dups.forEach((d) => {
      if (d.side === side) {
        set.add(d.aIdx);
        set.add(d.bIdx);
      }
    });
    return set;
  };

  // ล็อกชุดเดียว (ตามดัชนี)
  const lockHintAt = (idx) => {
    const target = hints[idx];
    if (!target) return;
    const fd = extractDigits(target.front).slice(0,3);
    const bd = extractDigits(target.back).slice(0,3);
    if (fd.length === 0 && bd.length === 0) return;

    // เช็คซ้ำกับฝั่งขวา — ความยาวเท่ากัน + เลขเหมือนกัน (แยกช่อง ไม่ข้ามช่อง)
    const dups = [];
    if (fd.length > 0) {
      lockedHints.forEach((lh, j) => {
        const lf = extractDigits(lh.front).slice(0,3);
        if (lf.length === fd.length && lf.every((v,i) => v === fd[i])) {
          dups.push({ side: "front", digits: fd.join(""), lockedIdx: j });
        }
      });
    }
    if (bd.length > 0) {
      lockedHints.forEach((lh, j) => {
        const lb = extractDigits(lh.back).slice(0,3);
        if (lb.length === bd.length && lb.every((v,i) => v === bd[i])) {
          dups.push({ side: "back", digits: bd.join(""), lockedIdx: j });
        }
      });
    }
    if (dups.length > 0) {
      const sideName = (s) => s === "front" ? "หน้า" : "หลัง";
      const lines = dups.map((d) => `• ชุดที่ ${idx+1} ซ้ำกับชุดที่ล็อก #${d.lockedIdx+1} (${sideName(d.side)} = ${d.digits})`);
      setError(`⚠ พบข้อมูลซ้ำ ${dups.length} จุด — แก้ก่อนล็อก:\n${lines.join("\n")}`);
      setDupHighlight({ left: new Set([idx]), lockedSide: dups.reduce((acc,d)=>{ acc[d.lockedIdx]=d.side; return acc; }, {}) });
      setTimeout(() => setError(""), 6000);
      return;
    }

    const newLocked = [...lockedHints, target];
    const newHints = hints.filter((_, j) => j !== idx);
    setLockedHints(newLocked);
    setHints(newHints.length === 0 ? [{ front:"", back:"" }] : newHints);
    setSaveMsg("🔒 ล็อกแล้ว"); setTimeout(() => setSaveMsg(""), 2000);
    setDupHighlight({ left: new Set(), lockedSide: {} });
    // Save ทันทีให้ sync ข้ามเครื่อง
    saveAll({ lockedHints: newLocked, hints: newHints.length === 0 ? [{ front:"", back:"" }] : newHints });
  };

  // ปลดล็อกทั้งหมด (ลบฝั่งขวา)
  const unlockAll = () => {
    if (lockedHints.length === 0) return;
    setLockedHints([]);
    setSaveMsg("🔓 ปลดล็อกแล้ว"); setTimeout(() => setSaveMsg(""), 2000);
    saveAll({ lockedHints: [] });
  };

  // ลบชุดล็อกเฉพาะชุด
  const removeLockedHint = (idx) => {
    const newLocked = lockedHints.filter((_, j) => j !== idx);
    setLockedHints(newLocked);
    setSaveMsg("🔓 ปลดล็อกชุดที่ "+(idx+1)+" แล้ว"); setTimeout(() => setSaveMsg(""), 2000);
    saveAll({ lockedHints: newLocked });
  };

  // hints รวมที่ใช้วิเคราะห์: locked + active
  const allHintsForAnalyze = [...lockedHints, ...hints];

  // แปลง hint ดิบ → hint สำหรับ boost (front/back/both)
  // - front 3 ตัว → front: digits + offsetPositions [0,1,2]
  // - front 2 ตัว → front: digits + offsetPositions [0,1]
  // - front 1 ตัว → boost ทั้ง 6 ตำแหน่ง (ทั้งหน้าและหลัง — ทุก pos 0-2)
  // - back  3 ตัว → back:  digits + offsetPositions [0,1,2]
  // - back  2 ตัว → back:  digits + offsetPositions [1,2]   (= ตำแหน่งจริง 5,6)
  // - back  1 ตัว → boost ทั้ง 6 ตำแหน่ง
  const hintsFront = [];
  const hintsBack  = [];
  allHintsForAnalyze.forEach((h) => {
    const fd = extractDigits(h.front).slice(0, 3);
    const bd = extractDigits(h.back).slice(0, 3);

    if (fd.length === 1) {
      const d = fd[0];
      hintsFront.push({ digits:[d,d,d], offsetPositions:[0,1,2] });
      hintsBack.push ({ digits:[d,d,d], offsetPositions:[0,1,2] });
    } else if (fd.length === 2) {
      hintsFront.push({ digits: fd, offsetPositions: [0,1] });
    } else if (fd.length === 3) {
      hintsFront.push({ digits: fd, offsetPositions: [0,1,2] });
    }

    if (bd.length === 1) {
      const d = bd[0];
      hintsFront.push({ digits:[d,d,d], offsetPositions:[0,1,2] });
      hintsBack.push ({ digits:[d,d,d], offsetPositions:[0,1,2] });
    } else if (bd.length === 2) {
      hintsBack.push({ digits: bd, offsetPositions: [1,2] });
    } else if (bd.length === 3) {
      hintsBack.push({ digits: bd, offsetPositions: [0,1,2] });
    }
  });
  const totalHints = allHintsForAnalyze.filter((h) => h.front.trim()||h.back.trim()).length;

  const handleAnalyze = useCallback(() => {
    setError("");
    setDupHighlight({ left: new Set(), lockedSide: {} });
    if (rows.length < 3) { setError("ต้องมีข้อมูลอย่างน้อย 3 งวด"); return; }

    // เช็คซ้ำในฝั่งซ้ายก่อน (เฉพาะที่ครบ 3 ตัว)
    const dupsLeft = findDuplicates(hints, hints);
    if (dupsLeft.length > 0) {
      const dupIdx = new Set();
      const lines = dupsLeft.map((d) => {
        dupIdx.add(d.aIdx); dupIdx.add(d.bIdx);
        return `• ชุดที่ ${d.aIdx+1} กับ ชุดที่ ${d.bIdx+1} (${d.side === "front" ? "หน้า" : "หลัง"} = ${d.digits})`;
      });
      setError(`⚠ พบข้อมูลซ้ำ ${dupsLeft.length} จุด — แก้ก่อนวิเคราะห์:\n${lines.join("\n")}`);
      setDupHighlight({ left: dupIdx, lockedSide: {} });
      // ค้างไว้จนกว่าจะแก้
      return;
    }

    // วิเคราะห์โหมดเดียว (ปกติ)
    const res = analyze(rows, hintsFront, hintsBack, weights);
    const pred = [...res.front, ...res.back];

    setResults(res); setLastPreds(pred); setComparison(null);
    setPrizeFull(""); setPrizeFront3(["",""]); setPrizeBack3(["",""]); setPrizeBack2("");
    setHints([{ front: "", back: "" }]);
    setAnimKey((k) => k+1); setTab("result");
    saveAll({
      lastPredictions: pred,
      lastResults: res,
      hints: [{ front: "", back: "" }],
    });
  }, [rows, hintsFront, hintsBack, weights, saveAll, lockedHints, hints]);

  // สร้าง log การวิเคราะห์ — รายละเอียดเต็ม (โหมดปกติ)
  const generateLog = () => {
    if (!results || !lastPreds) return "ยังไม่ได้วิเคราะห์";
    const lines = [];
    const ts = new Date().toLocaleString("th-TH");
    lines.push("================================================================");
    lines.push("LOTTERY ANALYZER — LOG การวิเคราะห์");
    lines.push("================================================================");
    lines.push(`สร้างเมื่อ: ${ts}`);
    lines.push(`จำนวนข้อมูลในอดีต: ${rows.length} งวด`);
    lines.push(`จำนวนรอบที่เรียนรู้: ${history.length} รอบ`);
    lines.push("");

    // Hints ที่ใช้
    lines.push("──────────────────────────────");
    lines.push(`ข้อมูลเพิ่มเติม (Hints) — ${allHintsForAnalyze.length} ชุด (ล็อก: ${lockedHints.length}, ใหม่: ${hints.filter(h=>h.front.trim()||h.back.trim()).length})`);
    lines.push("──────────────────────────────");
    allHintsForAnalyze.forEach((h, i) => {
      const f = extractDigits(h.front).join("") || "-";
      const b = extractDigits(h.back).join("") || "-";
      lines.push(`  ชุดที่ ${i+1}: หน้า=${f}, หลัง=${b}`);
    });
    if (allHintsForAnalyze.length === 0) lines.push("  (ไม่มี hints)");
    lines.push("");

    // ผลทาย
    lines.push("──────────────────────────────");
    lines.push("ผลการทาย");
    lines.push("──────────────────────────────");
    lines.push(`  ${lastPreds.slice(0,3).join(" ")} | ${lastPreds.slice(3,6).join(" ")}`);
    lines.push("");

    // ความถี่เลขแต่ละตำแหน่ง
    lines.push("──────────────────────────────");
    lines.push("ความถี่เลขแต่ละตำแหน่ง (Top 3 ของแต่ละตำแหน่ง)");
    lines.push("──────────────────────────────");
    for (let pos = 0; pos < 6; pos++) {
      const iF = pos < 3;
      const p = iF ? pos : pos - 3;
      const pf = iF ? results.posF : results.posB;
      const sorted = Object.entries(pf[p]).sort((a, b) => b[1] - a[1]);
      const top3 = sorted.slice(0, 3).map(([d, c]) => `${d}(${c})`).join(", ");
      lines.push(`  ตำแหน่ง ${pos+1}: ${top3}`);
    }
    lines.push("");

    // น้ำหนัก learning
    lines.push("──────────────────────────────");
    lines.push("น้ำหนัก Learning (เฉพาะที่ไม่ใช่ 0)");
    lines.push("──────────────────────────────");
    for (let pos = 0; pos < 6; pos++) {
      const nonZero = Object.entries(weights[pos])
        .filter(([d, val]) => val !== 0)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .map(([d, val]) => `${d}:${val > 0 ? "+" : ""}${val}`);
      if (nonZero.length > 0) {
        lines.push(`  ตำแหน่ง ${pos+1}: ${nonZero.join(", ")}`);
      }
    }
    lines.push("");

    // สถิติเฉลี่ย
    if (history.length > 0) {
      lines.push("──────────────────────────────");
      lines.push("สถิติเฉลี่ย (ค่าทฤษฎีสุ่ม = 0.6)");
      lines.push("──────────────────────────────");
      const avg = (history.reduce((s, h) => s + (h.hits || 0), 0) / history.length).toFixed(2);
      const max = Math.max(...history.map(h => h.hits || 0));
      lines.push(`  เฉลี่ย ${avg} | สูงสุด ${max} | จำนวน ${history.length} รอบ`);
      lines.push("");
    }

    lines.push("================================================================");
    lines.push("END OF LOG");
    lines.push("================================================================");
    return lines.join("\n");
  };

  // Export ทุกรอบเป็น CSV (key-value format) — ดึงจาก Firestore
  const exportLogsCsv = async () => {
    setSaveMsg("กำลังดึงข้อมูล Log..."); 
    const logs = await fetchAllLogs();
    if (logs.length === 0) {
      setSaveMsg("⚠ ยังไม่มี log ใน Firestore"); setTimeout(() => setSaveMsg(""), 3000);
      return;
    }

    // สร้าง CSV key-value format
    const escape = (v) => {
      const s = String(v ?? "");
      return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = ["รอบ,หัวข้อ,ข้อมูล"];
    logs.forEach((log, idx) => {
      const n = log.roundNumber || (idx + 1);
      const add = (k, v) => rows.push(`${n},${escape(k)},${escape(v)}`);
      add("วันที่", log.date || "");
      add("เวลา", log.time || "");
      add("จำนวนข้อมูลในอดีต", log.rowsCount || 0);
      add("ทาย", (log.prediction || []).join("-"));
      add("ผลจริง", (log.actual || []).join("-"));
      add("ถูก_6ตัว", `${log.hits || 0}/6`);
      add("จำนวน_Hints", log.hintsCount || 0);
      add("Hints", log.hintsUsed || "");
      add("3หน้า_ถูก", log.front3Win ? "✓" : "❌");
      add("3หน้า_จำนวนตัว", log.front3Hits || "");
      add("3ท้าย_ถูก", log.back3Win ? "✓" : "❌");
      add("3ท้าย_จำนวนตัว", log.back3Hits || "");
      add("2ท้าย_ถูก", log.back2Win ? "✓" : "❌");
      add("2ท้าย_จำนวนตัว", log.back2Hits || 0);
      (log.freqTop3 || []).forEach((f, i) => {
        add(`ความถี่_Top3_ตำแหน่ง${i+1}`, f);
      });
      (log.weightsBefore || []).forEach((w, i) => {
        add(`น้ำหนัก_ตำแหน่ง${i+1}`, w);
      });
    });

    // เพิ่ม BOM เพื่อให้ Excel เปิดภาษาไทยถูกต้อง
    const csv = "\uFEFF" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `lottery-logs-${ts}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaveMsg(`✓ Export ${logs.length} รอบ สำเร็จ`); setTimeout(() => setSaveMsg(""), 3000);
  };

  const handleSubmitActual = () => {
    if (!lastPreds) return;
    const fullDigits = extractDigits(prizeFull).slice(0, 6);
    if (fullDigits.length < 6) return;

    const front3Sets = prizeFront3.map((v) => extractDigits(v).slice(0,3)).filter((d) => d.length === 3);
    const back3Sets  = prizeBack3.map((v)  => extractDigits(v).slice(0,3)).filter((d) => d.length === 3);
    const back2Arr   = extractDigits(prizeBack2).slice(0, 2);

    const prizes = { full: fullDigits, front3: front3Sets, back3: back3Sets, back2: back2Arr };

    const cmp = buildComparison(lastPreds, prizes);
    const newWeights = adjustWeights(weights, lastPreds, fullDigits);

    // สร้างประวัติ
    const entry = {
      date: new Date().toLocaleDateString("th-TH"),
      actual: fullDigits,
      pred: [...lastPreds],
      hits: cmp.hits6,
    };
    if (front3Sets.length > 0) {
      entry.front3Entered = true;
      entry.front3Win = cmp.front3Results.some((r) => r.win);
      entry.front3Hits = cmp.front3Results.map((r) => r.hits);
    }
    if (back3Sets.length > 0) {
      entry.back3Entered = true;
      entry.back3Win = cmp.back3Results.some((r) => r.win);
      entry.back3Hits = cmp.back3Results.map((r) => r.hits);
    }
    if (back2Arr.length === 2) {
      entry.back2Entered = true;
      entry.back2Win = cmp.back2Result?.win || false;
      entry.back2Hits = cmp.back2Result?.hits || 0;
    }

    const newHist = [entry, ...history].slice(0, 50);
    const newRaw = histRaw.trim() ? histRaw.trim()+"\n"+fullDigits.join(" ") : fullDigits.join(" ");

    // สร้าง log entry (รายละเอียดเต็ม) สำหรับบันทึกลง Firestore subcollection
    const logEntry = {
      date: entry.date,
      time: new Date().toLocaleTimeString("th-TH"),
      roundNumber: history.length + 1,
      rowsCount: rows.length,
      prediction: [...lastPreds],
      actual: [...fullDigits],
      hits: cmp.hits6,
      // ความถี่ Top 3 แต่ละตำแหน่ง
      freqTop3: results ? (() => {
        const freq = [];
        for (let pos = 0; pos < 6; pos++) {
          const iF = pos < 3;
          const p = iF ? pos : pos - 3;
          const pf = iF ? results.posF : results.posB;
          if (!pf) { freq.push(""); continue; }
          const sorted = Object.entries(pf[p]).sort((a, b) => b[1] - a[1]);
          freq.push(sorted.slice(0, 3).map(([d, c]) => `${d}(${c})`).join(", "));
        }
        return freq;
      })() : [],
      // น้ำหนัก Learning ทุกตำแหน่ง (ก่อนปรับ)
      weightsBefore: [0,1,2,3,4,5].map((pos) => {
        const nonZero = Object.entries(weights[pos] || {})
          .filter(([d, val]) => val !== 0)
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
          .map(([d, val]) => `${d}:${val > 0 ? "+" : ""}${val}`);
        return nonZero.join(", ");
      }),
      // Hints
      hintsUsed: allHintsForAnalyze.map((h) => {
        const f = extractDigits(h.front).join("") || "-";
        const b = extractDigits(h.back).join("") || "-";
        return `หน้า=${f}, หลัง=${b}`;
      }).join(" | "),
      hintsCount: allHintsForAnalyze.length,
      // รางวัลย่อย
      front3Win: entry.front3Win || false,
      front3Hits: (entry.front3Hits || []).join(","),
      back3Win:  entry.back3Win || false,
      back3Hits: (entry.back3Hits || []).join(","),
      back2Win:  entry.back2Win || false,
      back2Hits: entry.back2Hits || 0,
    };

    // บันทึก log ลง Firestore subcollection (ทำใน background ไม่ block UI)
    saveLogToFirestore(logEntry);

    setWeights(newWeights); setHistory(newHist); setHistRaw(newRaw);
    setResults(null); setLastPreds(null); setComparison(null);
    setPrizeFull(""); setPrizeFront3(["",""]); setPrizeBack3(["",""]); setPrizeBack2("");
    setTab("data");
    saveAll({ weights: newWeights, history: newHist, data: newRaw, lastPredictions: null, lastResults: null });
  };

  const totalRounds   = history.length;
  // helper: ดึง hits — รองรับข้อมูลเก่าจาก v22 ที่มี modes
  const getHits = (h) => h.hits ?? h.modes?.normal?.hits ?? 0;
  const avgHits = totalRounds ? (history.reduce((s,h)=>s+getHits(h), 0)/totalRounds).toFixed(2) : "—";
  const perfectRounds = history.filter((h)=>getHits(h)===6).length;

  return (
    <div style={{ minHeight:"100vh", background:P.bg, color:P.text, fontFamily:"'Segoe UI',sans-serif", padding:"16px 12px" }}>
      <input ref={importRef} type="file" accept=".xlsx,.xls,.csv,.txt" onChange={handleImport} style={{ display:"none" }} />

      {/* ── Log Modal ── */}
      {showLog && (
        <div onClick={()=>setShowLog(false)}
          style={{ position:"fixed", inset:0, background:"#000c", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:16 }}>
          <div onClick={(e)=>e.stopPropagation()}
            style={{ background:P.card, border:`1px solid ${P.blue}55`, borderRadius:14, padding:20, maxWidth:800, width:"100%", maxHeight:"90vh", display:"flex", flexDirection:"column" }}>
            <div style={{ display:"flex", alignItems:"center", marginBottom:14 }}>
              <div style={{ fontWeight:800, fontSize:15, color:P.blue }}>📋 Log การวิเคราะห์ (ล่าสุด)</div>
              <button onClick={()=>setShowLog(false)} style={{ marginLeft:"auto", background:"transparent", border:"none", color:P.muted, cursor:"pointer", fontSize:20 }}>✕</button>
            </div>
            <pre style={{ flex:1, overflowY:"auto", background:P.bg, border:`1px solid ${P.border}`, borderRadius:10, padding:"12px 14px", color:P.text, fontFamily:"monospace", fontSize:11, lineHeight:1.5, margin:0, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>
              {generateLog()}
            </pre>
          </div>
        </div>
      )}

      {/* ── Graph Modal ── */}
      {showGraph && (() => {
        // เตรียมข้อมูลตามประเภทกราฟ
        const mn = (h) => h.modes?.normal || h;
        const graphConfig = {
          full:   { title:"6 ตัว",     max:6, color:P.accent, getHits:(h)=> mn(h).hits ?? 0, filter:()=>true },
          front3: { title:"3 ตัวหน้า", max:3, color:P.green,  getHits:(h)=> { const m=mn(h); return m.front3Hits ? Math.max(...m.front3Hits) : 0; }, filter:(h)=> mn(h).front3Entered },
          back3:  { title:"3 ตัวท้าย", max:3, color:P.purple, getHits:(h)=> { const m=mn(h); return m.back3Hits  ? Math.max(...m.back3Hits)  : 0; }, filter:(h)=> mn(h).back3Entered  },
          back2:  { title:"2 ตัวท้าย", max:2, color:P.cyan,   getHits:(h)=> mn(h).back2Hits || 0, filter:(h)=> mn(h).back2Entered },
        };
        const cfg = graphConfig[graphType];
        const filteredHistory = history.filter(cfg.filter);
        const allHits = filteredHistory.map(cfg.getHits);
        const maxHit = allHits.length ? Math.max(...allHits) : 0;
        const minHit = allHits.length ? Math.min(...allHits) : 0;
        const avgHit = allHits.length ? (allHits.reduce((s,v)=>s+v,0)/allHits.length).toFixed(2) : 0;
        const perfect = allHits.filter((h)=>h===cfg.max).length;
        const yLabels = Array.from({length: cfg.max+1}, (_,i) => cfg.max-i);

        return (
          <div onClick={()=>setShowGraph(false)}
            style={{ position:"fixed", inset:0, background:"#000c", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:16 }}>
            <div onClick={(e)=>e.stopPropagation()}
              style={{ background:P.card, border:`1px solid ${P.border}`, borderRadius:14, padding:20, maxWidth:900, width:"100%", maxHeight:"90vh", overflowY:"auto" }}>
              <div style={{ display:"flex", alignItems:"center", marginBottom:14 }}>
                <div style={{ fontWeight:800, fontSize:15, color:cfg.color }}>📊 กราฟผลการทาย {cfg.title}</div>
                <button onClick={()=>setShowGraph(false)} style={{ marginLeft:"auto", background:"transparent", border:"none", color:P.muted, cursor:"pointer", fontSize:20 }}>✕</button>
              </div>

              {/* แท็บเลือกประเภทกราฟ */}
              <div style={{ display:"flex", gap:6, marginBottom:14, flexWrap:"wrap" }}>
                {[
                  { key:"full",   label:"6 ตัว",     color:P.accent },
                  { key:"front3", label:"3 ตัวหน้า", color:P.green },
                  { key:"back3",  label:"3 ตัวท้าย", color:P.purple },
                  { key:"back2",  label:"2 ตัวท้าย", color:P.cyan },
                ].map((t) => (
                  <button key={t.key} onClick={()=>setGraphType(t.key)}
                    style={{ flex:1, minWidth:80,
                      background: graphType===t.key ? t.color : "transparent",
                      color: graphType===t.key ? "#000" : t.color,
                      border:`1px solid ${t.color}55`, borderRadius:7, padding:"7px 8px",
                      fontWeight:700, fontSize:12, cursor:"pointer" }}>
                    {t.label}
                  </button>
                ))}
              </div>

              {filteredHistory.length === 0 ? (
                <div style={{ textAlign:"center", padding:"40px 20px", color:P.muted, background:P.bg, borderRadius:10 }}>
                  ยังไม่มีข้อมูลรางวัล {cfg.title}
                  <div style={{ fontSize:11, marginTop:6 }}>ใส่ผลจริงของรางวัลนี้เพื่อดูกราฟ</div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize:11, color:P.muted, marginBottom:14 }}>
                    แสดง {filteredHistory.length} รอบที่ใส่ผลรางวัลนี้
                  </div>

                  {/* กราฟแท่ง */}
                  <div style={{ background:P.bg, borderRadius:10, padding:"16px 12px", border:`1px solid ${P.border}` }}>
                    <div style={{ display:"flex", height:240 }}>
                      {/* แกน Y */}
                      <div style={{ display:"flex", flexDirection:"column", justifyContent:"space-between", paddingRight:6, fontSize:10, color:P.muted, fontFamily:"monospace" }}>
                        {yLabels.map((n) => (
                          <div key={n} style={{ height:0, lineHeight:0 }}>{n}</div>
                        ))}
                      </div>
                      {/* พื้นที่แท่ง */}
                      <div style={{ flex:1, position:"relative", borderLeft:`1px solid ${P.border}`, borderBottom:`1px solid ${P.border}` }}>
                        {Array.from({length: cfg.max}, (_,i) => i+1).map((n) => (
                          <div key={n} style={{ position:"absolute", left:0, right:0, bottom:`${(n/cfg.max)*100}%`, borderTop:`1px dashed ${P.border}66` }} />
                        ))}
                        <div style={{ display:"flex", alignItems:"flex-end", height:"100%", gap:2, padding:"0 2px" }}>
                          {[...filteredHistory].reverse().map((h, i) => {
                            const hits = cfg.getHits(h);
                            const half = cfg.max / 2;
                            const color = hits >= cfg.max-1 ? P.green : hits >= half ? P.accent : P.red;
                            const barHeight = (hits/cfg.max)*100;
                            return (
                              <div key={i} title={`รอบ ${i+1}: ${hits}/${cfg.max}`}
                                style={{ flex:1, minWidth:6,
                                  background:color, opacity:0.85,
                                  height:`${barHeight}%`, minHeight: hits>0?2:1,
                                  borderRadius:"2px 2px 0 0", cursor:"pointer" }} />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div style={{ display:"flex", marginTop:6, paddingLeft:14, fontSize:9, color:P.muted, fontFamily:"monospace", justifyContent:"space-between" }}>
                      <span>รอบ 1</span>
                      {filteredHistory.length > 2 && <span>รอบ {Math.ceil(filteredHistory.length/2)}</span>}
                      <span>รอบ {filteredHistory.length}</span>
                    </div>
                  </div>

                  {/* สถิติย่อ */}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginTop:14 }}>
                    {[
                      { label:"สูงสุด", val:maxHit,  color:P.green },
                      { label:"ต่ำสุด", val:minHit,  color:P.red },
                      { label:"เฉลี่ย", val:avgHit,  color:P.accent },
                      { label:`ครบ ${cfg.max}`, val:perfect, color:P.blue },
                    ].map((s) => (
                      <div key={s.label} style={{ background:P.bg, border:`1px solid ${s.color}33`, borderRadius:8, padding:"8px 6px", textAlign:"center" }}>
                        <div style={{ fontSize:18, fontWeight:900, color:s.color }}>{s.val}</div>
                        <div style={{ fontSize:10, color:P.muted, marginTop:2 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      <div style={{ maxWidth:640, margin:"0 auto" }}>
        <div style={{ textAlign:"center", marginBottom:14 }}>
          <div style={{ fontSize:10, letterSpacing:4, color:P.accent, textTransform:"uppercase", marginBottom:4 }}>Adaptive Probability Engine v25</div>
          <h1 style={{ margin:0, fontSize:20, fontWeight:900 }}>วิเคราะห์เลข 6 หลัก + Cloud Sync</h1>
        </div>

        <div style={{ display:"flex", marginBottom:14, borderRadius:10, overflow:"hidden", border:`1px solid ${P.border}` }}>
          {[["data","📋 ข้อมูล"],["result","📊 ผลวิเคราะห์"],["stats","🧠 สถิติ"]].map(([key,label])=>(
            <button key={key} onClick={()=>setTab(key)} style={{
              flex:1, padding:"10px 4px", border:"none", cursor:"pointer",
              background:tab===key ? P.accent : P.card,
              color:tab===key ? "#000" : P.muted,
              fontWeight:tab===key ? 800 : 500, fontSize:12, transition:"all .2s",
            }}>
              {label}
              {key==="data"   && <span style={{ display:"block", fontSize:10, opacity:.7 }}>{rows.length} งวด</span>}
              {key==="result" && lastPreds && !comparison && <span style={{ display:"block", fontSize:10, color:tab==="result"?"#000":P.orange }}>● รอยืนยัน</span>}
              {key==="stats"  && <span style={{ display:"block", fontSize:10, opacity:.7 }}>{totalRounds} รอบ</span>}
            </button>
          ))}
        </div>

        {/* ── TAB DATA ── */}
        {tab==="data" && (<>
          <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap", alignItems:"center" }}>
            <SyncBadge status={syncStatus} />
            <div style={{ marginLeft:"auto", display:"flex", gap:5, flexWrap:"wrap" }}>
              <button onClick={()=>saveAll()} style={{ fontSize:11, background:P.green+"22", color:P.green, border:`1px solid ${P.green}44`, borderRadius:7, padding:"5px 10px", cursor:"pointer", fontWeight:700 }}>💾 บันทึก</button>
              <button onClick={handleExportTxt} style={{ fontSize:11, background:P.blue+"22", color:P.blue, border:`1px solid ${P.blue}44`, borderRadius:7, padding:"5px 10px", cursor:"pointer" }}>⬇ .txt</button>
              <button onClick={handleExportXlsx} style={{ fontSize:11, background:P.green+"22", color:P.green, border:`1px solid ${P.green}44`, borderRadius:7, padding:"5px 10px", cursor:"pointer" }}>⬇ .xlsx</button>
              <button onClick={()=>importRef.current?.click()} style={{ fontSize:11, background:P.purple+"22", color:P.purple, border:`1px solid ${P.purple}44`, borderRadius:7, padding:"5px 10px", cursor:"pointer" }}>⬆ นำเข้า</button>
            </div>
          </div>
          {saveMsg && <div style={{ fontSize:12, color:P.green, marginBottom:8, padding:"5px 12px", background:P.green+"11", borderRadius:7 }}>{saveMsg}</div>}

          <div style={{ background:P.card, border:`1px solid ${P.border}`, borderRadius:12, padding:16, marginBottom:12 }}>
            <div style={{ fontSize:11, color:P.muted, marginBottom:8 }}>
              1 บรรทัด = 6 ตัวเลข &nbsp;
              <span style={{ color:P.accent, fontFamily:"monospace" }}>154237</span> หรือ <span style={{ color:P.accent, fontFamily:"monospace" }}>1 5 4 2 3 7</span> ก็ได้
            </div>
            <textarea value={histRaw} onChange={(e)=>setHistRaw(filterDigitsSpaceNewline(e.target.value))} inputMode="numeric" rows={8}
              style={{ width:"100%", boxSizing:"border-box", background:P.bg, border:`1px solid ${P.border}`, borderRadius:8, padding:"10px 12px", color:P.text, fontFamily:"monospace", fontSize:14, resize:"vertical", outline:"none", lineHeight:1.8 }}
              placeholder={"154237\n372931\n..."} />
            <div style={{ marginTop:6, fontSize:11, color:rows.length>=3 ? P.green : P.muted }}>
              {rows.length>0 ? `✓ ${rows.length} งวด` : "ยังไม่มีข้อมูล"}
              {rows.length>0 && rows.length<3 && <span style={{ color:P.red }}> (ต้องการอย่างน้อย 3)</span>}
            </div>
          </div>

          <div style={{ background:P.card, border:`1px solid ${P.green}33`, borderRadius:12, padding:14, marginBottom:12 }}>
            <div style={{ fontSize:11, color:P.green, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>➕ เพิ่มชุดข้อมูลใหม่</div>
            <div style={{ display:"flex", gap:8 }}>
              <input value={newLine} onChange={(e)=>{setNewLine(filterDigitsSpace(e.target.value));setAddError("");}} inputMode="numeric"
                onKeyDown={(e)=>e.key==="Enter"&&handleAddLine()}
                placeholder="6 ตัวเลข เช่น 154237"
                style={{ flex:1, background:P.bg, border:`1px solid ${addError?P.red:P.green}44`, borderRadius:8, padding:"9px 12px", color:P.text, fontFamily:"monospace", fontSize:15, outline:"none" }} />
              <button onClick={handleAddLine} style={{ background:P.green+"22", color:P.green, border:`1px solid ${P.green}55`, borderRadius:8, padding:"9px 16px", fontWeight:900, fontSize:20, cursor:"pointer", lineHeight:1 }}>+</button>
            </div>
            {addError && <div style={{ color:P.red, fontSize:12, marginTop:6 }}>⚠ {addError}</div>}
          </div>

          <div style={{ background:P.card, border:`1px solid ${P.accent}33`, borderRadius:12, padding:16, marginBottom:14 }}>
            <div style={{ display:"flex", alignItems:"center", marginBottom:10, flexWrap:"wrap", gap:8 }}>
              <div>
                <div style={{ fontSize:11, color:P.accent, letterSpacing:1, textTransform:"uppercase" }}>🎯 ข้อมูลเพิ่มเติม</div>
                <div style={{ fontSize:11, color:P.muted, marginTop:2 }}>ใส่ได้หลายชุด{totalHints>0?` (รวม ${totalHints} ชุด)`:""}</div>
              </div>
            </div>

            {/* Layout 2 คอลัมน์ */}
            <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
              {/* ฝั่งซ้าย — แก้ไขได้ */}
              <div style={{ flex:1, minWidth:280 }}>
                <div style={{ fontSize:10, color:P.green, letterSpacing:1, marginBottom:6, fontWeight:700 }}>
                  ✏️ ใส่ใหม่
                </div>
                {(() => {
                  // เช็คซ้ำในฝั่งซ้ายเพื่อ highlight แม้ก่อนกดวิเคราะห์
                  const dups = findDuplicates(hints, hints);
                  const dupFrontSet = new Set();
                  const dupBackSet  = new Set();
                  dups.forEach((d) => {
                    if (d.side === "front") { dupFrontSet.add(d.aIdx); dupFrontSet.add(d.bIdx); }
                    if (d.side === "back")  { dupBackSet.add(d.aIdx);  dupBackSet.add(d.bIdx); }
                  });
                  return hints.map((h,i) => (
                    <HintRow key={i} idx={i} front={h.front} back={h.back}
                      onChangeFront={(v)=>updateHint(i,"front",v)}
                      onChangeBack={(v) =>updateHint(i,"back", v)}
                      onRemove={()=>removeHint(i)}
                      onLock={()=>lockHintAt(i)}
                      onEnter={()=>handleHintEnter(i)}
                      dupFront={dupFrontSet.has(i) || dupHighlight.left.has(i)}
                      dupBack={dupBackSet.has(i) || dupHighlight.left.has(i)} />
                  ));
                })()}
                <button onClick={() => {
                  setHints((prev) => [...prev, { front:"", back:"" }]);
                  setTimeout(() => {
                    const el = document.getElementById(`hint-back-${hints.length}`);
                    if (el) el.focus();
                  }, 50);
                }} style={{ width:"100%", marginTop:6, background:P.accent+"22", color:P.accent, border:`1px dashed ${P.accent}66`, borderRadius:8, padding:"10px", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                  + เพิ่มชุด
                </button>
              </div>

              {/* ฝั่งขวา — ล็อกไว้ */}
              {lockedHints.length > 0 && (
                <div style={{ flex:1, minWidth:280 }}>
                  <div style={{ display:"flex", alignItems:"center", marginBottom:6 }}>
                    <div style={{ fontSize:10, color:P.muted, letterSpacing:1, fontWeight:700 }}>
                      🔒 ล็อกไว้ ({lockedHints.length} ชุด)
                    </div>
                    <button onClick={unlockAll} title="ปลดล็อกทั้งหมด (ลบทั้งหมด)"
                      style={{ marginLeft:"auto", background:P.red+"22", color:P.red, border:`1px solid ${P.red}55`, borderRadius:7, padding:"5px 12px", fontWeight:700, fontSize:11, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
                      🔓 ปลดล็อก
                    </button>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {lockedHints.map((h, i) => {
                      const fd = extractDigits(h.front).slice(0,3);
                      const bd = extractDigits(h.back).slice(0,3);
                      const hlSide = dupHighlight.lockedSide[i];
                      const hlFront = hlSide === "front";
                      const hlBack  = hlSide === "back";
                      const isHl    = hlFront || hlBack;
                      return (
                        <div key={i} style={{
                          background: isHl ? P.red+"11" : P.bg,
                          border:`1px solid ${isHl ? P.red : P.border}`,
                          borderRadius:8, padding:"10px 12px", opacity:0.95 }}>
                          <div style={{ fontSize:10, color: isHl ? P.red : P.muted, marginBottom:6, fontWeight:700, display:"flex", alignItems:"center", gap:6 }}>
                            <button onClick={()=>removeLockedHint(i)} title="ลบชุดนี้"
                              style={{ background:"transparent", border:"none", color:isHl ? P.red : P.accent, cursor:"pointer", padding:0, fontSize:14, lineHeight:1 }}>
                              🔓
                            </button>
                            <span>ชุดที่ {i+1}</span>
                          </div>
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <div style={{ flex:1, textAlign:"center" }}>
                              <div style={{ fontSize:9, color: hlFront ? P.red : P.accent, marginBottom:3 }}>3 ตัวหน้า</div>
                              <div style={{ display:"flex", gap:3, justifyContent:"center" }}>
                                {[0,1,2].map((p) => {
                                  const offset = 3 - fd.length;
                                  const dIdx = p - offset;
                                  const digit = (dIdx >= 0 && dIdx < fd.length) ? fd[dIdx] : undefined;
                                  return <MiniDot key={p} n={digit} color={hlFront ? P.red : P.accent} filled={digit !== undefined} />;
                                })}
                              </div>
                            </div>
                            <div style={{ width:2, height:24, background:P.border }} />
                            <div style={{ flex:1, textAlign:"center" }}>
                              <div style={{ fontSize:9, color: hlBack ? P.red : P.purple, marginBottom:3 }}>3 ตัวหลัง</div>
                              <div style={{ display:"flex", gap:3, justifyContent:"center" }}>
                                {[0,1,2].map((p) => {
                                  const offset = 3 - bd.length;
                                  const dIdx = p - offset;
                                  const digit = (dIdx >= 0 && dIdx < bd.length) ? bd[dIdx] : undefined;
                                  return <MiniDot key={p} n={digit} color={hlBack ? P.red : P.purple} filled={digit !== undefined} />;
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div style={{ color:P.red, fontSize:13, marginBottom:8, padding:"10px 14px", background:P.red+"11", border:`1px solid ${P.red}33`, borderRadius:8, whiteSpace:"pre-line", lineHeight:1.6 }}>
              {error}
            </div>
          )}

          <button onClick={handleAnalyze} disabled={rows.length<3}
            style={{ width:"100%", padding:"14px", background:rows.length>=3?P.accent:P.border, color:rows.length>=3?"#000":P.muted, border:"none", borderRadius:10, fontWeight:900, fontSize:17, cursor:rows.length>=3?"pointer":"default", letterSpacing:1, transition:"all .2s" }}>
            วิเคราะห์ →
          </button>
        </>)}

        {/* ── TAB RESULT ── */}
        {tab==="result" && (<>
          {!results ? (
            <div style={{ textAlign:"center", padding:"40px 20px" }}>
              <div style={{ fontSize:40, marginBottom:12 }}>📊</div>
              <div style={{ color:P.muted }}>ยังไม่ได้วิเคราะห์</div>
              <button onClick={()=>setTab("data")} style={{ marginTop:14, background:P.accent, color:"#000", border:"none", borderRadius:8, padding:"10px 24px", fontWeight:700, fontSize:14, cursor:"pointer" }}>ไปใส่ข้อมูล →</button>
            </div>
          ) : (
            <div key={animKey}>
              {!comparison && (
                <div style={{ background:P.orange+"11", border:`1px solid ${P.orange}44`, borderRadius:10, padding:"8px 14px", marginBottom:12, fontSize:12, color:P.orange }}>
                  ⏳ ใส่ผลจริงเพื่อตรวจสอบ
                </div>
              )}

              {/* แสดงผล */}
              {(() => {
                const pred = lastPreds;
                const cmp = comparison?.cmp ? comparison : null;
                return (
                  <div style={{ background:P.card, border:`1px solid ${cmp ? P.green : P.accent}44`, borderRadius:12, padding:14, marginBottom:10 }}>
                    <div style={{ fontSize:11, color:P.accent, fontWeight:800, marginBottom:10, letterSpacing:1 }}>
                      🎯 ผลทาย (ข้อมูลหลัก + hints)
                      {cmp && <span style={{ marginLeft:8, color:P.green }}>— ถูก {cmp.hits6}/6</span>}
                    </div>
                    <div style={{ display:"flex", justifyContent:"center", alignItems:"center", gap:5, flexWrap:"wrap", marginBottom:8 }}>
                      {pred.slice(0,3).map((n,i) => (
                        <Ball key={`f${i}`} n={n} size={40}
                          color={cmp ? (cmp.cmp[i].hit ? P.green : P.red) : P.accent}
                          glow={!cmp} />
                      ))}
                      <div style={{ width:2, height:24, background:P.border, borderRadius:2, margin:"0 3px" }} />
                      {pred.slice(3,6).map((n,i) => (
                        <Ball key={`b${i}`} n={n} size={40}
                          color={cmp ? (cmp.cmp[i+3].hit ? P.green : P.red) : P.accent}
                          glow={!cmp} />
                      ))}
                    </div>
                    <div style={{ textAlign:"center", fontFamily:"monospace", fontWeight:900, fontSize:18, letterSpacing:3, color:P.accent }}>
                      {pred.slice(0,3).join(" ")} <span style={{ color:P.muted, margin:"0 4px" }}>–</span> {pred.slice(3,6).join(" ")}
                    </div>

                    {/* รางวัลย่อย */}
                    {cmp && (
                      <div style={{ marginTop:10, display:"flex", gap:5, flexWrap:"wrap", justifyContent:"center" }}>
                        {cmp.front3Results.map((r, i) => (
                          <span key={`f3-${i}`} style={{ fontSize:10, padding:"2px 8px", borderRadius:6,
                            background: r.win ? P.green+"33" : P.border, color: r.win ? P.green : P.muted, border:`1px solid ${r.win?P.green:P.border}` }}>
                            3หน้า#{i+1}: {r.hits}/3 {r.win && "✓"}
                          </span>
                        ))}
                        {cmp.back3Results.map((r, i) => (
                          <span key={`b3-${i}`} style={{ fontSize:10, padding:"2px 8px", borderRadius:6,
                            background: r.win ? P.purple+"33" : P.border, color: r.win ? P.purple : P.muted, border:`1px solid ${r.win?P.purple:P.border}` }}>
                            3ท้าย#{i+1}: {r.hits}/3 {r.win && "✓"}
                          </span>
                        ))}
                        {cmp.back2Result && (
                          <span style={{ fontSize:10, padding:"2px 8px", borderRadius:6,
                            background: cmp.back2Result.win ? P.cyan+"33" : P.border,
                            color: cmp.back2Result.win ? P.cyan : P.muted,
                            border:`1px solid ${cmp.back2Result.win?P.cyan:P.border}` }}>
                            2ท้าย: {cmp.back2Result.hits}/2 {cmp.back2Result.win && "✓"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              <div style={{ fontSize:11, color:P.muted, textAlign:"center", marginBottom:14 }}>
                วิเคราะห์จาก {results?.total || 0} งวด
                {!comparison && (
                  <button onClick={handleAnalyze} style={{ marginLeft:10, background:"transparent", color:P.muted, border:`1px solid ${P.border}`, borderRadius:8, padding:"4px 12px", fontWeight:600, fontSize:11, cursor:"pointer" }}>🔄 วิเคราะห์ใหม่</button>
                )}
              </div>

              {/* ใส่ผลจริง */}
              {!comparison ? (
                <div style={{ background:P.card, border:`1px solid ${P.orange}55`, borderRadius:12, padding:16, marginBottom:14 }}>
                  <div style={{ fontSize:11, color:P.orange, letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}>📝 ใส่ผลจริงที่ออก</div>
                  <div style={{ fontSize:12, color:P.muted, marginBottom:12 }}>
                    ใส่ผลจริง — ระบบตรวจสอบและอัปเดต Learning อัตโนมัติ
                  </div>

                  <PrizeInput id="prize-full" label="🏆 รางวัลที่ 1 — 6 ตัว (บังคับ)" color={P.accent}
                    value={prizeFull} onChange={setPrizeFull}
                    maxLen={6} placeholder="เช่น 351297" slots={6}
                    onEnter={() => document.getElementById("prize-front3-0")?.focus()} />

                  <div style={{ fontSize:11, color:P.green, fontWeight:700, margin:"10px 0 6px", letterSpacing:1 }}>
                    🎯 3 ตัวหน้า (ใส่ได้ 1–2 ชุด)
                  </div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    {[0,1].map((i) => (
                      <div key={i} style={{ flex:1, minWidth:140 }}>
                        <PrizeInput
                          id={`prize-front3-${i}`}
                          label={`ชุดที่ ${i+1}`} color={P.green}
                          value={prizeFront3[i]}
                          onChange={(v) => setPrizeFront3((prev) => { const n=[...prev]; n[i]=v; return n; })}
                          maxLen={3} placeholder="เช่น 351" slots={3}
                          onEnter={() => {
                            const nextId = i === 0 ? "prize-front3-1" : "prize-back3-0";
                            document.getElementById(nextId)?.focus();
                          }} />
                      </div>
                    ))}
                  </div>

                  <div style={{ fontSize:11, color:P.purple, fontWeight:700, margin:"10px 0 6px", letterSpacing:1 }}>
                    🎯 3 ตัวท้าย (ใส่ได้ 1–2 ชุด)
                  </div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    {[0,1].map((i) => (
                      <div key={i} style={{ flex:1, minWidth:140 }}>
                        <PrizeInput
                          id={`prize-back3-${i}`}
                          label={`ชุดที่ ${i+1}`} color={P.purple}
                          value={prizeBack3[i]}
                          onChange={(v) => setPrizeBack3((prev) => { const n=[...prev]; n[i]=v; return n; })}
                          maxLen={3} placeholder="เช่น 297" slots={3}
                          onEnter={() => {
                            const nextId = i === 0 ? "prize-back3-1" : "prize-back2";
                            document.getElementById(nextId)?.focus();
                          }} />
                      </div>
                    ))}
                  </div>

                  <div style={{ fontSize:11, color:P.cyan, fontWeight:700, margin:"10px 0 6px", letterSpacing:1 }}>
                    🎯 2 ตัวท้าย (ใส่ได้ 1 ชุด)
                  </div>
                  <PrizeInput id="prize-back2" label="ชุดที่ 1" color={P.cyan}
                    value={prizeBack2} onChange={setPrizeBack2}
                    maxLen={2} placeholder="เช่น 97" slots={2}
                    onEnter={() => document.getElementById("prize-submit")?.click()} />

                  <button id="prize-submit" onClick={() => {
                    // คำนวณ comparison สำหรับการแสดงทันที
                    const fullDigits = extractDigits(prizeFull).slice(0, 6);
                    if (fullDigits.length < 6) return;
                    const front3Sets = prizeFront3.map((v) => extractDigits(v).slice(0,3)).filter((d) => d.length === 3);
                    const back3Sets  = prizeBack3.map((v)  => extractDigits(v).slice(0,3)).filter((d) => d.length === 3);
                    const back2Arr   = extractDigits(prizeBack2).slice(0, 2);
                    const prizes = { full: fullDigits, front3: front3Sets, back3: back3Sets, back2: back2Arr };
                    if (lastPreds) {
                      const cmp = buildComparison(lastPreds, prizes);
                      setComparison({ ...cmp, prizes });
                    }
                    handleSubmitActual();
                  }}
                    disabled={extractDigits(prizeFull).length < 6}
                    style={{
                      width:"100%", marginTop:12,
                      background: extractDigits(prizeFull).length>=6 ? P.orange : P.border,
                      color: extractDigits(prizeFull).length>=6 ? "#000" : P.muted,
                      border:"none", borderRadius:8, padding:"12px", fontWeight:800, fontSize:15, cursor:"pointer"
                    }}>
                    ยืนยันผลและตรวจสอบ ✓
                  </button>
                </div>
              ) : null}

              <p style={{ color:P.muted, fontSize:11, textAlign:"center" }}>⚠ ผลนี้อิงสถิติในอดีตเท่านั้น ไม่รับประกันผลในอนาคต</p>
            </div>
          )}
        </>)}

        {/* ── TAB STATS ── */}
        {tab==="stats" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:10 }}>
              {[
                { label:"รอบที่เรียนรู้", val:totalRounds,   color:P.blue },
                { label:"เฉลี่ยถูก/รอบ", val:avgHits,       color:P.accent },
                { label:"ถูกครบ 6 ตัว",  val:perfectRounds, color:P.green },
              ].map((s) => (
                <div key={s.label} style={{ background:P.card, border:`1px solid ${s.color}33`, borderRadius:10, padding:"12px 10px", textAlign:"center" }}>
                  <div style={{ fontSize:24, fontWeight:900, color:s.color }}>{s.val}</div>
                  <div style={{ fontSize:11, color:P.muted, marginTop:2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {totalRounds > 0 && (() => {
              const getField = (h, field) => h[field] ?? h.modes?.normal?.[field];
              const front3Wins  = history.filter((h) => getField(h, "front3Win") === true).length;
              const back3Wins   = history.filter((h) => getField(h, "back3Win")  === true).length;
              const back2Wins   = history.filter((h) => getField(h, "back2Win")  === true).length;
              const front3Total = history.filter((h) => getField(h, "front3Entered") === true).length;
              const back3Total  = history.filter((h) => getField(h, "back3Entered")  === true).length;
              const back2Total  = history.filter((h) => getField(h, "back2Entered")  === true).length;
              return (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:14 }}>
                  {[
                    { label:"3 ตัวหน้า", wins:front3Wins, total:front3Total, color:P.green },
                    { label:"3 ตัวท้าย", wins:back3Wins,  total:back3Total,  color:P.purple },
                    { label:"2 ตัวท้าย", wins:back2Wins,  total:back2Total,  color:P.cyan },
                  ].map((s) => (
                    <div key={s.label} style={{ background:P.card, border:`1px solid ${s.color}33`, borderRadius:10, padding:"12px 10px", textAlign:"center" }}>
                      <div style={{ fontSize:22, fontWeight:900, color:s.color }}>{s.wins}</div>
                      <div style={{ fontSize:10, color:P.muted, marginTop:2 }}>{s.label} ถูก</div>
                      <div style={{ fontSize:10, color:P.muted }}>จาก {s.total} รอบที่ใส่</div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* ปุ่ม Log */}
            <div style={{ background:P.card, border:`1px solid ${P.blue}33`, borderRadius:12, padding:14, marginBottom:14 }}>
              <div style={{ fontSize:11, color:P.muted, marginBottom:10, letterSpacing:1, textTransform:"uppercase" }}>📋 Log การวิเคราะห์</div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <button onClick={()=>setShowLog(true)} disabled={!results}
                  style={{ flex:1, background:results?P.blue+"22":"transparent", color:results?P.blue:P.muted, border:`1px solid ${results?P.blue+"55":P.border}`, borderRadius:7, padding:"8px 12px", fontWeight:700, fontSize:12, cursor:results?"pointer":"not-allowed" }}>
                  👁️ ดู Log ล่าสุด
                </button>
                <button onClick={exportLogsCsv}
                  style={{ flex:1, background:P.green+"22", color:P.green, border:`1px solid ${P.green}55`, borderRadius:7, padding:"8px 12px", fontWeight:700, fontSize:12, cursor:"pointer" }}>
                  📊 Export .csv ทุกรอบ
                </button>
              </div>
              <div style={{ fontSize:10, color:P.muted, marginTop:8 }}>
                💡 ทุกรอบที่ใส่ผลจริงจะถูกบันทึก Log อัตโนมัติใน Cloud
              </div>
            </div>

            {history.slice(0,5).length>0 && (
              <div style={{ background:P.card, border:`1px solid ${P.border}`, borderRadius:12, padding:16, marginBottom:14 }}>
                <div style={{ fontSize:11, color:P.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:12 }}>📈 5 รอบล่าสุด</div>
                <div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
                  {history.slice(0,5).map((h,i) => {
                    const hits = getHits(h);
                    const color=hits>=4?P.green:hits>=2?P.accent:P.red;
                    return (
                      <div key={i} style={{ flex:1, textAlign:"center" }}>
                        <div style={{ height:60, display:"flex", alignItems:"flex-end", justifyContent:"center", marginBottom:4 }}>
                          <div style={{ width:"70%", background:color, borderRadius:"4px 4px 0 0", height:`${(hits/6)*60}px`, minHeight:4 }} />
                        </div>
                        <div style={{ fontFamily:"monospace", fontWeight:900, fontSize:16, color }}>{hits}</div>
                        <div style={{ fontSize:10, color:P.muted }}>รอบ {totalRounds-i}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ background:P.card, border:`1px solid ${P.border}`, borderRadius:12, padding:16, marginBottom:14 }}>
              <div style={{ fontSize:11, color:P.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>🧠 น้ำหนักที่เรียนรู้สะสม</div>
              <div style={{ fontSize:11, color:P.muted, marginBottom:12 }}>
                <span style={{ color:P.green }}>■</span> เขียว=ดี &nbsp;<span style={{ color:P.red }}>■</span> แดง=แย่
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:6 }}>
                {[0,1,2,3,4,5].map((pos) => {
                  const color=pos<3?P.accent:P.purple, wMap=weights[pos];
                  const maxAbs=Math.max(1,...Object.values(wMap).map(Math.abs));
                  return (
                    <div key={pos} style={{ background:P.bg, borderRadius:8, padding:"8px 5px" }}>
                      <div style={{ fontSize:9, color, textAlign:"center", marginBottom:6 }}>ตำแหน่ง {pos+1}</div>
                      {[0,1,2,3,4,5,6,7,8,9].map((d) => {
                        const w=wMap[d]||0, bc=w>0?P.green:w<0?P.red:P.border;
                        return (
                          <div key={d} style={{ display:"flex", alignItems:"center", gap:2, marginBottom:2 }}>
                            <span style={{ fontSize:10, fontFamily:"monospace", color:w>0?P.green:w<0?P.red:P.muted, minWidth:10, fontWeight:w!==0?800:400 }}>{d}</span>
                            <div style={{ height:4, borderRadius:2, width:`${(Math.abs(w)/maxAbs)*100}%`, background:bc, minWidth:Math.abs(w)>0?2:0 }} />
                            {Math.abs(w)>0 && <span style={{ fontSize:8, color:bc }}>{w>0?`+${w}`:w}</span>}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Chi-square test */}
            <div style={{ background:P.card, border:`1px solid ${P.border}`, borderRadius:12, padding:16, marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"center", marginBottom:10 }}>
                <div style={{ fontSize:11, color:P.muted, letterSpacing:1, textTransform:"uppercase" }}>🔬 ทดสอบความสุ่ม (Chi-square)</div>
                <button onClick={()=>setShowChiSquare(!showChiSquare)} style={{ marginLeft:"auto", background:P.blue+"22", color:P.blue, border:`1px solid ${P.blue}44`, borderRadius:7, padding:"4px 10px", fontWeight:700, fontSize:11, cursor:"pointer" }}>
                  {showChiSquare ? "ซ่อน" : "ดูผล"}
                </button>
              </div>
              {showChiSquare && (() => {
                const result = chiSquareDigits(rows);
                if (!result) {
                  return <div style={{ fontSize:12, color:P.muted, padding:"8px 0" }}>ต้องการข้อมูลอย่างน้อย 30 งวด (ปัจจุบัน {rows.length} งวด)</div>;
                }
                return (
                  <div>
                    <div style={{ fontSize:12, color:P.muted, marginBottom:10, lineHeight:1.5 }}>
                      ทดสอบว่าเลขในแต่ละตำแหน่งกระจายเท่าเทียมไหม<br/>
                      <span style={{ color: result.allRandom ? P.green : P.red, fontWeight:800 }}>
                        {result.allRandom ? "✓ ทุกตำแหน่งเป็นการสุ่ม" : "⚠ บางตำแหน่งไม่สุ่ม"}
                      </span>
                      <span style={{ color:P.muted }}> (ค่าเฉลี่ย χ² = {result.avgChi2})</span>
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:6 }}>
                      {result.positions.map((p) => (
                        <div key={p.pos} style={{ background:P.bg, borderRadius:8, padding:"8px 4px", textAlign:"center", border:`1px solid ${p.random?P.green:P.red}44` }}>
                          <div style={{ fontSize:9, color:P.muted }}>ตำแหน่ง {p.pos}</div>
                          <div style={{ fontSize:14, fontWeight:900, color:p.random?P.green:P.red, marginTop:2 }}>χ²={p.chi2}</div>
                          <div style={{ fontSize:9, color:p.random?P.green:P.red, marginTop:2 }}>{p.random ? "สุ่ม" : "ไม่สุ่ม"}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize:11, color:P.muted, marginTop:10, padding:"8px 12px", background:P.bg, borderRadius:8, lineHeight:1.5 }}>
                      <div>• χ² &lt; 16.92 = สุ่ม (p &gt; 0.05)</div>
                      <div>• χ² &gt; 16.92 = ไม่สุ่ม (p &lt; 0.05)</div>
                      <div>• สำหรับข้อมูล 0-9 ในแต่ละตำแหน่ง (df=9)</div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* สถิติเฉลี่ย */}
            {totalRounds > 0 && (() => {
              const hits = history.map((h) => getHits(h));
              const sum = hits.reduce((s,v)=>s+v, 0);
              const avg = (sum/history.length).toFixed(2);
              const max = Math.max(...hits);
              const avgNum = parseFloat(avg);
              const better = avgNum > 0.6;

              return (
                <div style={{ background:P.card, border:`1px solid ${P.border}`, borderRadius:12, padding:16, marginBottom:14 }}>
                  <div style={{ fontSize:11, color:P.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}>🧪 สถิติเทียบทฤษฎี</div>
                  <div style={{ fontSize:11, color:P.muted, marginBottom:12 }}>
                    ค่าเฉลี่ยทางทฤษฎี (สุ่มล้วน) = 0.60 ตัว/รอบ
                  </div>
                  <div style={{ background:P.bg, border:`1px solid ${P.accent}33`, borderRadius:8, padding:"10px 12px" }}>
                    <div style={{ display:"flex", alignItems:"center", marginBottom:6 }}>
                      <span style={{ fontSize:12, color:P.accent, fontWeight:800 }}>โหมดปกติ</span>
                      <span style={{ marginLeft:"auto", fontSize:11, color:P.muted }}>{history.length} รอบ</span>
                    </div>
                    <div style={{ display:"flex", gap:14, fontSize:12 }}>
                      <span style={{ color:P.muted }}>เฉลี่ย: <span style={{ color:better?P.green:P.accent, fontWeight:800, fontFamily:"monospace" }}>{avg}</span>
                        <span style={{ color:better?P.green:P.red, fontSize:10, marginLeft:4 }}>
                          {avgNum > 0.6 ? "↑ ดีกว่าสุ่ม" : avgNum < 0.6 ? "↓ ต่ำกว่าสุ่ม" : "= สุ่ม"}
                        </span>
                      </span>
                      <span style={{ color:P.muted }}>สูงสุด: <span style={{ color:P.text, fontFamily:"monospace" }}>{max}</span></span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {history.length>0 && (
              <div style={{ background:P.card, border:`1px solid ${P.border}`, borderRadius:12, padding:16, marginBottom:14 }}>
                <div style={{ display:"flex", alignItems:"center", marginBottom:12 }}>
                  <div style={{ fontSize:11, color:P.muted, letterSpacing:1, textTransform:"uppercase" }}>📋 ประวัติทุกรอบ</div>
                  <button onClick={()=>setShowGraph(true)} style={{ marginLeft:"auto", background:P.accent+"22", color:P.accent, border:`1px solid ${P.accent}44`, borderRadius:7, padding:"4px 10px", fontWeight:700, fontSize:11, cursor:"pointer" }}>
                    📊 ดูกราฟ
                  </button>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {history.map((h,i) => {
                    // รองรับข้อมูลเก่า v22 ที่มี modes
                    const data = h.pred ? h : (h.modes?.normal || {});
                    if (!data.pred) return null;
                    return (
                      <div key={i} style={{ background:P.bg, borderRadius:10, padding:"10px 12px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, flexWrap:"wrap" }}>
                          <span style={{ fontSize:11, color:P.muted, fontWeight:700 }}>{h.date}</span>
                          <span style={{ fontSize:10, color:P.muted }}>จริง: <span style={{ fontFamily:"monospace", color:P.text, fontWeight:700 }}>{(h.actual || []).join(" ")}</span></span>
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:4, flexWrap:"wrap" }}>
                          <div style={{ display:"flex", gap:3 }}>
                            {data.pred.map((d,j) => (
                              <div key={j} style={{ width:22, height:22, borderRadius:"50%",
                                background:h.actual?.[j]===d?P.green+"44":P.red+"22",
                                border:`1.5px solid ${h.actual?.[j]===d?P.green:P.red}66`,
                                display:"flex", alignItems:"center", justifyContent:"center",
                                fontFamily:"monospace", fontWeight:800, fontSize:10,
                                color:h.actual?.[j]===d?P.green:P.red }}>{d}</div>
                            ))}
                          </div>
                          {data.front3Win && <span style={{ fontSize:9, background:P.green+"22", color:P.green, borderRadius:4, padding:"1px 5px" }}>3หน้า✓</span>}
                          {data.back3Win  && <span style={{ fontSize:9, background:P.purple+"22", color:P.purple, borderRadius:4, padding:"1px 5px" }}>3ท้าย✓</span>}
                          {data.back2Win  && <span style={{ fontSize:9, background:P.cyan+"22", color:P.cyan, borderRadius:4, padding:"1px 5px" }}>2ท้าย✓</span>}
                          <span style={{ marginLeft:"auto", fontWeight:800, fontSize:12, color:data.hits>=4?P.green:data.hits>=2?P.accent:P.red }}>{data.hits}/6</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {totalRounds===0 && (
              <div style={{ textAlign:"center", padding:"30px 20px", color:P.muted }}>
                <div style={{ fontSize:36, marginBottom:10 }}>🧠</div>ยังไม่มีข้อมูลการเรียนรู้
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
