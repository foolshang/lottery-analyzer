// ============================================================
// Lottery Analyzer — Version 20
// ============================================================

import { useState, useCallback, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot } from "firebase/firestore";
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
function analyze(rows, hintsFront, hintsBack, lw, mode = "normal") {
  const freqF = buildFreq(rows, 0), freqB = buildFreq(rows, 3);
  const posF  = buildPosFreq(rows, 0), posB  = buildPosFreq(rows, 3);

  let useFront = posF, useBack = posB;
  if (mode === "no_hints") {
    useFront = posF;
    useBack  = posB;
  } else if (mode === "hints_only") {
    // ใช้ hints อย่างเดียว — ตั้ง freq ทุกตัวเป็น 1 เพื่อให้ hints มีผลล้วนๆ
    const flatPos = () => Array.from({length:3}, () => { const o={}; for (let d=0;d<=9;d++) o[d]=1; return o; });
    useFront = boostPosFreq(flatPos(), hintsFront);
    useBack  = boostPosFreq(flatPos(), hintsBack);
  } else {
    useFront = boostPosFreq(posF, hintsFront);
    useBack  = boostPosFreq(posB, hintsBack);
  }

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

function HintRow({ idx, front, back, all, onChangeFront, onChangeBack, onChangeAll, onRemove, onLock, onEnter, dupFront, dupBack, dupAll }) {
  const fd = extractDigits(front).slice(0, 3);
  const bd = extractDigits(back).slice(0, 3);
  const ad = extractDigits(all || "").slice(0, 6);
  const hasData = fd.length > 0 || bd.length > 0 || ad.length > 0;
  const isDup = dupFront || dupBack || dupAll;

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
        <span style={{ fontSize: 10, color: P.muted, marginLeft: 10 }}>(หน้า/หลัง หรือ ทุกตำแหน่ง)</span>
        <button onClick={onRemove} title="ลบชุดนี้" style={{ marginLeft: "auto", background: "transparent", border: "none", color: P.muted, cursor: "pointer", fontSize: 15 }}>✕</button>
      </div>

      <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: dupFront ? P.red : P.accent, marginBottom: 4, textAlign: "center", letterSpacing: 1 }}>
            3 ตัวหน้า{dupFront && " ⚠ ซ้ำ"}
          </div>
          <input value={front} onChange={(e) => onChangeFront(e.target.value)} onKeyDown={handleKey} placeholder="1 2 3" maxLength={5}
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
          <input value={back} onChange={(e) => onChangeBack(e.target.value)} onKeyDown={handleKey} placeholder="4 5 6" maxLength={5}
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

      {/* ช่องทุกตำแหน่ง */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 9, color: dupAll ? P.red : P.green, marginBottom: 4, textAlign: "center", letterSpacing: 1 }}>
          🎲 ทุกตำแหน่ง (1-6 ตัว — boost ทุกตำแหน่ง){dupAll && " ⚠ ซ้ำ"}
        </div>
        <input id={`hint-all-${idx}`} value={all || ""} onChange={(e) => onChangeAll(e.target.value)} onKeyDown={handleKey} placeholder="เช่น 1 5 7" maxLength={11}
          style={{ width: "100%", boxSizing: "border-box",
            background: P.card,
            border: `1px solid ${dupAll ? P.red : P.green}44`,
            borderRadius: 7,
            padding: "8px 10px", color: dupAll ? P.red : P.green,
            fontFamily: "monospace", fontSize: 16, fontWeight: 800,
            letterSpacing: 3, outline: "none", textAlign: "center" }} />
        <div style={{ display: "flex", gap: 4, marginTop: 6, justifyContent: "center" }}>
          {[0,1,2,3,4,5].map((p) => {
            const offset = 6 - ad.length;
            const dIdx = p - offset;
            const digit = (dIdx >= 0 && dIdx < ad.length) ? ad[dIdx] : undefined;
            return <MiniDot key={p} n={digit} color={dupAll ? P.red : P.green} filled={digit !== undefined} />;
          })}
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
                ad.length > 0 && `ทุกตำแหน่ง ${ad.length}`,
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

