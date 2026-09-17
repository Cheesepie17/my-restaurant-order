# 🍜 ระบบสั่งอาหารผ่าน QR Code (4 โต๊ะ) พร้อมแจ้งเตือน LINE Messaging API

ระบบสั่งอาหารผ่าน QR Code ประจำโต๊ะ สำหรับร้านอาหารขนาดเล็ก (4 โต๊ะ) รองรับการสแกนสั่งอาหารผ่านมือถือ แจ้งเตือนเข้า LINE ของพนักงานทันทีแบบ Real-time และมีหน้าจอ Dashboard สำหรับห้องครัว

---

## 📁 โครงสร้างโปรเจกต์
```text
restaurant-qr-ordering/
├── server.js               # เซิร์ฟเวอร์ Express, API Endpoints, LINE Messaging API
├── package.json            # รายการ Dependencies และ Scripts
├── .env.example            # แม่แบบตั้งค่า Environment Variables
├── .env                    # ไฟล์ตั้งค่าความลับ (Token, Target ID)
├── database/
│   └── db.js               # เชื่อมต่อ SQLite + Seed รายการอาหารเริ่มต้น
├── public/
│   ├── qr-generator.html   # เครื่องมือสร้างและพิมพ์ QR Code 4 โต๊ะ
│   ├── order-form.html     # หน้าสั่งอาหารสำหรับลูกค้า (Mobile Responsive)
│   └── order-dashboard.html# หน้าจอครัว/พนักงาน (Live Sync + เสียงเตือน)
└── README.md
```

---

## 🛠️ วิธีติดตั้งและรันบนเครื่อง (Localhost)

### 1. ติดตั้ง Dependencies
เปิด Terminal ในโฟลเดอร์โปรเจกต์ แล้วรันคำสั่ง:
```bash
npm install
```

### 2. ตั้งค่าไฟล์ `.env`
คัดลอกไฟล์ `.env.example` เป็น `.env` (ถ้ายังไม่มี):
```env
PORT=3000
LINE_CHANNEL_ACCESS_TOKEN=ใส่_Channel_Access_Token_ที่นี่
LINE_TARGET_ID=ใส่_User_ID_หรือ_Group_ID_ที่นี่
```
*(หากยังไม่มี Token สามารถทดลองรันระบบก่อนได้ โดยระบบจะบันทึกออเดอร์และแสดงบน Dashboard ตามปกติ เพียงแต่จะยังไม่ส่งข้อความเข้า LINE)*

### 3. รันเซิร์ฟเวอร์
```bash
npm start
```
หรือรันแบบ Hot-reload (สำหรับพัฒนา):
```bash
npm run dev
```

