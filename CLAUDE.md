# CLAUDE.md — Lottery Analyzer Project Instructions

@CLAUDE_HISTORY.md

## กฎการทำงาน (ต้องปฏิบัติทุก session)

1. **ยืนยันก่อนเขียนโค้ดทุกครั้ง** — สรุปความเข้าใจ + ถามให้ชัด (รูปแบบ A/B/C) รอ "เขียนเลย"/"ทำเลย"
2. **ตั้งชื่อไฟล์** `lottery-app-vN.jsx` เพิ่ม version ทุกครั้ง + CHANGELOG ที่หัวไฟล์
3. **สื่อสารภาษาไทย กระชับ** — ตอบสั้น ชอบรูปแบบ A/B/C
4. **สร้าง 2 ไฟล์** เสมอ: lottery-app-vN.jsx + lottery-reference.md
5. **แสดง version** ที่ header เว็บ ("ADAPTIVE PROBABILITY ENGINE vN")

## บันทึก CLAUDE_HISTORY.md (สำคัญมาก)

**ก่อนจบ session ทุกครั้ง** ต้องเพิ่มสรุปลงใน `CLAUDE_HISTORY.md` ตามรูปแบบนี้:

```
<a name="session-N"></a>
# Session N (YYYY-MM-DD): หัวข้อหลัก

## หัวข้อย่อย
**[ผู้ใช้]** คำขอ/คำถาม
**[Claude]** สิ่งที่ทำ + ผลลัพธ์

## สิ่งที่เพิ่ม/แก้ไข
- รายการเปลี่ยนแปลง
```

หลังเพิ่มสรุปแล้ว Stop hook จะ auto-commit + push ไป GitHub อัตโนมัติ

## Deploy Workflow (GitHub Actions)

1. วางไฟล์ `lottery-app-vN.jsx` ใน `versions/` บน GitHub  
2. Commit → GitHub Actions build + deploy อัตโนมัติ (~1-2 นาที)
3. Hard refresh (Ctrl+Shift+R)

## โครงสร้างโปรเจกต์

- `versions/lottery-app-vN.jsx` — โค้ดแต่ละ version
- `src/App.jsx` — ไฟล์ที่ GitHub Actions copy จาก versions/
- `CLAUDE_HISTORY.md` — ประวัติการพัฒนาทุก session
- `write-hints.js` — script เขียน lockedHints เข้า Firestore
- `hints-input-66-68.txt` — ข้อมูลเสริม 213 ชุดจาก myhora ปี 66-68