function PrizeInput({ label, color, value, onChange, maxLen, placeholder, slots }) {
  const digits = extractDigits(value).slice(0, maxLen);
  return (
    <div style={{ background: P.bg, border: `1px solid ${color}33`, borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
      <div style={{ fontSize: 10, color, fontWeight: 700, marginBottom: 7, letterSpacing: 1 }}>{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLen + 2}
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
  const [hints,   setHints]   = useState([{ front: "", back: "", all: "" }]);
  const [lockedHints, setLockedHints] = useState([]);  // ชุดที่ถูกล็อกไว้
  // Learning แยกตามโหมด
  const [weightsAll, setWeightsAll] = useState({
    normal:     initWeights(),
    no_hints:   initWeights(),
    hints_only: initWeights(),
  });
  const [history, setHistory] = useState([]);

  const [results,   setResults]   = useState(null);  // { normal, no_hints, hints_only }
  const [lastPreds, setLastPreds] = useState(null);  // { normal, no_hints, hints_only }
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
  const [graphType,  setGraphType]  = useState("full");
  const [graphMode,  setGraphMode]  = useState("normal");
  const [showChiSquare, setShowChiSquare] = useState(false);
  const [dupHighlight, setDupHighlight] = useState({ left: new Set(), lockedSide: {} });

  const getSnapshot = useCallback(() => ({
    data: histRaw, hints, lockedHints, weightsAll, history,
    lastPredictions: lastPreds,
    lastResults: results,
    updatedAt: new Date().toISOString(),
  }), [histRaw, hints, lockedHints, weightsAll, history, lastPreds, results]);

  const applySnapshot = (snap) => {
    if (!snap) return;
    if (snap.data    !== undefined) setHistRaw(snap.data);
    if (snap.hints   !== undefined) setHints(snap.hints);
    if (snap.lockedHints !== undefined) setLockedHints(snap.lockedHints);
    if (snap.weightsAll !== undefined) setWeightsAll(snap.weightsAll);
    else if (snap.weights !== undefined) {
      setWeightsAll({
        normal:     snap.weights,
        no_hints:   initWeights(),
        hints_only: initWeights(),
      });
    }
    if (snap.history !== undefined) setHistory(snap.history);
    if (snap.lastPredictions) {
      setLastPreds(snap.lastPredictions);
      if (snap.lastResults) { setResults(snap.lastResults); setTab("result"); }
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
        if (snap.exists()) { applySnapshot(snap.data()); setSyncStatus("synced"); }
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
      try {
        await setDoc(doc(db, "lottery", DOC_ID), snap);
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

  const addHint    = () => setHints((h) => [...h, { front:"", back:"", all:"" }]);
  const removeHint = (i) => setHints((h) => h.filter((_,j) => j!==i));
  const updateHint = (i,f,v) => setHints((h) => h.map((x,j) => j===i ? {...x,[f]:v} : x));

  // กด Enter ในชุดที่ idx → เพิ่มชุดใหม่ ถ้ายังไม่มีชุดถัดไป
  // คืน index ของชุดที่ควร focus
  const handleHintEnter = (idx) => {
    setHints((prev) => {
      if (idx === prev.length - 1) {
        return [...prev, { front:"", back:"", all:"" }];
      }
      return prev;
    });
    // focus ที่ช่อง "all" ของชุดถัดไป
    setTimeout(() => {
      const nextInput = document.getElementById(`hint-all-${idx+1}`);
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
      const aA = extractDigits(a.all || "").slice(0,6);
      const bF = extractDigits(b.front).slice(0,3);
      const bB = extractDigits(b.back).slice(0,3);
      const bA = extractDigits(b.all || "").slice(0,6);
      // เช็คหน้าซ้ำ
      if (aF.length > 0 && aF.length === bF.length && aF.every((v,i) => v === bF[i])) {
        dups.push({ aIdx, bIdx, side: "front", digits: aF.join("") });
      }
      // เช็คหลังซ้ำ
      if (aB.length > 0 && aB.length === bB.length && aB.every((v,i) => v === bB[i])) {
        dups.push({ aIdx, bIdx, side: "back", digits: aB.join("") });
      }
      // เช็คทุกตำแหน่งซ้ำ
      if (aA.length > 0 && aA.length === bA.length && aA.every((v,i) => v === bA[i])) {
        dups.push({ aIdx, bIdx, side: "all", digits: aA.join("") });
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
    const ad = extractDigits(target.all || "").slice(0,6);
    if (fd.length === 0 && bd.length === 0 && ad.length === 0) return;

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
    if (ad.length > 0) {
      lockedHints.forEach((lh, j) => {
        const la = extractDigits(lh.all || "").slice(0,6);
        if (la.length === ad.length && la.every((v,i) => v === ad[i])) {
          dups.push({ side: "all", digits: ad.join(""), lockedIdx: j });
        }
      });
    }
    if (dups.length > 0) {
      const sideName = (s) => s === "front" ? "หน้า" : s === "back" ? "หลัง" : "ทุกตำแหน่ง";
      const lines = dups.map((d) => `• ชุดที่ ${idx+1} ซ้ำกับชุดที่ล็อก #${d.lockedIdx+1} (${sideName(d.side)} = ${d.digits})`);
      setError(`⚠ พบข้อมูลซ้ำ ${dups.length} จุด — แก้ก่อนล็อก:\n${lines.join("\n")}`);
      setDupHighlight({ left: new Set([idx]), lockedSide: dups.reduce((acc,d)=>{ acc[d.lockedIdx]=d.side; return acc; }, {}) });
      setTimeout(() => setError(""), 6000);
      return;
    }

    setLockedHints((prev) => [...prev, target]);
    setHints((h) => h.filter((_, j) => j !== idx));
    setTimeout(() => {
      setHints((h) => h.length === 0 ? [{ front:"", back:"", all:"" }] : h);
    }, 0);
    setSaveMsg("🔒 ล็อกแล้ว"); setTimeout(() => setSaveMsg(""), 2000);
    setDupHighlight({ left: new Set(), lockedSide: {} });
  };

  // ปลดล็อกทั้งหมด (ลบฝั่งขวา)
  const unlockAll = () => {
    if (lockedHints.length === 0) return;
    setLockedHints([]);
    setSaveMsg("🔓 ปลดล็อกแล้ว"); setTimeout(() => setSaveMsg(""), 2000);
  };

  // ลบชุดล็อกเฉพาะชุด
  const removeLockedHint = (idx) => {
    setLockedHints((prev) => prev.filter((_, j) => j !== idx));
    setSaveMsg("🔓 ปลดล็อกชุดที่ "+(idx+1)+" แล้ว"); setTimeout(() => setSaveMsg(""), 2000);
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
    const ad = extractDigits(h.all || "").slice(0, 6);

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

    // ช่อง "ทุกตำแหน่ง" — ทุกเลขที่ใส่ boost ทุกตำแหน่ง
    ad.forEach((d) => {
      hintsFront.push({ digits:[d,d,d], offsetPositions:[0,1,2] });
      hintsBack.push ({ digits:[d,d,d], offsetPositions:[0,1,2] });
    });
  });
  const totalHints = allHintsForAnalyze.filter((h) => h.front.trim()||h.back.trim()||(h.all||"").trim()).length;

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

    // วิเคราะห์ทั้ง 3 โหมด
    const resNormal   = analyze(rows, hintsFront, hintsBack, weightsAll.normal,     "normal");
    const resNoHints  = analyze(rows, hintsFront, hintsBack, weightsAll.no_hints,   "no_hints");
    const resHintsOnly = (hintsFront.length === 0 && hintsBack.length === 0)
      ? null
      : analyze(rows, hintsFront, hintsBack, weightsAll.hints_only, "hints_only");

    const allResults = { normal: resNormal, no_hints: resNoHints, hints_only: resHintsOnly };
    const allPreds = {
      normal:   [...resNormal.front,  ...resNormal.back],
      no_hints: [...resNoHints.front, ...resNoHints.back],
      hints_only: resHintsOnly ? [...resHintsOnly.front, ...resHintsOnly.back] : null,
    };

    setResults(allResults); setLastPreds(allPreds); setComparison(null);
    setPrizeFull(""); setPrizeFront3(["",""]); setPrizeBack3(["",""]); setPrizeBack2("");
    setHints([{ front: "", back: "", all: "" }]);
    setAnimKey((k) => k+1); setTab("result");
    saveAll({
      lastPredictions: allPreds,
      lastResults: allResults,
      hints: [{ front: "", back: "", all: "" }],
    });
  }, [rows, hintsFront, hintsBack, weightsAll, saveAll, lockedHints, hints]);

  const handleSubmitActual = () => {
    if (!lastPreds) return;
    const fullDigits = extractDigits(prizeFull).slice(0, 6);
    if (fullDigits.length < 6) return;

    const front3Sets = prizeFront3.map((v) => extractDigits(v).slice(0,3)).filter((d) => d.length === 3);
    const back3Sets  = prizeBack3.map((v)  => extractDigits(v).slice(0,3)).filter((d) => d.length === 3);
    const back2Arr   = extractDigits(prizeBack2).slice(0, 2);

    const prizes = { full: fullDigits, front3: front3Sets, back3: back3Sets, back2: back2Arr };

    const modes = ["normal", "no_hints", "hints_only"];
    const cmpByMode = {};
    const newWeightsAll = { ...weightsAll };

    modes.forEach((m) => {
      if (!lastPreds[m]) return;
      cmpByMode[m] = buildComparison(lastPreds[m], prizes);
      newWeightsAll[m] = adjustWeights(weightsAll[m], lastPreds[m], fullDigits);
    });

    // สร้างประวัติ — เก็บผลทุกโหมดในรอบเดียวกัน
    const entry = {
      date: new Date().toLocaleDateString("th-TH"),
      actual: fullDigits,
      modes: {},
    };
    modes.forEach((m) => {
      if (!cmpByMode[m] || !lastPreds[m]) return;
      const ent = { pred: [...lastPreds[m]], hits: cmpByMode[m].hits6 };
      if (front3Sets.length > 0) {
        ent.front3Entered = true;
        ent.front3Win = cmpByMode[m].front3Results.some((r) => r.win);
        ent.front3Hits = cmpByMode[m].front3Results.map((r) => r.hits);
      }
      if (back3Sets.length > 0) {
        ent.back3Entered = true;
        ent.back3Win = cmpByMode[m].back3Results.some((r) => r.win);
        ent.back3Hits = cmpByMode[m].back3Results.map((r) => r.hits);
      }
      if (back2Arr.length === 2) {
        ent.back2Entered = true;
        ent.back2Win = cmpByMode[m].back2Result?.win || false;
        ent.back2Hits = cmpByMode[m].back2Result?.hits || 0;
      }
      entry.modes[m] = ent;
    });

    const newHist = [entry, ...history].slice(0, 50);
    const newRaw = histRaw.trim() ? histRaw.trim()+"\n"+fullDigits.join(" ") : fullDigits.join(" ");

    setWeightsAll(newWeightsAll); setHistory(newHist); setHistRaw(newRaw);
    setResults(null); setLastPreds(null); setComparison(null);
    setPrizeFull(""); setPrizeFront3(["",""]); setPrizeBack3(["",""]); setPrizeBack2("");
    setTab("data");
    saveAll({ weightsAll: newWeightsAll, history: newHist, data: newRaw, lastPredictions: null, lastResults: null });
  };

  const totalRounds   = history.length;
  // helper: ดึง hits ของโหมด normal เพื่อใช้ในสถิติทั่วไป
  const getHits = (h, mode = "normal") => h.modes?.[mode]?.hits ?? h.hits ?? 0;
  const avgHits = totalRounds ? (history.reduce((s,h)=>s+getHits(h), 0)/totalRounds).toFixed(2) : "—";
  const perfectRounds = history.filter((h)=>getHits(h)===6).length;

  return (
    <div style={{ minHeight:"100vh", background:P.bg, color:P.text, fontFamily:"'Segoe UI',sans-serif", padding:"16px 12px" }}>
      <input ref={importRef} type="file" accept=".xlsx,.xls,.csv,.txt" onChange={handleImport} style={{ display:"none" }} />

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
          <div style={{ fontSize:10, letterSpacing:4, color:P.accent, textTransform:"uppercase", marginBottom:4 }}>Adaptive Probability Engine v20</div>
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
            <textarea value={histRaw} onChange={(e)=>setHistRaw(e.target.value)} rows={8}
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
              <input value={newLine} onChange={(e)=>{setNewLine(e.target.value);setAddError("");}}
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
                  const dupAllSet   = new Set();
                  dups.forEach((d) => {
                    if (d.side === "front") { dupFrontSet.add(d.aIdx); dupFrontSet.add(d.bIdx); }
                    if (d.side === "back")  { dupBackSet.add(d.aIdx);  dupBackSet.add(d.bIdx); }
                    if (d.side === "all")   { dupAllSet.add(d.aIdx);   dupAllSet.add(d.bIdx); }
                  });
                  return hints.map((h,i) => (
                    <HintRow key={i} idx={i} front={h.front} back={h.back} all={h.all}
                      onChangeFront={(v)=>updateHint(i,"front",v)}
                      onChangeBack={(v) =>updateHint(i,"back", v)}
                      onChangeAll={(v) =>updateHint(i,"all", v)}
                      onRemove={()=>removeHint(i)}
                      onLock={()=>lockHintAt(i)}
                      onEnter={()=>handleHintEnter(i)}
                      dupFront={dupFrontSet.has(i) || dupHighlight.left.has(i)}
                      dupBack={dupBackSet.has(i) || dupHighlight.left.has(i)}
                      dupAll={dupAllSet.has(i) || dupHighlight.left.has(i)} />
                  ));
                })()}
                <button onClick={() => {
                  setHints((prev) => [...prev, { front:"", back:"", all:"" }]);
                  setTimeout(() => {
                    const el = document.getElementById(`hint-all-${hints.length}`);
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
                      const ad = extractDigits(h.all || "").slice(0,6);
                      const hlSide = dupHighlight.lockedSide[i];
                      const hlFront = hlSide === "front";
                      const hlBack  = hlSide === "back";
                      const hlAll   = hlSide === "all";
                      const isHl    = hlFront || hlBack || hlAll;
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
                          {(fd.length > 0 || bd.length > 0) && (
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
                          )}
                          {ad.length > 0 && (
                            <div style={{ marginTop: (fd.length>0||bd.length>0) ? 8 : 0, textAlign:"center" }}>
                              <div style={{ fontSize:9, color: hlAll ? P.red : P.green, marginBottom:3 }}>🎲 ทุกตำแหน่ง</div>
                              <div style={{ display:"flex", gap:3, justifyContent:"center" }}>
                                {[0,1,2,3,4,5].map((p) => {
                                  const offset = 6 - ad.length;
                                  const dIdx = p - offset;
                                  const digit = (dIdx >= 0 && dIdx < ad.length) ? ad[dIdx] : undefined;
                                  return <MiniDot key={p} n={digit} color={hlAll ? P.red : P.green} filled={digit !== undefined} />;
                                })}
                              </div>
                            </div>
                          )}
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
                  ⏳ ผลจาก 3 โหมด — ใส่ผลจริงครั้งเดียวตรวจครบทั้ง 3 โหมด
                </div>
              )}

              {/* แสดงผลทั้ง 3 โหมด */}
              {[
                { key:"normal",     label:"🎯 โหมดปกติ (ข้อมูลหลัก + hints)", color:P.accent },
                { key:"no_hints",   label:"📚 ไม่ใช้ hints (ข้อมูลหลักล้วน)", color:P.blue   },
                { key:"hints_only", label:"💡 ใช้ hints อย่างเดียว",          color:P.purple },
              ].map((m) => {
                const res = results[m.key];
                const pred = lastPreds?.[m.key];
                const cmpMode = comparison?.byMode?.[m.key];
                if (!res || !pred) {
                  if (m.key === "hints_only") {
                    return (
                      <div key={m.key} style={{ background:P.card, border:`1px solid ${m.color}33`, borderRadius:12, padding:14, marginBottom:10, opacity:0.5 }}>
                        <div style={{ fontSize:11, color:m.color, fontWeight:700, marginBottom:6 }}>{m.label}</div>
                        <div style={{ fontSize:12, color:P.muted }}>ไม่ได้ใช้โหมดนี้ — ต้องใส่ข้อมูลเพิ่มเติม (hints)</div>
                      </div>
                    );
                  }
                  return null;
                }
                return (
                  <div key={m.key} style={{ background:P.card, border:`1px solid ${cmpMode ? P.green : m.color}44`, borderRadius:12, padding:14, marginBottom:10 }}>
                    <div style={{ fontSize:11, color:m.color, fontWeight:800, marginBottom:10, letterSpacing:1 }}>
                      {m.label}
                      {cmpMode && <span style={{ marginLeft:8, color:P.green }}>— ถูก {cmpMode.hits6}/6</span>}
                    </div>
                    <div style={{ display:"flex", justifyContent:"center", alignItems:"center", gap:5, flexWrap:"wrap", marginBottom:8 }}>
                      {pred.slice(0,3).map((n,i) => (
                        <Ball key={`f${i}`} n={n} size={40}
                          color={cmpMode ? (cmpMode.cmp[i].hit ? P.green : P.red) : m.color}
                          glow={!cmpMode} />
                      ))}
                      <div style={{ width:2, height:24, background:P.border, borderRadius:2, margin:"0 3px" }} />
                      {pred.slice(3,6).map((n,i) => (
                        <Ball key={`b${i}`} n={n} size={40}
                          color={cmpMode ? (cmpMode.cmp[i+3].hit ? P.green : P.red) : m.color}
                          glow={!cmpMode} />
                      ))}
                    </div>
                    <div style={{ textAlign:"center", fontFamily:"monospace", fontWeight:900, fontSize:18, letterSpacing:3, color:m.color }}>
                      {pred.slice(0,3).join(" ")} <span style={{ color:P.muted, margin:"0 4px" }}>–</span> {pred.slice(3,6).join(" ")}
                    </div>

                    {/* รางวัลย่อยของโหมดนี้ */}
                    {cmpMode && (
                      <div style={{ marginTop:10, display:"flex", gap:5, flexWrap:"wrap", justifyContent:"center" }}>
                        {cmpMode.front3Results.map((r, i) => (
                          <span key={`f3-${i}`} style={{ fontSize:10, padding:"2px 8px", borderRadius:6,
                            background: r.win ? P.green+"33" : P.border, color: r.win ? P.green : P.muted, border:`1px solid ${r.win?P.green:P.border}` }}>
                            3หน้า#{i+1}: {r.hits}/3 {r.win && "✓"}
                          </span>
                        ))}
                        {cmpMode.back3Results.map((r, i) => (
                          <span key={`b3-${i}`} style={{ fontSize:10, padding:"2px 8px", borderRadius:6,
                            background: r.win ? P.purple+"33" : P.border, color: r.win ? P.purple : P.muted, border:`1px solid ${r.win?P.purple:P.border}` }}>
                            3ท้าย#{i+1}: {r.hits}/3 {r.win && "✓"}
                          </span>
                        ))}
                        {cmpMode.back2Result && (
                          <span style={{ fontSize:10, padding:"2px 8px", borderRadius:6,
                            background: cmpMode.back2Result.win ? P.cyan+"33" : P.border,
                            color: cmpMode.back2Result.win ? P.cyan : P.muted,
                            border:`1px solid ${cmpMode.back2Result.win?P.cyan:P.border}` }}>
                            2ท้าย: {cmpMode.back2Result.hits}/2 {cmpMode.back2Result.win && "✓"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <div style={{ fontSize:11, color:P.muted, textAlign:"center", marginBottom:14 }}>
                วิเคราะห์จาก {results.normal?.total || 0} งวด
                {!comparison && (
                  <button onClick={handleAnalyze} style={{ marginLeft:10, background:"transparent", color:P.muted, border:`1px solid ${P.border}`, borderRadius:8, padding:"4px 12px", fontWeight:600, fontSize:11, cursor:"pointer" }}>🔄 วิเคราะห์ใหม่</button>
                )}
              </div>

              {/* ใส่ผลจริง */}
              {!comparison ? (
                <div style={{ background:P.card, border:`1px solid ${P.orange}55`, borderRadius:12, padding:16, marginBottom:14 }}>
                  <div style={{ fontSize:11, color:P.orange, letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}>📝 ใส่ผลจริงที่ออก</div>
                  <div style={{ fontSize:12, color:P.muted, marginBottom:12 }}>
                    ใส่ครั้งเดียว — ระบบตรวจให้ทั้ง 3 โหมดอัตโนมัติ
                  </div>

                  <PrizeInput label="🏆 รางวัลที่ 1 — 6 ตัว (บังคับ)" color={P.accent}
                    value={prizeFull} onChange={setPrizeFull}
                    maxLen={6} placeholder="เช่น 351297" slots={6} />

                  <div style={{ fontSize:11, color:P.green, fontWeight:700, margin:"10px 0 6px", letterSpacing:1 }}>
                    🎯 3 ตัวหน้า (ใส่ได้ 1–2 ชุด)
                  </div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    {[0,1].map((i) => (
                      <div key={i} style={{ flex:1, minWidth:140 }}>
                        <PrizeInput
                          label={`ชุดที่ ${i+1}`} color={P.green}
                          value={prizeFront3[i]}
                          onChange={(v) => setPrizeFront3((prev) => { const n=[...prev]; n[i]=v; return n; })}
                          maxLen={3} placeholder="เช่น 351" slots={3} />
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
                          label={`ชุดที่ ${i+1}`} color={P.purple}
                          value={prizeBack3[i]}
                          onChange={(v) => setPrizeBack3((prev) => { const n=[...prev]; n[i]=v; return n; })}
                          maxLen={3} placeholder="เช่น 297" slots={3} />
                      </div>
                    ))}
                  </div>

                  <div style={{ fontSize:11, color:P.cyan, fontWeight:700, margin:"10px 0 6px", letterSpacing:1 }}>
                    🎯 2 ตัวท้าย (ใส่ได้ 1 ชุด)
                  </div>
                  <PrizeInput label="ชุดที่ 1" color={P.cyan}
                    value={prizeBack2} onChange={setPrizeBack2}
                    maxLen={2} placeholder="เช่น 97" slots={2} />

                  <button onClick={() => {
                    // คำนวณ comparison ทุกโหมดสำหรับการแสดงทันที (จะถูก submit ใน handleSubmitActual)
                    const fullDigits = extractDigits(prizeFull).slice(0, 6);
                    if (fullDigits.length < 6) return;
                    const front3Sets = prizeFront3.map((v) => extractDigits(v).slice(0,3)).filter((d) => d.length === 3);
                    const back3Sets  = prizeBack3.map((v)  => extractDigits(v).slice(0,3)).filter((d) => d.length === 3);
                    const back2Arr   = extractDigits(prizeBack2).slice(0, 2);
                    const prizes = { full: fullDigits, front3: front3Sets, back3: back3Sets, back2: back2Arr };
                    const byMode = {};
                    ["normal","no_hints","hints_only"].forEach((m) => {
                      if (lastPreds?.[m]) byMode[m] = buildComparison(lastPreds[m], prizes);
                    });
                    setComparison({ byMode, prizes });
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
              const mn = (h) => h.modes?.normal || h;
              const front3Wins  = history.filter((h) => mn(h).front3Win === true).length;
              const back3Wins   = history.filter((h) => mn(h).back3Win  === true).length;
              const back2Wins   = history.filter((h) => mn(h).back2Win  === true).length;
              const front3Total = history.filter((h) => mn(h).front3Entered === true).length;
              const back3Total  = history.filter((h) => mn(h).back3Entered  === true).length;
              const back2Total  = history.filter((h) => mn(h).back2Entered  === true).length;
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

            {history.slice(0,5).length>0 && (
              <div style={{ background:P.card, border:`1px solid ${P.border}`, borderRadius:12, padding:16, marginBottom:14 }}>
                <div style={{ fontSize:11, color:P.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:12 }}>📈 5 รอบล่าสุด (โหมดปกติ)</div>
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
              <div style={{ display:"flex", alignItems:"center", marginBottom:8, flexWrap:"wrap", gap:6 }}>
                <div style={{ fontSize:11, color:P.muted, letterSpacing:1, textTransform:"uppercase" }}>🧠 น้ำหนักที่เรียนรู้สะสม</div>
                <div style={{ marginLeft:"auto", display:"flex", gap:4 }}>
                  {[
                    { key:"normal",     label:"ปกติ",      color:P.accent },
                    { key:"no_hints",   label:"noH",      color:P.blue   },
                    { key:"hints_only", label:"Honly",    color:P.purple },
                  ].map((m) => (
                    <button key={m.key} onClick={()=>setGraphMode(m.key)}
                      style={{ fontSize:10, padding:"3px 8px", borderRadius:6,
                        background: graphMode===m.key ? m.color+"33" : "transparent",
                        color: graphMode===m.key ? m.color : P.muted,
                        border:`1px solid ${graphMode===m.key ? m.color : P.border}`,
                        cursor:"pointer", fontWeight:700 }}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ fontSize:11, color:P.muted, marginBottom:12 }}>
                <span style={{ color:P.green }}>■</span> เขียว=ดี &nbsp;<span style={{ color:P.red }}>■</span> แดง=แย่
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:6 }}>
                {[0,1,2,3,4,5].map((pos) => {
                  const color=pos<3?P.accent:P.purple, wMap=(weightsAll[graphMode] || weightsAll.normal)[pos];
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

            {/* สถิติแยกตามโหมด */}
            {totalRounds > 0 && (() => {
              const stat = (mode) => {
                const arr = history.filter((h) => h.modes?.[mode]);
                if (!arr.length) return { count:0, avg:"—", max:"—" };
                const hits = arr.map((h) => h.modes[mode].hits);
                const sum = hits.reduce((s,v)=>s+v, 0);
                return { count: arr.length, avg: (sum/arr.length).toFixed(2), max: Math.max(...hits) };
              };
              const sN = stat("normal");
              const sNo = stat("no_hints");
              const sHo = stat("hints_only");

              return (
                <div style={{ background:P.card, border:`1px solid ${P.border}`, borderRadius:12, padding:16, marginBottom:14 }}>
                  <div style={{ fontSize:11, color:P.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}>🧪 เปรียบเทียบโหมดทดลอง</div>
                  <div style={{ fontSize:11, color:P.muted, marginBottom:12 }}>
                    ค่าเฉลี่ยทางทฤษฎี (สุ่มล้วน) = 0.60 ตัว/รอบ
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {[
                      { label:"ปกติ",                  color:P.accent, s:sN },
                      { label:"ไม่ใช้ hints",           color:P.blue,   s:sNo },
                      { label:"ใช้ hints อย่างเดียว",   color:P.purple, s:sHo },
                    ].map((m) => {
                      const avgNum = parseFloat(m.s.avg);
                      const better = !isNaN(avgNum) && avgNum > 0.6;
                      return (
                        <div key={m.label} style={{ background:P.bg, border:`1px solid ${m.color}33`, borderRadius:8, padding:"10px 12px" }}>
                          <div style={{ display:"flex", alignItems:"center", marginBottom:6 }}>
                            <span style={{ fontSize:12, color:m.color, fontWeight:800 }}>{m.label}</span>
                            <span style={{ marginLeft:"auto", fontSize:11, color:P.muted }}>{m.s.count} รอบ</span>
                          </div>
                          <div style={{ display:"flex", gap:14, fontSize:12 }}>
                            <span style={{ color:P.muted }}>เฉลี่ย: <span style={{ color:better?P.green:m.color, fontWeight:800, fontFamily:"monospace" }}>{m.s.avg}</span>
                              {!isNaN(avgNum) && <span style={{ color:better?P.green:P.red, fontSize:10, marginLeft:4 }}>
                                {avgNum > 0.6 ? "↑ ดีกว่าสุ่ม" : avgNum < 0.6 ? "↓ ต่ำกว่าสุ่ม" : "= สุ่ม"}
                              </span>}
                            </span>
                            <span style={{ color:P.muted }}>สูงสุด: <span style={{ color:P.text, fontFamily:"monospace" }}>{m.s.max}</span></span>
                          </div>
                        </div>
                      );
                    })}
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
                    // legacy support: ถ้าไม่มี modes ให้ใช้ entry ตรงๆ
                    const modesData = h.modes || { normal: h };
                    return (
                      <div key={i} style={{ background:P.bg, borderRadius:10, padding:"10px 12px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, flexWrap:"wrap" }}>
                          <span style={{ fontSize:11, color:P.muted, fontWeight:700 }}>{h.date}</span>
                          <span style={{ fontSize:10, color:P.muted }}>จริง: <span style={{ fontFamily:"monospace", color:P.text, fontWeight:700 }}>{(h.actual || []).join(" ")}</span></span>
                        </div>
                        {/* แสดงผลแต่ละโหมด */}
                        {[
                          { key:"normal",     label:"ปกติ",  color:P.accent },
                          { key:"no_hints",   label:"noH",   color:P.blue },
                          { key:"hints_only", label:"Honly", color:P.purple },
                        ].map((m) => {
                          const md = modesData[m.key];
                          if (!md || !md.pred) return null;
                          return (
                            <div key={m.key} style={{ display:"flex", alignItems:"center", gap:6, marginTop:4, flexWrap:"wrap" }}>
                              <span style={{ fontSize:10, color:m.color, fontWeight:700, minWidth:46, padding:"2px 6px", background:m.color+"22", borderRadius:4, textAlign:"center" }}>{m.label}</span>
                              <div style={{ display:"flex", gap:3 }}>
                                {md.pred.map((d,j) => (
                                  <div key={j} style={{ width:22, height:22, borderRadius:"50%",
                                    background:h.actual?.[j]===d?P.green+"44":P.red+"22",
                                    border:`1.5px solid ${h.actual?.[j]===d?P.green:P.red}66`,
                                    display:"flex", alignItems:"center", justifyContent:"center",
                                    fontFamily:"monospace", fontWeight:800, fontSize:10,
                                    color:h.actual?.[j]===d?P.green:P.red }}>{d}</div>
                                ))}
                              </div>
                              {md.front3Win && <span style={{ fontSize:9, background:P.green+"22", color:P.green, borderRadius:4, padding:"1px 5px" }}>3หน้า✓</span>}
                              {md.back3Win  && <span style={{ fontSize:9, background:P.purple+"22", color:P.purple, borderRadius:4, padding:"1px 5px" }}>3ท้าย✓</span>}
                              {md.back2Win  && <span style={{ fontSize:9, background:P.cyan+"22", color:P.cyan, borderRadius:4, padding:"1px 5px" }}>2ท้าย✓</span>}
                              <span style={{ marginLeft:"auto", fontWeight:800, fontSize:12, color:md.hits>=4?P.green:md.hits>=2?P.accent:P.red }}>{md.hits}/6</span>
                            </div>
                          );
                        })}
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