### 4. ลิงก์เข้าใช้งานต่างๆ
- 🖨️ **หน้าสร้าง QR Code:** [http://localhost:3000/qr](http://localhost:3000/qr)
- 📱 **หน้าสั่งอาหาร (ทดสอบโต๊ะ 1):** [http://localhost:3000/order?table=1](http://localhost:3000/order?table=1)
- 👨‍🍳 **หน้าจอห้องครัว/พนักงาน:** [http://localhost:3000/dashboard](http://localhost:3000/dashboard)

---

## 📲 วิธีขอ LINE Channel Access Token และ Target ID

LINE Notify ได้ยุติการให้บริการแล้ว ระบบนี้จึงใช้ **LINE Messaging API (Push Message)** ซึ่งมีขั้นตอนการตั้งค่าดังนี้:

### ขั้นตอนที่ 1: สร้าง Messaging API Channel
1. เข้าไปที่ [LINE Developers Console](https://developers.line.biz/) และล็อกอินด้วยบัญชี LINE
2. กดเลือกหรือสร้าง **Provider** ใหม่ (เช่น ตั้งชื่อว่า `MyRestaurant`)
3. คลิก **Create a new channel** แล้วเลือก **Messaging API**
4. กรอกข้อมูลร้าน:
   - Channel name: ชื่อบอท/ร้าน เช่น `แจ้งเตือนออเดอร์ร้านอาหาร`
   - Category / Subcategory: เลือกประเภทอาหารและเครื่องดื่ม
5. กดยอมรับเงื่อนไขและสร้าง Channel

### ขั้นตอนที่ 2: ขอ Channel Access Token
1. ในหน้า Channel ที่เพิ่งสร้าง ให้ไปที่แท็บ **Messaging API**
2. เลื่อนลงไปล่างสุดที่หัวข้อ **Channel access token**
3. กดปุ่ม **Issue** เพื่อสร้าง Token (แบบ Long-lived token)
4. คัดลอก Token ทั้งหมด มาวางใน `.env` ที่ช่อง `LINE_CHANNEL_ACCESS_TOKEN`

### ขั้นตอนที่ 3: หา User ID หรือ Group ID สำหรับรับแจ้งเตือน
- **วิธีที่ 1 (ส่งเข้า LINE ส่วนตัวของเจ้าของร้าน/พนักงาน):**
  1. ในหน้า LINE Developers Console แท็บ **Basic settings**
  2. เลื่อนลงมาที่หัวข้อ **Your user ID** (จะขึ้นต้นด้วย `U...` ความยาว 33 ตัวอักษร)
  3. สแกน QR Code เพิ่มเพื่อนกับ LINE Official Account ที่เพิ่งสร้าง
  4. นำ User ID ดังกล่าวมาใส่ใน `.env` ที่ช่อง `LINE_TARGET_ID`

- **วิธีที่ 2 (ส่งเข้ากลุ่ม LINE ของร้าน):**
  1. ดึง LINE Official Account บอทเข้ากลุ่ม LINE ของร้าน
  2. ตั้งค่า Webhook URL (เช่น ใช้ Webhook.site หรือ ngrok ชั่วคราว) เพื่อดึง `groupId` (จะขึ้นต้นด้วย `C...`) มาใส่ใน `LINE_TARGET_ID`

---

## 🚀 วิธี Deploy ขึ้น Production (ฟรีบน Render / Railway)

### Deploy ผ่าน Render.com (แนะนำ)
1. นำโค้ดขึ้น GitHub Repository
2. เข้าไปที่ [Render.com](https://render.com/) แล้วสร้าง **New Web Service**
3. เชื่อมต่อกับ Git Repository ของคุณ
4. ตั้งค่า:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. ไปที่แท็บ **Environment Variables** และเพิ่ม:
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `LINE_TARGET_ID`
6. กด **Deploy** และรอจนสถานะเป็น *Live* จะได้ URL เช่น `https://my-restaurant-order.onrender.com`

---

## 🖨️ วิธีเชื่อม QR Code กับ 4 โต๊ะจริง

1. หลังจาก Deploy ขึ้น Render/Railway เสร็จแล้ว ให้เปิดไปที่:
   ```text
   https://<your-domain>/qr
   ```
2. ในช่อง **Base Order URL** ระบบจะใส่ลิงก์จริงให้โดยอัตโนมัติ เช่น `https://<your-domain>/order`
3. ตรวจสอบว่าเลขโต๊ะเริ่มต้นคือ `1` และจำนวนคือ `4`
4. กดปุ่ม **"🖨️ สั่งพิมพ์การ์ดประจำโต๊ะ"**
5. เลือกพิมพ์ลงกระดาษ A4 (จะจัดหน้า 2x2 พอดี 4 โต๊ะใน 1 หน้า)
6. ตัดตามเส้นประ นำไปเคลือบหรือใส่แท่นวางประจำโต๊ะหมายเลข 1 ถึง 4 ได้ทันที

---

## 🔒 ความปลอดภัยที่ออกแบบไว้
- **Rate Limiting:** จำกัดการยิงสั่งอาหารไม่เกิน 15 ครั้งต่อนาทีต่อ IP
- **Server-side Validation:** ตรวจสอบเลขโต๊ะ 1-4 เท่านั้น และคำนวณราคาสินค้าจากฐานข้อมูลโดยตรง ป้องกันการโกงราคา
- **Safe LINE Error Handling:** หากส่ง LINE ไม่สำเร็จ ออเดอร์จะยังถูกบันทึกลงฐานข้อมูลและแสดงบนหน้าจอครัวตามปกติ
