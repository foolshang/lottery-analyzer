# 📋 Lottery Analyzer — Reference

ใช้ Ctrl+F ค้นหา

---

## 🌐 ข้อมูลโปรเจกต์

| รายการ | ค่า |
|---|---|
| URL ใช้งาน | https://lottary-d8ebd.web.app |
| Firebase Project ID | lottary-d8ebd |
| Google Account | foolshang.live@gmail.com |
| GitHub Repo (Private) | https://github.com/foolshang/lottery-analyzer |
| GitHub Username | foolshang |
| Service Account | firebase-adminsdk-fbsvc@lottary-d8ebd.iam.gserviceaccount.com |
| โฟลเดอร์ใน Cloud Shell | `~/lottery-app` |
| ไฟล์โค้ดหลัก | `src/App.jsx` |
| เวอร์ชันปัจจุบัน | v20 |

---

## 🚀 วิธี Deploy (GitHub Actions Auto-Deploy)

**เซ็ตอัพเสร็จแล้ว** — แค่แก้ไฟล์ใน GitHub แล้ว auto deploy ทันที

### วิธีอัปเดตโค้ดใหม่ (ทำทุกครั้งที่ได้ไฟล์ใหม่จาก Claude)

#### ในมือถือ (GitHub App):
1. เปิดแอป GitHub → repo `lottery-analyzer`
2. ไปที่ `src/App.jsx` → แตะ ⋮ → **Edit file**
3. ลบทั้งหมด → วางโค้ดใหม่
4. Commit message: `Update to v21` (เปลี่ยนเลขตามเวอร์ชัน)
5. กด **Commit**
6. ✨ Auto deploy เริ่มทำงาน — 1-2 นาที เว็บอัปเดต

#### ในคอม (เว็บ):
1. เปิด https://github.com/foolshang/lottery-analyzer
2. คลิก `src/App.jsx`
3. กด ✏️ (Edit) มุมขวาบนของไฟล์
4. ลบทั้งหมด → วางโค้ดใหม่
5. เลื่อนลงล่าง → กรอก commit message
6. กด **Commit changes**
7. ✨ Auto deploy

### ดู Build Status

ไปที่ tab **Actions** → https://github.com/foolshang/lottery-analyzer/actions

- 🟡 = กำลัง build
- ✅ = สำเร็จ (1-2 นาที)
- ❌ = error (คลิกดู log)

### Rollback ย้อนเวอร์ชัน

1. GitHub → tab **Commits**
2. หา commit ที่ต้องการ → คลิก
3. มุมขวาบน → **Browse files**
4. คลิก `src/App.jsx` → Copy โค้ด
5. กลับไป main → Edit → Paste → Commit

---

## 🛠️ การตั้งค่าเริ่มต้น (เสร็จแล้ว — ไม่ต้องทำซ้ำ)

### 1. GitHub Personal Access Token

- **Note**: Cloud Shell with workflow
- **Scopes**:
  - ✅ repo (เต็มหมด)
  - ✅ workflow

สร้างใหม่ได้ที่ https://github.com/settings/tokens

### 2. GitHub Secret

ในหน้า https://github.com/foolshang/lottery-analyzer/settings/secrets/actions

มี secret ชื่อ `FIREBASE_SERVICE_ACCOUNT` — เก็บ Firebase Service Account JSON

### 3. Service Account Roles (Google Cloud IAM)

Service Account `firebase-adminsdk-fbsvc@lottary-d8ebd.iam.gserviceaccount.com` ต้องมี roles
- ✅ Firebase Authentication Admin
- ✅ Firebase Hosting Admin
- ✅ API Keys Viewer
- ✅ Service Account User

เช็คได้ที่ https://console.cloud.google.com/iam-admin/iam

### 4. Workflow File

ไฟล์ `.github/workflows/deploy.yml` ใน repo (Node 22, deploy to Firebase Hosting)

---

## 🔧 วิธีแก้ปัญหา (ที่เคยเจอ + วิธีแก้)

