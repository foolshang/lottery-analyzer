# Lottery Analyzer

ระบบวิเคราะห์เลขลอตเตอรี่ — มี 3 โหมดทดลอง + Learning อัตโนมัติ

- 🌐 **เว็บ:** https://lottary-d8ebd.web.app
- 📦 **เวอร์ชันปัจจุบัน:** v20
- 🔥 **Firebase Project:** lottary-d8ebd
- 🚀 **Auto Deploy:** GitHub Actions

---

## 📚 สารบัญ

| หัวข้อ | คำอธิบาย |
|---|---|
| [ข้อมูลโปรเจกต์](lottery-reference.md#-ข้อมูลโปรเจกต์) | URL, GitHub, account |
| [วิธี Deploy](lottery-reference.md#-วิธี-deploy-github-actions-auto-deploy) | Auto deploy ผ่าน GitHub Actions |
| [การตั้งค่าเริ่มต้น](lottery-reference.md#%EF%B8%8F-การตั้งค่าเริ่มต้น-เสร็จแล้ว--ไม่ต้องทำซ้ำ) | Token, Secret, Roles |
| [แก้ปัญหา](lottery-reference.md#-วิธีแก้ปัญหา-ที่เคยเจอ--วิธีแก้) | ปัญหาที่เคยเจอ + วิธีแก้ |
| [คำสั่ง Cloud Shell](lottery-reference.md#-คำสั่ง-cloud-shell-ที่ใช้บ่อย) | คำสั่งที่ใช้บ่อย |
| [Firebase Config](lottery-reference.md#-firebase-config) | API keys |
| [ฟีเจอร์](lottery-reference.md#%EF%B8%8F-ฟีเจอร์ทั้งหมด-v20) | ฟีเจอร์ v20 + Boost + 3 โหมด |
| [Learning](lottery-reference.md#-ระบบ-learning) | การปรับน้ำหนัก |
| [Chi-square](lottery-reference.md#-chi-square-test-คืออะไร) | ทดสอบความสุ่ม |

---

## 🚀 วิธีอัปเดตโค้ดใหม่ (สรุปสั้นๆ)

1. ดาวน์โหลด `lottery-app-vN.jsx` จาก Claude
2. ไปที่โฟลเดอร์ `versions/` ใน GitHub
3. **Add file** → **Upload files** → วางไฟล์
4. Commit message: `Update to vN`
5. ✨ Auto deploy 1-2 นาที

ดูรายละเอียดเต็มที่ [วิธี Deploy](lottery-reference.md#-วิธี-deploy-github-actions-auto-deploy)
