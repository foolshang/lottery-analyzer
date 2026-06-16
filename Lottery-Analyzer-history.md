# Lottery-Analyzer-history.md — ประวัติการพัฒนา Lottery Analyzer ฉบับสมบูรณ์

> ไฟล์นี้บันทึก **ทุกการสนทนา + การถามตอบ + การแก้ไขโค้ด** ระหว่างผู้ใช้ (foolshang) กับ Claude
> ตั้งแต่ v1 ถึง v25 เพื่อให้ Claude/Code ในอนาคตเข้าใจบริบทเต็มของโปรเจกต์
> ครอบคลุม 4 session: 2026-05-10, 2026-05-14, 2026-05-25, 2026-06-06

---

## 📋 สารบัญ

1. [ข้อมูลโปรเจกต์ (Quick Reference)](#ข้อมูลโปรเจกต์)
2. [ข้อตกลงการทำงาน](#ข้อตกลงการทำงาน)
3. [Session 1: v1-v9 — สร้างพื้นฐาน + Learning](#session-1)
4. [Session 2: v10-v18 — Firebase Deploy + ฟีเจอร์](#session-2)
5. [Session 3: v8-v19 — 3 โหมด + Chi-square + Lock](#session-3)
6. [Session 4: v20-v25 — GitHub Actions + Sync + Log](#session-4)
7. [Session 5: Claude Code Integration + ดึง myhora](#session-5)
8. [Session 6: ออกแบบฟีเจอร์สี + ระบบอัตโนมัติ Discord](#session-6)
9. [สรุประบบทั้งหมด](#สรุประบบ)
10. [บทเรียน/ปัญหาที่เคยเจอ](#บทเรียน)

---

## ข้อมูลโปรเจกต์

**โปรเจกต์:** เว็บแอปวิเคราะห์ความน่าจะเป็นเลขลอตเตอรี่ 6 หลัก (0-9) เขียนด้วย React deploy บน Firebase

| รายการ | ค่า |
|--------|-----|
| URL เว็บ | https://lottary-d8ebd.web.app |
| Firebase Project ID | lottary-d8ebd |
| Project Number | 6424789017 |
| Google Account | foolshang.live@gmail.com |
| GitHub Repo (Private) | https://github.com/foolshang/lottery-analyzer |
| GitHub Username | foolshang |
| Service Account | firebase-adminsdk-fbsvc@lottary-d8ebd.iam.gserviceaccount.com |
| Cloud Shell folder | ~/lottery-app |
| Main file | src/App.jsx |
| Firestore | collection "lottery" / document "shared_data" / subcollection "logs/" |
| localStorage key | lottery_v7 |
| Database location | asia-southeast3 |

**Firebase config:**
```
apiKey: AIzaSyBI4Fg5Sh7vt3X2TINBy6vEnYYWQV2KV8Q
appId: 1:6424789017:web:aba84dd2960e5ede432a88
storageBucket: lottary-d8ebd.firebasestorage.app
messagingSenderId: 6424789017
authDomain: lottary-d8ebd.firebaseapp.com
```

**Firestore Rules (ปัจจุบัน):**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /lottery/{docId} {
      allow read, write: if true;
      match /logs/{logId} {
        allow read, write: if true;
      }
    }
  }
}
```

---

## ข้อตกลงการทำงาน

ข้อตกลงสำคัญที่ผู้ใช้กำหนด (สะสมจากหลาย session):

1. **ต้องยืนยันก่อนเขียนโค้ดทุกครั้ง** — สรุปความเข้าใจ + ถามคำถามให้ชัด (รูปแบบ A/B/C) แล้วรอ "เขียนเลย" / "ทำเลย" ก่อนเริ่ม (กำหนดใน Session 3)
2. **ตั้งชื่อไฟล์เป็น lottery-app-vN.jsx** — เพิ่มเลข version ทุกครั้ง
3. **ใส่ CHANGELOG ที่หัวไฟล์** — ระบุ + เพิ่ม / - ลบ / ~ แก้ไข
4. **แสดง version ที่ header เว็บ** ("ADAPTIVE PROBABILITY ENGINE vN")
5. **สร้าง 2 ไฟล์:** lottery-app-vN.jsx (โค้ด) + lottery-reference.md (เอกสาร)
6. **สื่อสารภาษาไทย กระชับ** — ตอบสั้น ชอบรูปแบบ A/B/C
7. **เวลาแก้โค้ดใน Google Cloud ใช้ Open Editor + Ctrl+F** ค้นหา (กำหนดใน Session 2)
8. **แปลภาษาอังกฤษ/อื่นเป็นไทย** ถ้าผู้ใช้เอามาลง

---

## แนวคิดหลักของโปรเจกต์ (ผู้ใช้อธิบายเอง)

> "ข้อมูลหลักมันเป็นผลรางวัลที่ออกมาก่อน และ ข้อมูลเสริมมันเป็นสถิติของคนซื้อเลขในงวดนั้นๆ
> ที่ทำเพื่อจะดูว่าการวิเคราะห์ด้วยข้อมูลในอดีตกับข้อมูลสถิติในปัจจุบัน จะออกมาตรงมากน้อยแค่ไหน
> ทำเพื่อความอยากรู้"

- เป็น **การทดลองวิทยาศาสตร์** ไม่ใช่ทำนายเพื่อชนะลอตเตอรี่
- ผู้ใช้เข้าใจว่าลอตเตอรี่ **สุ่มจริง ~99%** ยอมรับผลทั้งสองทาง
- ค่าคาดหวังถ้าสุ่มล้วน = 0.6 ตัว/รอบ
- Hints = สถิติความนิยมของคนซื้อ
- ทดสอบว่า "ข้อมูลอดีต + ความเชื่อ" ทำนายผลได้ไหม

---

<a name="session-1"></a>
# Session 1 (2026-05-10): v1-v9 — สร้างพื้นฐาน + Learning

## คำขอแรก
**[ผู้ใช้]** "เราสามารถเก็บชุดตัวเลขเป็นข้อมูล แล้วเขียนโปรแกรมความน่าจะเป็นเพื่อเดาชุดตัวเลขได้ไหม"

**[Claude]** อธิบายว่าความน่าจะเป็นไม่สามารถ "ทำนาย" เลขแน่นอนได้ แค่บอกว่าเลขไหนมีแนวโน้มออกบ่อยกว่าจากอดีต → สร้าง **lottery-probability.jsx** (v1)
- วิเคราะห์ความถี่แต่ละเลข, หาคู่เลขที่ออกด้วยกัน (pair frequency), แนะนำชุดเลขแบบ weighted random
- ใช้ palette สีเข้ม + ลูกบอลเลข

## วิวัฒนาการ v1 → v9

### v1 — Pair Frequency Analyzer
- ใส่ชุดเลขหลายงวด → วิเคราะห์ความถี่ + คู่เลข → สุ่มแนะนำ 5 ชุด
- เลขใดๆ (ไม่จำกัด 0-9)

### v2 — เพิ่ม "ล็อกเลขที่รู้แล้ว" (3-step flow)
**[ผู้ใช้]** "ถ้ามีข้อมูลในอดีต และมีการใส่ชุดตัวเลขเข้าไปทีหลังอีกรอบก่อนจะหาความน่าจะเป็น ได้ไหม"
- เพิ่มขั้นตอน: ใส่ข้อมูลอดีต → ล็อกเลขที่รู้ → วิเคราะห์
- 3 step: input / lock / results

### v3 — เลขหลักเดียว 0-9
**[ผู้ใช้]** "ทำให้ตัวเลขเป็นเลขหลักเดียว"
- กรองเฉพาะ 0-9, ปุ่มกดเลือกเลขแทนพิมพ์

### v4 — 6 ตัว แบ่งหน้า 3 + หลัง 3
**[ผู้ใช้]** "เลขหลักเดียวตั้งแต่ 0-9 และ 1 แถวมีตัวเลข 6 ตัว การใส่ข้อมูลเพิ่มเติมจะเป็นการใส่ตัวเลขข้างหน้า 3 หลัก ข้างหลัง 3 หลัก โดยไม่จำเป็นว่าจะใส่ครบ"
- โครงสร้างหลัก: 6 ตัว = หน้า 3 + หลัง 3
- วิเคราะห์แยกตามตำแหน่ง (positional frequency)

### v5 — ใส่ข้อมูลต่อเนื่อง + วิเคราะห์ได้ผล 1 ชุด
**[ผู้ใช้]** "ไม่ใช้การล็อกตัวเลข แต่เป็นการใส่ข้อมูลเพิ่มเติม สามารถใส่ได้เรื่อยๆ จนกว่าจะกดวิเคราะห์ เมื่อกดแล้วแสดง 1 ชุดเท่านั้น"
- textarea หลัก + ช่องเพิ่มทีละชุด (Enter/ปุ่ม +)
- กดวิเคราะห์ → ได้ผล 1 ชุด (หน้า 3 – หลัง 3)

### v6 — บันทึก/โหลด + รับเลขติดกัน
**[ผู้ใช้]** "เอา code นี้ไปรันได้ที่ไหน แล้วชุดข้อมูลย้อนหลังใส่ในไหน ใส่ใน excel ได้ไหม... ก็เพิ่มการเซฟมาด้วย"
- **[Claude]** อธิบาย: รันใน Claude artifact / StackBlitz / Node+Vite
- เพิ่ม 💾 บันทึก (localStorage), ⬇ ส่งออก .txt, ⬆ นำเข้า .txt/.csv

**[ผู้ใช้]** "ต้องกดเว้นวรรคระหว่างใส่ตัวเลขตลอด ถ้าใส่ติดกันไม่นับว่าครบ 6 ตัว"
- แก้: รับ `154237` (ติดกัน) → แยกอัตโนมัติ
- ช่องข้อมูลเพิ่มเติมแยก หน้า 3 / หลัง 3 อิสระ

### v7 — ข้อมูลเพิ่มเติมหลายชุด (hints)
**[ผู้ใช้]** "ต้องเพิ่มการที่สามารถใส่ข้อมูลได้หลายชุด เพราะข้อมูลเพิ่มเติมอาจจะมีหลายชุด"
- กด "+ เพิ่มชุด" เพิ่ม hint ได้เรื่อยๆ, ปุ่ม ✕ ลบ
- แต่ละชุด boost น้ำหนัก +3 ให้เลขในตำแหน่งนั้น

### v8 — Excel import (.xlsx) เต็มรูปแบบ
**[ผู้ใช้]** "สามารถโหลดไฟล์ excel เข้ามาได้ไหม รูปแบบไฟล์เป็นแบบไหน"
- เพิ่ม SheetJS อ่าน .xlsx/.xls โดยตรง
- รองรับ 2 แบบ: ช่องเดียว (154237) หรือ แยก 6 คอลัมน์
- ปุ่ม ❓ แสดงตัวอย่างรูปแบบ Excel
- ส่งออก .xlsx 6 คอลัมน์

### ปัญหา file dialog ใน Artifact
**[ผู้ใช้]** "ทำไมนำเข้า txt กดแล้วไม่ขึ้นให้อัพโหลดไฟล์"
- **[Claude]** Artifact ไม่อนุญาต file dialog จาก `<input>` ที่ซ่อนใน `<label>` → แก้เป็น useRef trigger

### คำถามเรื่อง deploy
- **[ผู้ใช้]** ถามเรื่องทำ .exe → **[Claude]** อธิบาย Electron + electron-builder
- **[ผู้ใช้]** ถามรันใน VS Code → ได้ ใช้ Terminal
- **[ผู้ใช้]** "ตัวโปรแกรมนี้ให้น้ำหนักไปทางไหน" → **[Claude]** อธิบาย 2 ส่วน: ความถี่ตามตำแหน่ง + hints (+3)

### v9 — ระบบ Learning (จุดเปลี่ยนสำคัญ)
**[ผู้ใช้]** "มันสามารถเรียนรู้ได้ไหม และมีการปรับน้ำหนัก ถ้าทำให้โปรแกรมมีการตรวจสอบคำตอบ"
- **[Claude]** อธิบายแนวคิด Reward/Penalty
- **[ผู้ใช้]** "ใส่ผลจริง คือเราใส่เองใช่ไหม" → ใช่ ใส่เองหลังผลออก

**ระบบที่เพิ่ม:**
1. หลังวิเคราะห์ → ใส่ผลจริง 6 ตัว → กดยืนยัน
2. เปรียบเทียบทีละตำแหน่ง ✓/✗
3. ปรับน้ำหนักอัตโนมัติ (ถูก +, ผิด -)
4. ผลจริงถูกเพิ่มเข้าข้อมูลหลักทันที
5. แท็บสถิติ: รอบที่เรียนรู้ / เฉลี่ยถูก / ถูกครบ 6 / กราฟ 5 รอบล่าสุด / Heatmap น้ำหนัก / ประวัติ

### แสดงผลค้างจนยืนยัน
**[ผู้ใช้]** "ให้แสดงผลจนกว่าจะยืนยันผลลัพธ์จริง"
- ผลวิเคราะห์ค้างอยู่จนกว่าใส่ผลจริง+ยืนยัน ถึงเคลียร์

### จบ Session 1
**[ผู้ใช้]** "เอาไปใส่ใน Google Cloud ได้ไหม" → เริ่มคุยเรื่อง deploy (ต่อ Session 2)

---

<a name="session-2"></a>
# Session 2 (2026-05-14): v10-v18 — Firebase Deploy + Sync + ฟีเจอร์

## Deploy ขึ้น Google Cloud / Firebase

**[ผู้ใช้]** "เพิ่มการ sync ข้ามเครื่อง"
**[Claude]** ต้องใช้ Firebase Firestore + API key จริง — Claude artifact เชื่อม Firebase จริงไม่ได้

### ขั้นตอน setup (ผ่าน Cloud Shell ในมือถือ/เว็บ)
ผู้ใช้มี Google Cloud แบบเสียเงินอยู่แล้ว ทำผ่าน **Cloud Shell** ใน browser (ไม่ต้องติดตั้งบนเครื่อง)

**ปัญหาที่เจอระหว่าง deploy (เรียงตามจริง):**
- `'FROM' is not recognized` → รัน Dockerfile ตรงๆ ไม่ได้ (เลี่ยงใช้ `--source .`)
- `'npm' is not recognized` → Node.js ยังไม่ติดตั้ง
- ใช้ Cloud Shell แทนเครื่อง local
- `npm error canceled` → npm create vite ถูก cancel
- Firebase init: เลือก existing project
- `Failed to list Firebase projects` → ยังไม่ login → `firebase login`
- `✖ Creating GCP project` → สิทธิ์ไม่พอสร้าง project ใหม่
- `Firebase Management API ยังไม่เปิด` ใน project `lottary` → เปิด API
- เจอ project `pybot-bottrade-binance` + สร้าง `lottary-d8ebd`
- Login as foolshang.live@gmail.com
- 🎉 **Deploy สำเร็จ** → https://lottary-d8ebd.web.app

### ตั้งค่า Firebase
- **[ผู้ใช้]** "Anonymous เป็น mail เราได้ไหม" → ใช้ Google Sign-in
- เพิ่ม Web App ใน Firebase Console → ได้ config
- เปิด Authentication → Google sign-in method
- สร้าง Firestore database
- **[Claude]** แก้โค้ดให้มีหน้า Login ด้วย Google (signInWithPopup + GoogleAuthProvider)
- **[ผู้ใช้]** "sync แล้ว" 🎉

### ข้อตกลง: ใช้ Open Editor + Ctrl+F
**[ผู้ใช้]** "ต่อไปเวลาแก้ไขโค้ดใน google cloud ให้ใช้ open editor นะ จะได้ค้นหาสิ่งที่แก้ไขได้ง่ายด้วย ctrl+f"

## ปัญหาใหญ่: leading zeros + CRLF (ดีบักยาวมาก)

**[ผู้ใช้]** "อัพโหลดไฟล์ txt แล้วข้อมูลไม่ตรง ข้อมูลมี 24 แต่ขึ้นแสดง 22" + "เลข 0 นำหน้าตัดออก"

**สาเหตุ 2 อย่าง:**
1. **CRLF (Windows line ending)** → split ไม่ทำงาน อ่านเป็นบรรทัดเดียว
   - แก้: `split(/\r?\n+/)`
2. **Leading zeros หาย** → `extractDigits` แปลงเป็น Number ก่อน ทำให้ "053581" → 53581
   - แก้: split ตัวอักษรก่อน map(Number) — `parseLine` ใช้ `.split("").map(Number)`

**กระบวนการดีบัก** (ผ่านหลายรอบ — ใช้ console fetch ทดสอบ):
- `fetch('').then(r=>r.text()).then(t=>console.log(t.split(/\r?\n/).length))` → ได้ 14/24
- พบว่า `parseSheetRows` ถูกเรียกก่อน `parseLine` สำหรับ .txt → return เร็วเกินไป
- ลบ `parseSheetRows` ออกจากการอ่าน .txt
- **[ผู้ใช้]** "ได้ 24 งวดแล้ว" 🎉

**บทเรียน:** ต้อง copy ไฟล์ใหม่ก่อน build เสมอ (`cp ~/lottery-probability.jsx ~/lottery-app/src/App.jsx`) — หลายครั้งแก้โค้ดแล้วลืม copy ทำให้ build เก่า

## เพิ่มการตรวจสอบรางวัลย่อย (multi-prize)

**[ผู้ใช้]** "เพิ่มการตรวจสอบ ให้มีการตรวจสอบเลข 3 ตัวหน้า และ 3 ตัวท้าย และ 2 ตัวท้าย" + "ตรงทั้งตัวเลขและตำแหน่ง"

**สรุปสเปก (ผู้ใช้อธิบายหลายรอบจนชัด):**
- ผลออกงวดเดียวกันมีหลายรางวัล: 6 ตัว 1 ชุด, 3 ตัวหน้า 2 ชุด, 3 ตัวท้าย 2 ชุด, 2 ตัวท้าย 1 ชุด
- **ไม่บังคับใส่ครบ** — ใส่เฉพาะที่มี (ข้อมูลเก่าอาจมีแค่ 6 ตัว)
- ตรวจเฉพาะตัวที่ใส่ — ไม่ใส่ = ไม่ตรวจ = ไม่นับในสถิติ
- เทียบแบบ exact match (ตรงทั้งเลขและตำแหน่ง)

**กฎสำคัญที่ผู้ใช้ยืนยัน:**
- ผล 6 ตัวที่ยืนยัน → บันทึกเข้าข้อมูลหลักอัตโนมัติ
- **ปรับน้ำหนัก (learning) จากผล 6 ตัวอย่างเดียว** เท่านั้น (รางวัลย่อยแค่เก็บสถิติ ไม่ learning)
- รอบที่ไม่ได้ใส่ → ไม่นับในสถิติ

## Claude 4.7 ตรวจโค้ด 4.6
**[ผู้ใช้]** "อยากให้ claude 4.7 ตรวจสอบโค้ดของ claude 4.6 ว่าเขียนเป็นอย่างไง" → "แก้เลย"
- พบบั๊ก 2 จุด + แก้

## จุดเปลี่ยน: ตั้งชื่อ version + แยกไฟล์
**[ผู้ใช้]** "ถ้ากด new chat แต่ถามเรื่องในนี้ ยังตอบต่อเนื่องได้ไหม" → **[Claude]** ไม่ได้
**[ผู้ใช้]** "อยากให้พวกโค้ด และวิธีอัปโหลดโค้ด เขียนลงไปใน artifact เพราะถ้าคุยเยอะๆ ต้องเลื่อนหานาน"
- เริ่มสร้าง **lottery-app-v7.jsx** (ใส่เลข version ในชื่อไฟล์)
- แยก 2 ไฟล์: โค้ด + reference

**คำสั่ง deploy มาตรฐาน (4 บรรทัด):**
```bash
cp ~/lottery-probability.jsx ~/lottery-app/src/App.jsx
cd ~/lottery-app
npm run build
firebase deploy
```


---

<a name="session-3"></a>
# Session 3 (2026-05-25): v8-v19 — 3 โหมด + Chi-square + Lock System

## คำถามเชิงแนวคิดเรื่อง Learning (สำคัญมาก)

**[ผู้ใช้]** "ทำไมตัวเลขที่ไม่ตรงกันถึงเป็น +2 มันควรจะ -2 และ +2 ควรเป็นเลขที่ตรงกันอย่างเดียวไม่ใช่หรอ"

**สรุปกฎ Learning (หลังคุยกันหลายรอบจนเข้าใจตรงกัน):**
- เลขที่ออกจริง **และตรงตำแหน่ง** ที่ทาย → +น้ำหนัก
- เลขที่ออกจริง **แต่ไม่ตรงตำแหน่ง** ที่ทาย → +น้ำหนัก (เพราะออกจริง)
- เลขที่ทาย **แต่ผิด และไม่ได้ออกจริง** → -น้ำหนัก
- LEARN_RATE = 2, MAX_W = ±20

**[ผู้ใช้]** ถามเรื่องเพดาน ±20 → ±50:
- **[Claude]** ±20 vs ±50 ต่างกันแต่ไม่ใหญ่มาก, แนะนำคง ±20 (ปลอดภัย ไม่ติด pattern ผิด)
- เพดานที่ทำให้ระบบ "ตาย" = หลัก 100+ (เลขเดียว domin ทุกอย่าง)

## คำถามเรื่องสถิติ 50 รอบ
**[ผู้ใช้]** "สถิติเก็บแค่ 50 เกินนั้นลบแล้วจะ learning อย่างไง"
- **[Claude]** "ประวัติ" (history 50 รอบ) กับ "Learning" (weights สะสม) เป็นคนละอย่าง
- weights สะสมตลอด ไม่หาย, history เก็บ 50 รอบล่าสุดเพื่อแสดงผล

## v10 — กราฟ popup 50 รอบ
**[ผู้ใช้]** "ประวัติ 50 รอบแสดงเป็นกราฟไม่ได้หรอ... แกนตั้งจำนวนที่ตรงกัน 0-6 แนวนอนจำนวนสถิติ 0-50 เอาเป็นหน้าต่างแยกออกมา ในประวัติทุกรอบมีปุ่มกดแล้วแสดงกราฟ"
- เพิ่มปุ่มในประวัติ → เปิด popup กราฟแท่ง (Y=0-6, X=50 รอบ)

## v11 — สถิติรางวัลย่อย
**[ผู้ใช้]** "ในการใส่ผลจริงมีการใส่ 3 ตัวหน้า 3 ตัวท้าย 2 ตัวท้ายด้วย แต่ไม่ได้เอาไว้ใช้เรียนรู้ อยากให้เอามาเทียบสถิติด้วย"
- เก็บ hits ของรางวัลย่อยใน history + กราฟเลือกประเภทได้ (6/3หน้า/3ท้าย/2ท้าย)

## คำถามปรัชญา: สุ่มจริงหรือมี pattern
**[ผู้ใช้]** "ถ้ามีตัวเลขออกตรงกัน 6 ตัว 2 ครั้งขึ้น เพราะมี pattern หรือเพราะข้อมูลเสริมดี"
- **[Claude]** ถูกครบ 6 ตัว 2 ครั้ง = โชค + hints ดี เกือบ 100% ไม่ใช่ pattern
- ลอตเตอรี่ไทย = สุ่มจริง ไม่มี pattern ทางคณิตศาสตร์

**[ผู้ใช้]** "มั่นใจได้อย่างไรว่าสุ่ม" → **[Claude]** มั่นใจ 99% แต่ไม่ใช่ 100%

**[ผู้ใช้]** อธิบายเป้าหมายโปรเจกต์ (ดูหัวข้อ "แนวคิดหลัก") → **[Claude]** "นี่เป็นการทดลองวิทยาศาสตร์ ไม่ใช่ทำนายเพื่อชนะ"

## v12 — 4 โหมดทดสอบ + Chi-square
**[ผู้ใช้]** "ทำทั้ง 3 อย่าง เพิ่มใช้ hints อย่างเดียวด้วย" + "ทดสอบ Chi-square อัตโนมัติ"
- โหมด: normal / no_hints / hints_only
- Chi-square test (auto, 30+ rows, df=9, critical 16.92 ที่ p=0.05)

## v13 — กดครั้งเดียวได้ทั้ง 3 โหมด (refactor ใหญ่)
**[ผู้ใช้]** "ทำให้กดครั้งเดียวได้ทั้ง 3 โหมด... Learning แยก 3 โหมด ใส่เลขตรวจสอบครั้งเดียวตรวจทั้ง 3 โหมด แสดงในหน้าเดียว"
- เปลี่ยน weights → weightsAll {normal, no_hints, hints_only}
- handleAnalyze คำนวณทั้ง 3 โหมดพร้อมกัน
- handleSubmitActual ตรวจครบ 3 โหมด
- history เก็บ entry.modes.{normal/no_hints/hints_only}
- getHits() helper ดึง hits จากโหมด normal
- Heatmap, ประวัติ, กราฟ — รองรับ 3 โหมด

## v14 — ปุ่ม "+ เพิ่มชุด" อยู่ล่างเสมอ
**[ผู้ใช้]** "ปุ่มเพิ่มชุดให้อยู่ข้างล่างข้อมูลล่าสุดเสมอ เพราะใส่ข้อมูลเยอะๆ ต้องเลื่อนขึ้นบนกดตลอด"

## v15 — hints ช่องเดียวใส่ที่ไหนก็ได้
**[ผู้ใช้]** "ปรับ hints ไม่ต้องแยกหน้าหลัง แต่แยกตามการใส่ ถ้าใส่ข้างหน้าก็เป็น 3 ตัวหน้า ถ้าใส่หลังก็ 3 ตัวหลัง"
- HintRow 2 ช่อง (หน้า/หลัง) ดูเหมือนแถวเดียวต่อกัน

## v16 — Lock system (ฝั่งซ้าย active / ฝั่งขวา locked)
**[ผู้ใช้]** "ใส่ข้อมูลเพิ่มเติมใส่การล็อกตัวเลขไว้ได้ แล้วกดวิเคราะห์ให้ย้ายข้อมูลที่ล็อกไปรวมทางขวา ปลดล็อกกดครั้งเดียวได้เลย" + "ฝั่งขวาให้ล็อกทั้งฝั่ง ไม่ใช่ทีละตัว"
- เพิ่ม state lockedHints
- ฝั่งซ้าย = active (แก้ได้), ฝั่งขวา = locked
- ปลดล็อก = ลบทิ้งเลย (ไม่ย้ายกลับ)
- ใช้ทั้ง locked + active ในการวิเคราะห์

## ⭐ ข้อตกลงสำคัญ: ยืนยันก่อนเขียนโค้ด
**[ผู้ใช้]** "ต่อไปนี้ต้องยืนยันกับผมก่อนเริ่มเขียนโค้ดนะ"
**[Claude]** รับทราบ — ก่อนเขียน/แก้โค้ดทุกครั้งจะสรุปความเข้าใจ + ถามให้ชัด + รอยืนยัน

## v17 — ระบบเช็คซ้ำ (duplicate detection)
**[ผู้ใช้]** "เพิ่มระบบตรวจสอบข้อมูลซ้ำ เมื่อมีข้อมูลซ้ำให้ขึ้นแจ้งเตือน"

**สรุปสเปก (คุยหลายรอบ):**
- เช็คซ้ำแยกฝั่ง: หน้าเทียบหน้า, หลังเทียบหลัง (ไม่ข้ามช่อง)
- เกณฑ์ซ้ำ: ความยาวเท่ากัน + เลขเหมือนกันทุกตำแหน่ง
- กดวิเคราะห์ → เช็คเฉพาะฝั่งซ้าย (ขวาล็อกแล้วไม่ซ้ำอยู่แล้ว)
- ตอนล็อก → เช็คเหมือนกดวิเคราะห์
- ถ้าซ้ำ → ไฮไลต์แดง + แจ้งเตือน

## v18 — แก้ใส่ hint ไม่ครบ 3 ตัว
**[ผู้ใช้]** "ถ้าใส่ 2 ตัวท้าย มันจะไม่คิดเป็น 2 ตัวท้าย คิดเป็น 3 ตัวท้ายที่มีเลขแค่ 2"

**กฎ boost ที่สรุป (สำคัญ — ใช้มาถึง v25):**
- หน้า 1 ตัว → boost ทั้ง 6 ตำแหน่ง (pos 1-6)
- หน้า 2 ตัว → pos 1,2
- หน้า 3 ตัว → pos 1,2,3
- หลัง 1 ตัว → boost ทั้ง 6 ตำแหน่ง
- หลัง 2 ตัว → pos 5,6
- หลัง 3 ตัว → pos 4,5,6
- **[ผู้ใช้]** "มีแต่ 1 ตัวที่ใช้กับทุกตำแหน่ง"

## v19 — จุดชิดขวา + ปุ่มกุญแจแต่ละชุด
**[ผู้ใช้]** เห็นปัญหา: ใส่ "123" จุดแสดง • • • (ขวาว่าง) ควรเป็น 1 2 3
- เรียงจุดชิดขวา (1 ตัว → `• • 5`)
- เพิ่ม removeLockedHint (ปุ่มกุญแจคลิกได้แต่ละชุดฝั่งขวา)

## เริ่มคุย v20 (ต่อ Session 4)
**[ผู้ใช้]** "ถ้าให้ข้อมูลเสริมไม่ต้องแยกหน้าหลัง ใส่แล้ววิเคราะห์ทุกตำแหน่ง มีความเห็นอย่างไร" → ทำแบบ B + เพิ่มช่อง "ทุกตำแหน่ง" + Enter


---

<a name="session-4"></a>
# Session 4 (2026-06-06): v20-v25 — GitHub Actions + Real-time Sync + Log

## v20 — ช่อง "ทุกตำแหน่ง" (all) + Enter
**[ผู้ใช้]** "ทำแบบ B และเพิ่มการกด Enter เท่ากับเพิ่มข้อมูลใหม่ และ cursor ขึ้นพร้อมให้ใส่ในช่อง boost ทุกตำแหน่ง"
- เปลี่ยน hint schema → `{front, back, all}`
- ช่อง "🎲 ทุกตำแหน่ง" (1-6 ตัว boost ทุกตำแหน่ง pos 1-6)
- Enter ในช่อง → เพิ่มชุดใหม่

## v21 — ลบช่อง "ทุกตำแหน่ง" + Enter navigation
**[ผู้ใช้]** ต้องการลบช่องทุกตำแหน่งออก, Enter ใน hints → ชุดใหม่ focus ที่ 3 หลัง, Enter ในผลจริง → เลื่อนช่องถัดไป
- ลบ "all" ออกหมด (schema, snapshot, boost, dup check)
- Enter ใน hints → ชุดใหม่ที่ช่อง 3 หลัง
- Enter ในผลจริง → ลำดับ 6→3หน้า#1→3หน้า#2→3หลัง#1→3หลัง#2→2หลัง→submit
- กฎ B: Enter หยุดถ้าช่องใส่ไม่ครบ

## v22 — กรอง input + ปุ่ม Log
**[ผู้ใช้]** "ทำให้ใส่ได้แค่ตัวเลขเท่านั้น และเพิ่มปุ่มโหลด log ในการวิเคราะห์"
- กรอง input รับเฉพาะ 0-9 (+ space ใน hint, + newline ใน textarea), inputMode="numeric"
- helper: filterDigitsSpace, filterDigitsSpaceNewline
- ปุ่ม Log มุมขวาบนหน้าผลวิเคราะห์ + popup + ดาวน์โหลด .txt
- Log มีรายละเอียด: freq top3, weights ทุกโหมด, hints, predictions, stats

## v23 — ลบ 2 โหมด เหลือโหมดเดียว
**[ผู้ใช้]** (ดูภาพ) "เก็บปกติไว้ที่เหลือเอาออก เพราะปกติค่าเฉลี่ยดีกว่า รองลงมาคือ hints แล้วย้ายปุ่มดาวน์โหลด log มาไว้หน้าสถิติ และมีถูก 3 ตัวกับ 2 คิดว่าไง"
- **[Claude]** ตอบ Q1: ระบบถูกต้องแล้ว — ลอตเตอรี่จ่ายต้องครบทั้งชุด ไม่จ่ายตามจำนวนตัว (ผู้ใช้แค่ถามความเห็น ไม่เปลี่ยน)
- ลบ no_hints + hints_only เหลือแค่ normal (เฉลี่ยดีสุด 0.72)
- weightsAll → weights (single)
- ย้ายปุ่ม Log → หน้าสถิติ (มีทั้งดู + ดาวน์โหลด)
- Log แสดงโหมดเดียว
- migration: รองรับข้อมูลเก่า v22 (entry.modes.normal → flat, weightsAll.normal → weights)

## v24 — Log ใน Firestore subcollection + Export CSV
**[ผู้ใช้]** "Log เก็บข้อมูลทั้งหมด หรือเก็บปัจจุบันครั้งเดียว" → คุยเรื่องเก็บ log

**การถามตอบเรื่อง storage (สำคัญ):**
- **[ผู้ใช้]** ถามขนาดข้อมูลแต่ละแบบ → **[Claude]** อธิบาย A: localStorage/Firestore, B: CSV, C: TXT ใหญ่
- **[ผู้ใช้]** "เก็บใน google drive หรือ one drive ได้ไหม" → **[Claude]** OneDrive API ยุ่งยาก (ต้อง Microsoft login), แนะนำ Firestore
- **[ผู้ใช้]** "One drive เก็บได้ 1 tb ใช้ไป 7%" → **[Claude]** OneDrive ต้องเพิ่ม Microsoft login ซับซ้อน
- **[ผู้ใช้]** ถาม Firestore document limit → **[Claude]** 1 MB/document, ~400 logs; subcollection ไม่จำกัด
- **[ผู้ใช้]** ดู Firestore Console เห็น shared_data มีแค่ field "data" (hints/weights/history หาย!)
- **[ผู้ใช้]** "ถ้า Q1 เก็บ firestore แล้วจะ autodownload ไปทำไม Q3 .csv นายอ่านได้ไหม"
- **[Claude]** Firestore แทน cloud อยู่แล้ว ไม่ต้อง autodownload; Claude อ่าน .csv ได้ทุกฟอร์แมต
- **[ผู้ใช้]** ".csv มันทำแบบ excel ได้ไหม" / "ไม่ได้ให้ทำเป็น excel แต่ให้ .csv ทำแบบ excel"
- **[Claude]** .csv เป็น text ล้วน ไม่มี format แต่ Excel เปิดได้
- **[ผู้ใช้]** "อันไหนเอามาให้นายวิเคราะห์ดีสุด" → **[Claude]** .csv ดีสุด

**ข้อสรุป Q1=A subcollection, Q2=B มีปุ่มดู+ดาวน์โหลด, Q3=.csv key-value ละเอียด**

**สิ่งที่ทำ:**
- เก็บ log ทุกรอบใน Firestore subcollection "logs/" (addDoc, ไม่จำกัด)
- imports: collection, addDoc, getDocs, orderBy, query, serverTimestamp
- saveLogToFirestore() — บันทึกตอน handleSubmitActual
- exportLogsCsv() — ดึงทุก log → CSV key-value 3 คอลัมน์ (รอบ/หัวข้อ/ข้อมูล) + BOM (Excel อ่านไทยถูก)
- ปุ่มหน้าสถิติ: 👁️ ดู Log ล่าสุด + 📊 Export .csv ทุกรอบ
- ลบปุ่มดาวน์โหลด .txt เก่า
- **ต้องอัปเดต Firestore rule เพิ่ม nested match /logs/{logId}**

**log structure แต่ละ document:** date, time, roundNumber, rowsCount, prediction, actual, hits, freqTop3 (6 ตำแหน่ง), weightsBefore (6 ตำแหน่ง), hintsUsed, hintsCount, front3/back3/back2 win+hits, createdAt (serverTimestamp)

## v25 — Real-time Sync + Lock save bug (ดีบักยาว)

### ปัญหา sync (ผู้ใช้รายงาน)
**[ผู้ใช้]** "ข้อมูลไม่ sync กัน ระหว่างมือถือกับคอม ผลวิเคราะห์ยังรอยืนยันทั้งที่ยืนยันในมือถือแล้ว และการใส่ข้อมูลเพิ่มเติมไม่เก็บ มีข้อมูลล็อกไว้พอปิดเปิดใหม่ข้อมูลหาย"

### การดีบัก (ใช้ console + screenshots)
1. ดู Firestore: shared_data มีแค่ field "data" — hints/weights/history/lockedHints/lastPredictions หายหมด
   - สาเหตุ: setDoc overwrite ทั้ง document + applySnapshot partial overwrite
2. เช็ค localStorage คอม: ครบ! (data 8975 chars/~718 งวด, hints 1, history 50, weights 6, lastPredictions 6, updatedAt 2026-05-31)
3. มือถือ: ไม่มีข้อมูล (Q1=B) — ไม่เคย sync ลงไป
4. Recovery: ผู้ใช้กดปุ่ม 💾 บันทึก ในคอม → push localStorage → Firestore สำเร็จ
5. ข้อมูลพื้นฐาน (data/history/weights) sync ได้ แต่ lastPredictions/lastResults ไม่ sync

### การแก้ v25
- onSnapshot listener (มีอยู่แล้ว แต่ applySnapshot บัค)
- saveAll ใช้ `setDoc(..., {merge: true})` — ไม่ลบ field
- applySnapshot รองรับ null: `if ("lastPredictions" in snap)` แทน `if (snap.lastPredictions)` — ยืนยันผลแล้ว null ก็ apply (เคลียร์ prediction)
- lastSaveAt ref — กัน loop (ข้าม remote snapshot ภายใน 2 วินาทีหลัง save ตัวเอง)
- fromRemote flag — ไม่สลับ tab อัตโนมัติเมื่อรับจาก remote

### ปัญหา lock ไม่ save (ผู้ใช้รายงาน)
**[ผู้ใช้]** "เลขที่ล็อกไว้ เวลารีเฟรชแล้วหาย" / "✓ บันทึกและ Sync แล้ว จะขึ้นเมื่อกดบันทึก ถ้าไม่กดมันจะไม่ขึ้น ไหนบอกว่ามัน sync อัตโนมัติ"

### การดีบัก lock (ใช้ console + screenshots)
- เช็ค localStorage: lockedHints มีข้อมูล `[{front:"000",back:""}]` แต่เป็นค่าเก่า (กดบันทึก manual)
- ทดสอบ: ใส่ "987" กดล็อก → UI แสดง 987 แต่ localStorage ยังเป็น "000" → **saveAll ไม่ทำงาน**
- รัน `fetch('/assets/index-...js').then(...includes('newLocked'))` → **false** = deploy ยังไม่ใช่ v25 ใหม่
- พบ: **มี 2 ไฟล์ v25** — lottery-app-v25.jsx (เก่า) + lottery-app-v25(2).jsx (ใหม่)
  - workflow `sort -V | tail -n 1` เลือก v25.jsx (เก่า) เพราะเรียงตัวอักษร 25 ก่อน 25(2)
- **แก้: ลบ lottery-app-v25.jsx (เก่า)** → workflow ใช้ v25(2) ที่ถูก
- **[ผู้ใช้]** "ใช้ได้"

### สาเหตุ lock bug + การแก้สุดท้าย
- lockHintAt/unlockAll/removeLockedHint เดิม**ไม่เรียก saveAll()** → state เปลี่ยนแต่ไม่ save
- ครั้งแรกแก้ด้วย `saveAll({lockedHints: newLocked})` แต่ closure อ่าน getSnapshot state เก่า → localStorage ยังเก่า
- **แก้สุดท้าย:** เขียน fullSnap object ตรงๆ (data/hints/lockedHints/weights/history/lastPredictions/lastResults) → localStorage + setDoc(merge:true) ไม่ผ่าน getSnapshot closure

## GitHub Actions Auto-Deploy (setup ใน Session 4)

**[ผู้ใช้]** "ต้องการเมื่อมีโค้ด version ใหม่ ให้ทำอัตโนมัติในการอัปโหลดเข้า google cloud... มี version ใหม่ deploy อัตโนมัติ"
- เลือกใช้ **GitHub** (ฟรี, เก็บประวัติทุกเวอร์ชัน, private ได้)

### Workflow (.github/workflows/deploy.yml)
- Node 22
- ตรวจ version ล่าสุด: `LATEST=$(ls versions/lottery-app-v*.jsx 2>/dev/null | sort -V | tail -n 1)`
- `cp "$LATEST" src/App.jsx`
- npm install/build
- deploy: FirebaseExtended/action-hosting-deploy@v0, channelId:live, projectId:lottary-d8ebd, secret FIREBASE_SERVICE_ACCOUNT

### Service Account roles (4)
Firebase Authentication Admin, Firebase Hosting Admin, API Keys Viewer, Service Account User

### Workflow ผู้ใช้ deploy (ปัจจุบัน)
1. ดาวน์โหลด lottery-app-vN.jsx จาก Claude
2. Upload → https://github.com/foolshang/lottery-analyzer/upload/main/versions (ใช้ mobile browser โหมด Desktop site — GitHub mobile app ไม่มี upload)
3. Commit "Update to vN"
4. Auto deploy 1-2 นาที
5. Hard refresh (Ctrl+Shift+R)

### ปัญหา setup GitHub (แก้หมดแล้ว)
- PAT token ต้องมี scope: **repo + workflow** (workflow scope จำเป็นเพื่อแก้ .github/workflows/)
- Token ใส่เป็น password ตอน git push; credential.helper store เก็บไว้
- push แรกไฟล์หาย → `git push -f origin main`
- web-edit README สร้าง divergent commit → `git pull origin main --rebase` แล้ว push
- force push ลบ workflow file → สร้างใหม่ด้วย `cat > .github/workflows/deploy.yml << 'EOF'` heredoc
- 403 "firebasehosting.sites.update" → เพิ่ม Firebase Hosting Admin role
- Node 20 deprecation → เปลี่ยน Node 22
- **DUPLICATE FILE BUG:** upload v25 ซ้ำ → v25.jsx + v25(2).jsx; sort -V เลือกตัวเก่า → ลบตัวเก่า
- README.md line break → ใช้ blank line หรือ 2 trailing spaces; ใช้ bullet list


---

<a name="สรุประบบ"></a>
# สรุประบบทั้งหมด (v25 ปัจจุบัน)

## ฟีเจอร์ครบทั้งหมด

1. **ใส่ข้อมูล:** textarea (กรอง digit+space+newline), เพิ่มทีละชุด (Enter), import .txt/.csv/.xlsx, export .txt/.xlsx
   - format: split `/\r?\n+/`, leading zeros เก็บไว้ (split chars แล้ว map Number)
2. **กรอง input:** เฉพาะตัวเลข, inputMode="numeric", filterDigitsSpace/filterDigitsSpaceNewline
3. **Hints + Lock:** ซ้ายแก้ได้ (🔒 ล็อกแต่ละแถว), ขวาล็อกแล้ว (🔓 ปลดแต่ละแถว + "ปลดล็อก" รวม); เช็คซ้ำ (ความยาว+เลข+ตำแหน่ง แยกหน้า-หน้า/หลัง-หลัง); ไฮไลต์แดง real-time; จุดชิดขวา
4. **Enter navigation:** hints → ชุดใหม่ที่ 3 หลัง; ผลจริง → เลื่อนตามลำดับ หยุดถ้าไม่ครบ
5. **โหมดเดียว (normal):** data + hints + learning
6. **ตรวจรางวัลหลายแบบ:** 6 ตัว (บังคับ exact), 3 หน้า (0-2 ชุด), 3 ท้าย (0-2 ชุด), 2 ท้าย (0-1 ชุด)
7. **Learning:** LEARN_RATE=2, MAX_W=±20, จากผล 6 ตัวเท่านั้น, ปรับ ±2
8. **สถิติ:** เฉลี่ย/สูงสุด/จำนวน เทียบ baseline 0.6
9. **Chi-square:** auto, 30+ rows, df=9, critical 16.92 (p=0.05)
10. **กราฟ modal:** แท่ง รอบล่าสุด, สลับ 6/3หน้า/3ท้าย/2ท้าย
11. **Log modal:** รายละเอียดโหมดเดียว (freq top3, weights, hints, prediction, stats)
12. **Firestore logs subcollection** (ไม่จำกัด) + Export CSV (key-value, BOM)
13. **Real-time sync:** onSnapshot, merge:true, anti-loop lastSaveAt ref
14. **Google Sign-in:** signInWithPopup + GoogleAuthProvider
15. **History 50 รอบ:** entry มี pred/hits/front3Win/back3Win/back2Win; migration getHits(h)=h.hits ?? h.modes?.normal?.hits ?? 0

## กฎ Boost (ไม่เปลี่ยนตั้งแต่ v18)
- หน้า 1 ตัว → ทุก pos 1-6 (หน้า+หลัง); หน้า 2 → pos 1,2; หน้า 3 → pos 1,2,3
- หลัง 1 ตัว → ทุก pos 1-6; หลัง 2 → pos 5,6; หลัง 3 → pos 4,5,6
- โค้ดใน App component (allHintsForAnalyze.forEach สร้าง hintsFront/hintsBack ด้วย offsetPositions)

## กฎ Learning
- เลขออกจริง+ตรงตำแหน่ง → +2
- เลขออกจริง+ไม่ตรงตำแหน่ง → +2
- เลขทายผิด+ไม่ออกจริง → -2
- เพดาน ±20

## คำสั่งเช็ค/ดีบักที่ใช้บ่อย
```bash
# เช็ค version ใน Cloud Shell
grep "Version" ~/lottery-app/src/App.jsx | head -2

# inspect localStorage (browser console)
JSON.parse(localStorage.getItem('lottery_v7'))

# เคลียร์ app data
localStorage.removeItem('lottery_v7'); location.reload();

# เช็คว่า deploy โค้ดใหม่จริง
fetch('/assets/index-...js').then(r=>r.text()).then(t=>console.log(t.includes('คำที่ต้องการหา')))
```

---

<a name="บทเรียน"></a>
# บทเรียน/ปัญหาที่เคยเจอ (สำคัญสำหรับอนาคต)

## 1. Build/Deploy
- **ต้อง copy ไฟล์ใหม่ก่อน build เสมอ** — ลืม copy = build เก่า (เจอหลายครั้ง)
- **Duplicate file bug:** upload ชื่อซ้ำ → GitHub สร้าง vN(2).jsx; `sort -V` เลือกตัวเก่า → ต้องลบตัวเก่าหรือ Replace
- เช็คว่า deploy โค้ดใหม่จริงด้วย fetch + includes() คำเฉพาะในโค้ดใหม่

## 2. React state/closure
- **saveAll ใช้ getSnapshot closure อ่าน state เก่า** — เมื่อเรียกทันทีหลัง setState
- แก้: เขียน fullSnap object ตรงๆ ไม่ผ่าน closure

## 3. Firestore sync
- **setDoc overwrite ทั้ง document** → ใช้ {merge: true}
- **applySnapshot ต้องรองรับ null** — `if ("field" in snap)` ไม่ใช่ `if (snap.field)`
- **anti-loop:** lastSaveAt ref ข้าม remote snapshot ที่เพิ่ง write เอง
- document limit 1 MB → log เก็บใน subcollection (ไม่จำกัด)

## 4. ไฟล์/ข้อมูล
- **CRLF (Windows)** ทำให้ split บรรทัดพัง → `/\r?\n+/`
- **Leading zeros หาย** ถ้าแปลง Number ก่อน → split chars แล้ว map(Number)

## 5. การสื่อสาร
- ผู้ใช้ชอบให้ยืนยันก่อนเขียนโค้ด (A/B/C)
- ผู้ใช้สื่อสารไทย กระชับ
- อธิบายซ้ำหลายรอบจนเข้าใจตรงกันก่อนเขียน (โดยเฉพาะสเปก hints, lock, เช็คซ้ำ)

---

<a name="session-5"></a>
# Session 5 (2026-06-09): Claude Code Integration + ดึงข้อมูลเสริม myhora

## หัวข้อ: ทำ CLAUDE_HISTORY.md ละเอียด
**[ผู้ใช้]** ขอให้ทำ CLAUDE_HISTORY.md ใส่ทุกการพูดคุย + การถามตอบ + การแก้ไข เพื่อส่ง context ให้ Claude Code
- **[Claude]** อ่าน transcript 4 ไฟล์ผ่าน Python parser → เขียนไฟล์นี้ครบ v1-v25

## หัวข้อ: ให้ Claude Code อ่าน + แก้โปรเจกต์
**[ผู้ใช้]** "ให้ claude code อ่านทำไง และทำอย่างไงให้ code อ่านและแก้ไขโปรเจคนี้ได้"
- **[Claude]** อธิบาย: Claude Code อ่านไฟล์ชื่อ **CLAUDE.md** (ไม่ใช่ CLAUDE_HISTORY.md) ที่ root repo อัตโนมัติทุก session; รองรับ import ด้วย `@CLAUDE_HISTORY.md`; ถ้าโค้ดอยู่ GitHub ให้ clone มาที่เครื่องที่มี Claude Code

## หัวข้อ: Claude Code เข้าเว็บกดปุ่มได้ไหม
**[ผู้ใช้]** "ถ้าใช้ claude code สามารถเข้าเว็บ lottary-d8ebd.web.app ได้ไหม เพื่อใส่ตัวเลขข้อมูลเสริม และล็อก"
- **[Claude]** Claude Code (terminal) อย่างเดียวเข้าเว็บกดปุ่มไม่ได้; ต้องต่อกับ **Claude in Chrome** extension (`claude --chrome`) ถึงจะ navigate/click/fill form ได้ โดยใช้ login state ของเบราว์เซอร์; Pro plan ติด Haiku 4.5, browser automation กินโควต้าเยอะ
- **[Claude]** แต่แนะนำว่าไม่จำเป็น เพราะเว็บมี real-time sync อยู่แล้ว; ทางตรงกว่าคือให้ Claude Code **เขียนเข้า Firestore โดยตรง** ผ่าน firebase-admin

## หัวข้อ: เขียน Firestore ตรงๆ (เลือกทางนี้)
**[ผู้ใช้]** เลือก "ให้ Claude Code เขียนเข้า Firestore โดยตรง"
- **[Claude]** อธิบาย: เขียนไป document เดียวกัน (`lottery/shared_data`) → เว็บ onSnapshot รับทันที เหมือนกดในเว็บ; ต้องเขียนแบบ merge กันทับ field อื่น (บั๊กเดียวกับ v25)

**การถามตอบเรื่อง format ข้อมูล:**
- **[ผู้ใช้]** "ข้อมูลที่ต้องใส่ใช้เป็นแบบไหน หน้าเว็บ หรือ .txt"
- **[Claude]** lockedHints = JSON array ของ {front, back}; เสนอไฟล์อ่านเป็น **.txt บรรทัดละชุด รูปแบบ `หน้า,หลัง`**
- **[ผู้ใช้]** ถาม front/back จับคู่ในชุดเดียว (A) หรือแยก (B) → **[ผู้ใช้]** "ตอนเขียนในเว็บ เป็นแบบ A"
- ยืนยัน: **1A** (ใส่ lockedHints เลย/ล็อกทันที) + **2A** (ทับของเดิม replace)

**สิ่งที่ทำ — สร้าง 3 ไฟล์:**
1. `write-hints.js` — Node.js (firebase-admin) อ่าน .txt → เขียน lockedHints เข้า Firestore แบบ merge:true พร้อม updatedAt; มี --dry-run; lazy require firebase-admin (dry-run ไม่ต้องติดตั้ง package); ดึงเฉพาะตัวเลขสูงสุด 3 ตัว/ช่อง; ทับ lockedHints เดิมทั้งหมด
2. `hints-input.txt` — ไฟล์ตัวอย่าง format `หน้า,หลัง`
3. `write-hints-README.md` — คู่มือ setup (npm install firebase-admin, ดาวน์โหลด serviceAccountKey.json, ห้าม commit key, ใส่ .gitignore)

## หัวข้อ: ดึงข้อมูลเสริมจริง myhora (ก้อนใหญ่)
**[ผู้ใช้]** "ไฟล์อ่าน ใช้เว็บเดียวกับที่ทำข้อมูลเลข 6 ตัว ปี 66-68 เปลี่ยนจาก 6 ตัวเป็น 3 ตัวหน้า 3 ตัวหลัง 2 ตัวหลัง"
- **[Claude]** ชี้ว่า lockedHints ออกแบบไว้สำหรับงวดเดียว ปี 66-68 = ~360 ชุด ก้อนใหญ่ ถามว่าต้องการแบบไหน
- **[ผู้ใช้]** "ต้องการให้เป็นข้อมูลเสริมแบบก้อนมหึมา นั่นแหละ เพราะถ้าใช้งวดเดียว มีข้อมูลอีกชุดหนึ่งอยู่แล้ว"

**สิ่งที่ทำ:**
- ดึง myhora.com หน้ารายปี (`result-25YY.aspx`) — มีข้อมูลครบทุกงวดในหน้าเดียว แค่ 3 fetch (2566/2567/2568) ไม่ต้องดึงทีละงวด 72 ครั้ง
- แต่ละงวด myhora แสดง: รางวัลที่ 1 (6 ตัว), เลขหน้า 3 ตัว (2 ชุด), เลขท้าย 3 ตัว (2 ชุด), เลขท้าย 2 ตัว (1 ชุด)
- แปลงเป็น format แบบ A: จับคู่ 3หน้า#1+3หลัง#1 / 3หน้า#2+3หลัง#2 / ,2หลัง = 3 บรรทัด/งวด
- ได้ `hints-input-66-69.txt` รวม **82 งวด = 246 ชุด** (2566=24, 2567=23, 2568=24, 2569=11 ถึงงวด 1 มิ.ย. 2569)
- เริ่มแรกดึง 66-68 (71 งวด/213 ชุด) แล้ว **[ผู้ใช้]** ขอเพิ่มปี 2569 ถึงงวดล่าสุด → ดึง result-2569.aspx เพิ่ม 11 งวด รวมเป็น 246 ชุด
- เก็บ `raw-2566-2569.txt` (ข้อมูลดิบมีรางวัลที่ 1 ครบ เผื่อตรวจสอบ)
- ทดสอบ parse ผ่าน write-hints.js --dry-run → ครบ 246 ชุด ตรง format

**[Claude]** เตือน: 246 ชุดก้อนใหญ่ การเช็คซ้ำ (duplicate detection) ในเว็บอาจช้าลงนิดตอนเปิดหน้า แต่ไม่กระทบการคำนวณ

## URL myhora ที่ใช้ได้ (สำคัญสำหรับอนาคต)
- หน้ารายปี: `https://myhora.com/lottery/result-25YY.aspx` (เช่น result-2567.aspx) — **มีผลทุกงวดในหน้าเดียว** รวมสถิติ; web_fetch ได้ (ต้อง web_search ก่อนเพื่อปลดล็อก URL)
- หน้ารายงวด: `https://myhora.com/lottery/result-DD-MM-25YY.aspx`
- งวดเดียวแบบเร็ว: Sanook `https://news.sanook.com/lotto/check/DDMMYYYY/`
- GLO (glo.or.th) ใช้ web_fetch ไม่ได้ (โหลดผ่าน JavaScript)

---

<a name="session-6"></a>
# Session 6 (2026-06-15): ออกแบบฟีเจอร์สี + ระบบอัตโนมัติ Discord

> Session นี้เป็นการ **คุยไอเดีย/ออกแบบ** ทั้งหมด ไม่ได้เขียนโค้ด — ตกลงกันว่าจะแบ่งงาน: คุยไอเดียที่นี่ แล้วให้ Claude Code เป็นคนเขียนจริง (เข้าถึงโค้ดได้ดีกว่า) ผลลัพธ์ของ session นี้คือไฟล์ **PLAN.md** (แผนปฏิบัติการทีละขั้นสำหรับ Claude Code)

## คำถามตั้งต้น: การคำนวณอยู่บนพื้นฐานว่าสุ่มไหม
**[ผู้ใช้]** "ตอนนี้การคำนวณอยู่บนพื้นฐานว่าเลขที่ออกเป็นการสุ่มใช่ไหม"
- **[Claude]** แยก 2 ชั้น: (1) engine ไม่ได้สมมติว่าสุ่ม — มันพยายามหา pattern (freq/boost/learning); (2) กรอบประเมินผล (baseline 0.6, Chi-square) ตั้งอยู่บนสมมติฐานว่าสุ่ม → โปรเจกต์คือเอาเครื่องมือหา pattern มาวัดกับสมมติฐานว่าสุ่ม

## ฟีเจอร์ใหม่ 2 อย่าง (ก้อน A)
**[ผู้ใช้]** ขอ 2 ฟีเจอร์: (1) ใช้สีระบุเลขที่ออกซ้ำตำแหน่งเดิมในชุดข้อมูล แบ่งช่วง 1/2-3/4-6; (2) ดึง lockedHints มาเป็นข้อมูลหลักแยกจากเลข 6 ตัว ใช้สีเดียวกัน

**สรุปการตัดสินใจ (ผ่าน Q&A หลายรอบ):**
- **A1 สีตามความถี่:** แสดงใน **รายการข้อมูลหลัก** (ทุกงวด); ช่วงสี **ปรับอัตโนมัติต่ำสุด→สูงสุด** (ไม่ใช้ค่าตายตัว เพราะ 82 งวด เฉลี่ย ~8 ครั้ง/ตำแหน่ง ทำให้ช่วง 1/2-3/4-6 เฝือ)
- **A2 lockedHints เป็นข้อมูลหลัก:** แสดง **แยกกลุ่ม** จากเลข 6 ตัว, ใช้สีเดียวกัน, **ยังคง boost ด้วย**
- **[Claude]** เตือน 2 ปัญหา: (จุด 2) boost saturate เพราะ 246 ชุด +3 ทุกชุด น้ำหนักชนเพดาน ±20 หมด; (การนับสี) ควรนับแยกกลุ่ม

## ระบบอัตโนมัติ + Discord (ก้อน B)
**[ผู้ใช้]** "ต้องการระบบอัตโนมัติหาข้อมูลใส่ hints + กดวิเคราะห์ส่ง Discord + ตรวจผลส่ง Discord"

**ความเข้าใจผิดที่เคลียร์:**
- **[ผู้ใช้]** เข้าใจว่าการคำนวณอยู่บน Google Cloud
- **[Claude]** อธิบาย: การคำนวณรันบน **browser** ของผู้ใช้ (App.jsx ส่งไปรัน client-side); Firebase แค่เก็บไฟล์+ข้อมูล; ถ้าไม่เปิดเว็บ = ไม่มีการคำนวณ → automation จึงต้องมี engine ที่รันเองได้

**เปรียบเทียบ A (GitHub Actions) vs B (Cloud Function):**
- ประสิทธิภาพประมวลผลเท่ากัน (งานเบามาก)
- **[ผู้ใช้]** ชี้ว่า GitHub ย้ายง่ายกว่า → **[Claude]** ยืนยัน: A ไม่ lock-in, อยู่ใน repo, รันที่ไหนก็ได้
- **[ผู้ใช้]** ห่วงเรื่อง cron delay → **[Claude]** ส่งทำนายล่วงหน้า 1 วัน (ผู้ใช้ต้องไปซื้อ) ทำให้ delay ไม่สำคัญ
- **สรุป: เลือก A (GitHub Actions)**

**[ผู้ใช้]** ชี้ว่าวันออกหวยไม่ตายตัว 1/16 (มี 2 พ.ค., 17 ม.ค., 30 ธ.ค.)
- **[Claude]** → cron รันทุกวัน + เช็คปฏิทิน `lottery-dates.txt` ว่าพรุ่งนี้ออกไหม (ห้าม hard-code วันที่)

## แหล่งข้อมูล (ทดสอบ fetch จริงใน session นี้)
**hints (เลขเด็ดงวดหน้า):**
- **[ผู้ใช้]** อยากได้เลขเด็ด/เลขดังงวดหน้า (สำนักดัง) ไม่ใช่ผลย้อนหลัง
- ทดสอบ myhora `lucky-number.aspx` → เป็นผลโหวตรายหลัก 0-9 ฝังใน URL รูปกราฟ (`vote-chart.aspx?count=...`) ดึงได้แต่เป็นน้ำหนักรายหลัก ไม่ใช่ชุด → **เก็บเป็นสำรอง**
- ทดสอบ นกพลัส → เป็นแอปมือถือ ดึงไม่ได้ ❌
- ทดสอบ **kapook** (`lottery.kapook.com/<สำนัก>`) → ✅ ดีสุด! แต่ละสำนักมี URL คงที่; เลขเป็น text รูปแบบ `- NN` ในบทความ `viewXXXXXX.html`; ตัวอย่างจริง แม่จำเนียร 2 พ.ค.69 = 57,79,32,29,24,69,82,87,05,25
- โครงสร้าง kapook: หน้าสำนัก = รวมลิงก์บทความ → บทความงวดล่าสุด = มีเลขจริง
- **[ผู้ใช้]** สนใจ "แม่จำเนียรใบชมพู" (kapook ให้เป็น 10 อันดับขายดี ใกล้เคียงแต่ไม่ใช่ใบชมพูแท้)
- **หวยซอง ตัดออก** เพราะรวมหลายเจ้าในตัว นับ "ซ้ำกี่สำนัก" ไม่บริสุทธิ์; **บ้านสีฟ้าเก็บไว้** เพราะเป็นซองเจ้าเดียว (ตำราบ้านจานบอย) นับเป็น 1 เสียงได้

**ผลตรวจ (รางวัลย้อนหลัง):** myhora `result-25YY.aspx` (ทดสอบแล้วใน Session 5)

**[ผู้ใช้]** ถามเรื่อง token limit → **[Claude]** token เป็นข้อจำกัดของ Claude ตอนแชทเท่านั้น; automation ใช้ Node fetch+regex ไม่มี token ไม่มี AI ดึงได้อิสระ

## engine ต้องแยกออกจาก App.jsx
**[ผู้ใช้]** "เรื่องคำนวณมันต้องแยกออกมาอีกใช่ไหม"
- **[Claude]** ใช่ — หัวใจของ automation; ดึง logic (buildFreq, boost, learning, ทำนาย, ตรวจผล) เป็น `engine.js` ให้เว็บ+automation ใช้ตัวเดียวกัน ผลตรงกัน; เป็น refactor ที่ต้องระวังไม่ให้เว็บพัง

## ปิด 3 จุดที่เปิดอยู่ (ตกลงกันจบ)
1. **สำนัก hints (5):** แม่น้ำหนึ่ง, แม่จำเนียร, บ้านสีฟ้า, คำชะโนด, หลวงพ่อปากแดง
2. **boost lockedHints:** **normalize** ตามสัดส่วนความถี่ (กันตัน) — รักษาความถี่ไว้ ดีกว่านับ unique ที่ทิ้งข้อมูล
3. **hints เลือกเลข:** **เก็บทุกเลข ถ่วงน้ำหนักตามจำนวนสำนักที่ซ้ำ** (ไม่ตัดทิ้ง เลขซ้ำมาก=น้ำหนักมาก) — logic เดียวกับจุด 2 (weighted ไม่ตัดทิ้ง)

## ข้อตกลงการแบ่งงาน
- **ห้องแชทนี้ (Claude):** คุยไอเดีย/ออกแบบ/วางแผน
- **Claude Code:** เขียนโค้ดจริง โดยอ่าน **PLAN.md**
- **[ผู้ใช้]** ขอให้ Claude Code **ทำงานแบบไม่ถามบ่อย** (เหมือน Claude ในแอป) ทำต่อเนื่องจนเสร็จงานทั้งหมด แล้วสรุปทีเดียวตอนจบว่าทำอะไร ตั้งค่าอย่างไร (ไม่หยุดสรุปทีละ phase) → ระบุไว้ใน PLAN.md แล้ว

<a name="session-7"></a>
# Session 7 (2026-06-16): Phase B2-B5 — ระบบอัตโนมัติ Discord ครบสมบูรณ์

## หัวข้อ: ดำเนินการต่อจาก Session 7 (บริบทถูก compacted)

**[ผู้ใช้]** "ทำงานต่อให้เสร็จเลย"

**[Claude Code]** ดำเนินการ Phase B2.1 → B2.2 → B3 → B4 → B5 ต่อจาก scripts/package.json ที่สร้างไว้แล้ว

## สิ่งที่สร้าง

### scripts/_db.js — Firebase Admin init helper (shared ทุก script)
- `initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) })`
- export: `db`, `COL = 'lottery'`, `DOC = 'shared_data'`

### scripts/fetch-hints.js — Phase B2.1 (kapook scraper)
- 5 สำนัก: แม่น้ำหนึ่ง, แม่จำเนียร, บ้านสีฟ้า, คำชะโนด, หลวงพ่อปากแดง
- URL: `https://lottery.kapook.com/<encodeURIComponent(ชื่อ)>`
- Flow: fetch index page → หา `viewXXXXXX.html` → fetch article → regex `[–-]\s*(\d{2,3})`
- **Weighted hints:** นับว่าเลขไหนปรากฏกี่สำนัก → ใส่ entry นั้น N ครั้ง (ไม่ตัดทิ้ง)
- เลข 2 ตัว → `{front:"", back:"NN"}`, เลข 3 ตัว → `{front:"", back:"NNN"}`
- `--dry-run` mode; sleep 600ms ระหว่าง request (rate limit)
- เขียน `hints` field ลง Firestore (merge:true)

### scripts/fetch-results.js — Phase B2.2 (myhora scraper + learning)
- Fetch `https://myhora.com/lottery/result-25YY.aspx`
- Parse: รางวัลที่หนึ่ง (6 ตัว), เลขหน้า 3 ตัว (2 ชุด), เลขท้าย 3 ตัว (2 ชุด), เลขท้าย 2 ตัว
- **ป้องกัน duplicate:** เทียบ lastRow กับ newRow ก่อนเพิ่ม
- เรียก `adjustWeights` + `buildComparison` จาก engine.js
- เขียน: data, weights, history (50 รอบ), lastResults (รวม prediction สำหรับ discord), lastPredictions=null

### scripts/predict.js
- อ่าน Firestore: data/weights/hints/lockedHints
- เรียก `parseAll`, `convertHintsToBoost`, `analyze` จาก engine.js
- เขียน `lastPredictions` + `lastResults=null` ลง Firestore

### scripts/discord.js — Phase B5
- Usage: `node discord.js predict` | `node discord.js results`
- อ่าน `DISCORD_WEBHOOK` จาก env (ห้าม commit)
- **predict embed:** 6 หลัก (หน้า+หลัง), hints summary (weighted sorted), วันที่งวด (Bangkok)
- **results embed:** รางวัลที่ 1, หน้า3/ท้าย3/ท้าย2, ทำนาย vs จริง, ถูกกี่ตัว, รางวัลย่อย ✅/❌, เฉลี่ย N รอบ vs baseline 0.60
- สี embed: เหลือง (hits≥5), เขียว (hits≥3), ส้ม (hits≥1), เทา (0)

### lottery-dates.txt — Phase B3
- ปฏิทินหวยปี 2026-2027 รูปแบบ YYYY-MM-DD หนึ่งวันต่อบรรทัด
- ข้อยกเว้นที่ระบุ: Jan 1 → Jan 2 (วันปีใหม่), May 1 → May 2 (วันแรงงาน)
- มี comment บรรทัดขึ้นต้น `#`; `grep -qF "YYYY-MM-DD"` ใช้งานได้

### .github/workflows/auto-lottery.yml — Phase B4
- **2 cron:** `0 2 * * *` (09:00 ICT) = predict, `0 10 * * *` (17:00 ICT) = results
- **workflow_dispatch:** input mode = predict | results (ทดสอบ manual ได้)
- เช็คปฏิทิน lottery-dates.txt ก่อนรัน; ข้ามถ้าไม่ใช่วันออกหวย
- **Secrets ที่ต้องใส่:** `FIREBASE_SERVICE_ACCOUNT`, `DISCORD_WEBHOOK`
- Predict flow: fetch-hints → predict → discord predict
- Results flow: fetch-results → discord results

## โครงสร้าง scripts/ สมบูรณ์
```
scripts/
  package.json        (firebase-admin ^13.4.0, type:module)
  _db.js              Firebase Admin init
  fetch-hints.js      kapook scraper
  fetch-results.js    myhora scraper + learning
  predict.js          prediction runner
  discord.js          Discord webhook sender
```

## สิ่งที่ผู้ใช้ต้องตั้งค่าเพิ่ม (GitHub Secrets)
1. **`FIREBASE_SERVICE_ACCOUNT`** — JSON ของ service account key (มีอยู่แล้วจาก deploy.yml)
2. **`DISCORD_WEBHOOK`** — URL จาก Discord: Server Settings → Integrations → Webhooks

---

## 📌 สำหรับ Claude Code: อ่าน PLAN.md เพื่อเริ่มงาน

งานถัดไปทั้งหมดอยู่ในไฟล์ **`PLAN.md`** (แผนปฏิบัติการทีละขั้น) ครอบคลุม:
- ก้อน A: ฟีเจอร์สีตามความถี่ + lockedHints เป็นข้อมูลหลัก
- ก้อน B: ระบบอัตโนมัติ (แยก engine, ดึงข้อมูล, GitHub Actions, Discord)

Claude Code ควรอ่าน PLAN.md ทั้งหมดก่อนเริ่ม แล้วทำตามลำดับขั้นที่ระบุ โดยทำงานต่อเนื่องจนเสร็จงานทั้งหมด แล้วค่อยสรุปทีเดียวตอนจบ (ไม่หยุดถาม/ไม่หยุดสรุปทีละขั้นหรือทีละ phase)

---

# ไฟล์ที่เกี่ยวข้อง

- `lottery-app-v25.jsx` — โค้ดล่าสุด (~1818 บรรทัด)
- `PLAN.md` — **แผนปฏิบัติการทีละขั้นสำหรับ Claude Code (งานถัดไป)**
- `write-hints.js` — script เขียน lockedHints เข้า Firestore (สำหรับ Claude Code)
- `hints-input.txt` — ไฟล์ตัวอย่าง format หน้า,หลัง
- `hints-input-66-69.txt` — ข้อมูลเสริม 246 ชุดจาก myhora ปี 66-69 (ถึง 1 มิ.ย. 2569)
- `raw-2566-2569.txt` — ข้อมูลดิบ myhora (มีรางวัลที่ 1)
- `write-hints-README.md` — คู่มือใช้ write-hints.js
- `lottery-reference.md` — เอกสารอ้างอิง (project info, deploy, troubleshooting, features)
- `README.md` — สารบัญ link ไป reference
- `Lottery-Analyzer-history.md` — ไฟล์นี้ (ประวัติเต็ม v1-v25 + การออกแบบ automation)

---

*สร้างโดยอ่าน transcript 4 session: 2026-05-10, 2026-05-14, 2026-05-25, 2026-06-06*
*อัปเดต Session 5 (2026-06-09): Claude Code integration + ดึงข้อมูลเสริม myhora*
*รวมทุกการสนทนา + ถามตอบ + การแก้ไขโค้ดทุกเวอร์ชัน*