### ❌ Deploy แล้วเว็บยังเหมือนเดิม

**สาเหตุ:** Cache ของเบราว์เซอร์

**แก้:**
- Windows/Linux: `Ctrl + Shift + R`
- Mac: `Cmd + Shift + R`
- มือถือ: ปิด/เปิดเบราว์เซอร์ใหม่ หรือใช้ Incognito mode

### ❌ GitHub Actions: `npm error code ENOENT package.json not found`

**สาเหตุ:** ไฟล์ใน repo ไม่ครบ — Force push ครั้งแรกอาจทับไฟล์ไป

**แก้ใน Cloud Shell:**
```bash
cd ~/lottery-app
git ls-tree -r HEAD --name-only  # ดูว่าไฟล์ครบไหมใน local
git push -f origin main          # force push ทับขึ้นไป
```

### ❌ Re-run แล้วก็ fail แบบเดิม

**สาเหตุ:** Re-run ใช้ commit hash เก่าที่ไฟล์ไม่ครบ

**แก้:** Commit ใหม่ผ่าน GitHub web (แก้ README เพิ่มบรรทัดว่าง) → trigger workflow ใหม่

### ❌ `Authentication failed for github.com`

**สาเหตุ:** Token หมดอายุหรือไม่มีสิทธิ์พอ

**แก้:**
1. สร้าง token ใหม่ที่ https://github.com/settings/tokens
2. ติ๊ก scopes ✅ **repo** และ ✅ **workflow**
3. ใส่ token ใหม่เป็น password ตอน git push

### ❌ `refusing to allow a Personal Access Token to create or update workflow without workflow scope`

**สาเหตุ:** Token ไม่มี `workflow` scope

**แก้:** สร้าง token ใหม่ตามด้านบน → ติ๊ก ✅ workflow

### ❌ `Error: Request had HTTP Error: 403, The caller does not have permission`

**สาเหตุ:** Service Account ขาด role `Firebase Hosting Admin`

**แก้:**
1. ไป https://console.cloud.google.com/iam-admin/iam
2. หา Service Account → คลิก ✏️
3. Add roles:
   - Firebase Hosting Admin
   - API Keys Viewer
   - Service Account User
4. Save → Re-run workflow

### ❌ Sync ผิดพลาดในแอป

**แก้:** Firebase Console → Firestore → Rules
```
allow read, write: if true;
```

### ❌ Login Google error

**แก้:** Firebase Console → Authentication → Settings → Authorized domains → Add `lottary-d8ebd.web.app`

### ❌ ลบข้อมูลใน Firestore

1. Firebase Console → Firestore Database
2. collection `lottery` → document `shared_data`
3. แก้ field ที่ต้องการ

### ❌ ดูข้อมูลใน Browser console
```js
// ดู snapshot ทั้งหมด
JSON.parse(localStorage.getItem('lottery_v7'))

// ล้างข้อมูลในเบราว์เซอร์
localStorage.clear(); location.reload();
```

---

## 📜 คำสั่ง Cloud Shell ที่ใช้บ่อย

### เช็คเวอร์ชันโค้ดใน Cloud Shell
```bash
grep "Version" ~/lottery-app/src/App.jsx | head -2
```

### ดูสถานะ Git
```bash
cd ~/lottery-app && git status
```

### ดู commit log
```bash
cd ~/lottery-app && git log --oneline -5
```

### ดูไฟล์ใน commit
```bash
cd ~/lottery-app && git ls-tree -r HEAD --name-only
```

### Pull โค้ดล่าสุดจาก GitHub มา local
```bash
cd ~/lottery-app && git pull origin main
```

### Push การเปลี่ยนแปลงไป GitHub
```bash
cd ~/lottery-app
git add .
git commit -m "ข้อความ commit"
git push origin main
```

### Reset Build Cache (ถ้าจำเป็น)
```bash
cd ~/lottery-app
rm -rf dist node_modules/.vite
npm install
```

