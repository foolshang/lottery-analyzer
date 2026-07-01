# research/ — โฟลเดอร์ทดลองชั่วคราว

ทดสอบสมมติฐาน: **รางวัล 2-5 ของงวดก่อน ทำนายรางวัลที่ 1 งวดถัดไปได้ดีกว่าสุ่มไหม?**

ไม่เกี่ยวกับระบบ auto/Discord/เว็บหลัก ห้ามแตะไฟล์นอกโฟลเดอร์นี้

## วิธีรัน

```bash
# ขั้น 1: ดึงข้อมูล ~669 งวด (2538-2569 BE) ใช้เวลา ~15-20 นาที
node research/fetch-prizes.js

# ถ้าโดน rate-limit ให้รันซ้ำ — resume อัตโนมัติ
node research/fetch-prizes.js

# ขั้น 2: รัน backtest (เร็ว <1 วินาที ไม่ดึงเน็ต)
node research/backtest-25.js

# อ่านผลลัพธ์
cat research/data/backtest-log.txt

# ทดสอบ parse 3 งวดล่าสุดก่อนดึงทั้งหมด
node research/fetch-prizes.js --smoke
```

## โครงสร้าง

```
research/
  fetch-prizes.js          ดึง myhora งวด 2538-2569 (resume ได้)
  backtest-25.js           รัน backtest 5 สูตร + random control
  data/
    prizes-history.json    ข้อมูลดิบ (gitignore — gen เอง)
    backtest-log.txt       ผลลัพธ์
```

## สูตรที่ทดสอบ

| สูตร | วิธีทำนาย |
|------|-----------|
| A (freq) | ความถี่ prize1 สะสม งวด 1..N |
| B-count | ความถี่ดิบ prize2-5 งวด N |
| B-ladder | B ถ่วงน้ำหนัก (count 1-2→1, 3-4→2, 5-6→3, 7+→4) |
| C-raw | A + B รวม raw |
| C-norm | 0.5×norm(A) + 0.5×norm(B) |
| RAND | สุ่มล้วน (control) |

คาดว่าทุกสูตรจะได้ mean ≈ 0.6 (เสมอสุ่ม) ถ้าลอตเตอรี่สุ่มจริง