### Manual Deploy จาก Cloud Shell (สำรอง)
```bash
cd ~/lottery-app
npm run build
firebase deploy
```

---

## 🔑 Firebase Config

```js
const firebaseConfig = {
  apiKey:            "AIzaSyBI4Fg5Sh7vt3X2TINBy6vEnYYWQV2KV8Q",
  authDomain:        "lottary-d8ebd.firebaseapp.com",
  projectId:         "lottary-d8ebd",
  storageBucket:     "lottary-d8ebd.firebasestorage.app",
  messagingSenderId: "6424789017",
  appId:             "1:6424789017:web:aba84dd2960e5ede432a88",
};
```

---

## ⚙️ ฟีเจอร์ทั้งหมด (v20)

### หน้าข้อมูล
- ใส่ข้อมูลในอดีต (textarea) — รองรับเลข 0 นำหน้า, CRLF
- เพิ่มชุดข้อมูล (Enter / ปุ่ม +)
- นำเข้า .txt / .csv / .xlsx / .xls
- ส่งออก .txt และ .xlsx
- **ข้อมูลเพิ่มเติม (hints):**
  - 3 ช่องต่อชุด: 3 ตัวหน้า / 3 ตัวหลัง / ทุกตำแหน่ง (1-6 ตัว)
  - กด Enter ทุกช่อง = เพิ่มชุดใหม่ + cursor focus ที่ช่อง "ทุกตำแหน่ง"
  - จุดเรียงชิดขวา (1 ตัว → `• • 5`)
  - ระบบล็อก: ปุ่ม 🔒 ในแต่ละชุด → ย้ายไปฝั่งขวา
  - ระบบปลดล็อก: ปุ่ม 🔓 ในแต่ละชุดล็อก (ลบเฉพาะชุด) + ปุ่ม "ปลดล็อก" (ลบทั้งหมด)
  - ระบบเช็คซ้ำ: แยกช่อง ไม่ข้ามช่อง (หน้า vs หน้า, หลัง vs หลัง, ทุกตำแหน่ง vs ทุกตำแหน่ง)

### Boost ตามจำนวนตัว

| ใส่ในช่อง | จำนวน | boost ตำแหน่ง |
|---|---|---|
| หน้า | 1 ตัว | ทุกตำแหน่ง 1-6 |
| หน้า | 2 ตัว | 1, 2 |
| หน้า | 3 ตัว | 1, 2, 3 |
| หลัง | 1 ตัว | ทุกตำแหน่ง 1-6 |
| หลัง | 2 ตัว | 5, 6 |
| หลัง | 3 ตัว | 4, 5, 6 |
| ทุกตำแหน่ง | 1-6 ตัว | ทุกตัวที่ใส่ boost ทุกตำแหน่ง 1-6 |

### 3 โหมดวิเคราะห์ (คำนวณพร้อมกัน)

| โหมด | ใช้ |
|---|---|
| ปกติ (normal) | ข้อมูลหลัก + hints + learning |
| ไม่ใช้ hints (no_hints) | ข้อมูลหลัก + learning |
| ใช้ hints อย่างเดียว (hints_only) | hints + learning |

- กดวิเคราะห์ครั้งเดียว → ได้ผล 3 ชุด
- Learning แยก 3 ชุด
- ใส่ผลจริงครั้งเดียว → ตรวจครบ 3 โหมด

### หน้าผลวิเคราะห์
- แสดง 3 โหมดต่อกัน
- ใส่ผลจริง 4 รูปแบบ:
  - 🏆 6 ตัว (บังคับ)
  - 🎯 3 ตัวหน้า (0-2 ชุด)
  - 🎯 3 ตัวท้าย (0-2 ชุด)
  - 🎯 2 ตัวท้าย (0-1 ชุด)
- หลังยืนยัน → กลับหน้าข้อมูลอัตโนมัติ

### หน้าสถิติ
- รอบที่เรียนรู้ / เฉลี่ย / ถูก 6 ตัว
- สถิติรางวัลย่อย (3 หน้า / 3 ท้าย / 2 ท้าย)
- กราฟ 5 รอบล่าสุด
- 🧪 เปรียบเทียบ 3 โหมด (เทียบกับ 0.6 = ค่าสุ่ม)
- 🔬 Chi-square test (ต้องมี 30+ งวด)
- 🧠 น้ำหนักเรียนรู้สะสม (heatmap) — เลือกดูแต่ละโหมด
- 📋 ประวัติทุกรอบ — แสดง 3 โหมดต่อรอบ
- 📊 ปุ่มกราฟ — popup กราฟผลทาย 4 ประเภท (6 ตัว / 3 หน้า / 3 ท้าย / 2 ท้าย)

---

## 🧠 ระบบ Learning

### การปรับน้ำหนัก (per รอบ, per โหมด)
- เลขที่ทาย = เลขจริง → **+2** เลขนั้น
- เลขที่ทาย ≠ เลขจริง → **-2** เลขที่ทาย, **+2** เลขจริง
- เพดาน: **±20**

### ที่เก็บข้อมูล

| ข้อมูล | เก็บที่ |
|---|---|
| ข้อมูลในอดีต | localStorage + Firestore |
| น้ำหนัก Learning (3 โหมด) | localStorage + Firestore |
| ประวัติ (สูงสุด 50 รอบ) | localStorage + Firestore |
| Locked hints | localStorage + Firestore |
| Login session | Browser cookies |

### Sync ข้ามเครื่อง
Login Google account เดียวกัน → ข้อมูล sync ทันที

---

## 📊 รูปแบบไฟล์ที่รองรับ

### .txt (1 บรรทัด = 1 งวด)
```
922388
198162
869070
```

### .csv / .xlsx แบบช่องเดียว
| A |
|---|
| 154237 |

### .csv / .xlsx แบบแยก 6 คอลัมน์
| A | B | C | D | E | F |
|---|---|---|---|---|---|
| 1 | 5 | 4 | 2 | 3 | 7 |

---

## 🔬 Chi-square test คืออะไร

ทดสอบว่าเลขในแต่ละตำแหน่งกระจายเท่ากันหรือไม่
- **χ² < 16.92** → สุ่ม (ดี)
- **χ² > 16.92** → ไม่สุ่ม (มี pattern)
- ใช้ df=9 (เลข 0-9 มี 10 ค่า → df = 10-1 = 9)
- p-value cutoff = 0.05

---

## 📐 ค่าคาดหวังสำหรับลอตเตอรี่สุ่ม

- ค่าเฉลี่ยถูก/รอบ = **0.6 ตัว** (6 ตำแหน่ง × 10%)
- ถูกครบ 6 = 1 ในล้าน
- ถูก 4-5 ตัว = 1 ในพันถึงหมื่นรอบ

ถ้าโหมดไหนได้เฉลี่ย > 0.6 อย่างต่อเนื่อง → อาจมีประสิทธิภาพจริง

---

## 📝 เริ่ม Chat ใหม่ ต้องแนบอะไร

1. ไฟล์โค้ดล่าสุด (`lottery-app-vN.jsx`) — Download จาก Claude artifact
2. ไฟล์ reference นี้ (`lottery-reference.md`)
3. บอกสิ่งที่ต้องการแก้/เพิ่ม

Memory ใน Claude **ไม่ข้ามแชต** — ต้องแนบทุกครั้ง

---

## 🔖 ข้อตกลงในการทำงานกับ Claude

- ก่อนเขียนโค้ด Claude ต้องสรุปสิ่งที่จะทำและรอ user ยืนยัน
- ไฟล์โค้ดตั้งชื่อ `lottery-app-vN.jsx` ตามลำดับเวอร์ชัน
- ในโค้ดต้องระบุ Changelog (เพิ่ม `+` / ลบ `-` / แก้ `~`)
- ใน Header ของไฟล์ระบุ Version และ Changelog
