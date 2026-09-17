require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const db = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000;

const fs = require('fs');

// Helper หา path ของไฟล์ HTML (รองรับทั้งใน public/ และ root)
function getHtmlPath(filename) {
  const publicPath = path.join(__dirname, 'public', filename);
  if (fs.existsSync(publicPath)) {
    return publicPath;
  }
  return path.join(__dirname, filename);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));


const os = require('os');

function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const orderLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 นาที
  max: 20, // สูงสุด 20 ครั้งต่อ 1 นาทีต่อ IP
  message: { success: false, error: 'คุณทำรายการบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ฟังก์ชันส่งข้อความแจ้งเตือนผ่าน LINE Messaging API
async function sendLineOrderNotification(order, items) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const targetId = process.env.LINE_TARGET_ID;

  if (!token || !targetId || token === 'your_line_channel_access_token_here') {
    console.warn('⚠️ LINE Messaging API: ไม่ได้กำหนด LINE_CHANNEL_ACCESS_TOKEN หรือ LINE_TARGET_ID ใน .env (ข้ามการส่ง LINE)');
    return false;
  }

  // สร้างข้อความสรุปออเดอร์
  const itemLines = items.map(item => {
    const note = item.special_request ? ` (${item.special_request})` : '';
    return `• ${item.item_name} x${item.quantity}${note} - ฿${(item.price * item.quantity).toFixed(0)}`;
  }).join('\n');

  const nowStr = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
  const tableNoteStr = order.customer_note ? `\n📝 หมายเหตุ: ${order.customer_note}` : '';

  const messageText = `🔔 [ออเดอร์ใหม่] โต๊ะ ${order.table_no} (ออเดอร์ #${order.id})
━━━━━━━━━━━━━━━━
${itemLines}
━━━━━━━━━━━━━━━━${tableNoteStr}
💰 ยอดรวม: ฿${Number(order.total_price).toFixed(0)}
⏰ เวลา: ${nowStr}`;

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        to: targetId,
        messages: [
          {
            type: 'text',
            text: messageText
          }
        ]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`❌ LINE Messaging API Error (${response.status}):`, errBody);
      return false;
    }

    console.log(`✅ ส่งแจ้งเตือน LINE สำเร็จ (ออเดอร์ #${order.id} โต๊ะ ${order.table_no})`);
    return true;
  } catch (error) {
    console.error('❌ ไม่สามารถเชื่อมต่อกับ LINE API ได้:', error.message);
    return false;
  }
}

// --------------------------------------------------------------------------
// API Endpoints
// --------------------------------------------------------------------------

// 1. ดึงเมนูอาหารทั้งหมดตามหมวดหมู่
app.get('/api/menu', (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order ASC, id ASC').all();
    const items = db.prepare('SELECT * FROM menu_items WHERE is_available = 1 ORDER BY category_id ASC, id ASC').all();

    // จัดกลุ่มรายการอาหารตามหมวดหมู่
    const menuWithCategories = categories.map(cat => ({
      id: cat.id,
      name: cat.name,
      items: items.filter(item => item.category_id === cat.id)
    })).filter(cat => cat.items.length > 0);

    res.json({ success: true, data: menuWithCategories });
  } catch (err) {
    console.error('Error fetching menu:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการดึงรายการเมนู' });
  }
});

// 2. รับออเดอร์ใหม่จากลูกค้า
app.post('/api/orders', orderLimiter, async (req, res) => {
  try {
    const { table_no, customer_note, items } = req.body;

    // ตรวจสอบความถูกต้องของเลขโต๊ะ (1-4 เท่านั้น)
    const tableNum = parseInt(table_no, 10);
    if (isNaN(tableNum) || tableNum < 1 || tableNum > 4) {
      return res.status(400).json({
        success: false,
        error: 'เลขโต๊ะไม่ถูกต้อง (ระบบรองรับเฉพาะโต๊ะ 1 ถึง 4)'
      });
    }

    // ตรวจสอบรายการอาหาร
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'กรุณาเลือกรายการอาหารอย่างน้อย 1 รายการ'
      });
    }

    // ดึงข้อมูลราคาจากฐานข้อมูลจริงเพื่อป้องกันการแก้ไขราคาจาก Client
    const itemIds = items.map(i => parseInt(i.menu_item_id, 10)).filter(id => !isNaN(id));
    if (itemIds.length === 0) {
      return res.status(400).json({ success: false, error: 'ข้อมูลรายการอาหารไม่ถูกต้อง' });
    }

    const placeholders = itemIds.map(() => '?').join(',');
    const dbItems = db.prepare(`SELECT * FROM menu_items WHERE id IN (${placeholders}) AND is_available = 1`).all(...itemIds);
    const dbItemMap = new Map(dbItems.map(item => [Number(item.id), item]));

    // ตรวจสอบและคำนวณยอดรวม
    let calculatedTotalPrice = 0;
    const validatedOrderItems = [];

    for (const item of items) {
      const menuItemId = parseInt(item.menu_item_id, 10);
      const qty = parseInt(item.quantity, 10);
      const specialReq = (item.special_request || '').toString().slice(0, 250).trim();

      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ success: false, error: 'จำนวนสินค้าไม่ถูกต้อง' });
      }

      const foundItem = dbItemMap.get(menuItemId);
      if (!foundItem) {
        return res.status(400).json({
          success: false,
          error: `ไม่พบรายการอาหาร ID: ${menuItemId} หรือสินค้านี้หมดแล้ว`
        });
      }

      // ใช้ราคาจาก client ที่รวม option เสริมแล้ว หรือ fallback เป็นราคาฐาน (ไม่ให้ต่ำกว่าราคาฐาน)
      let itemUnitPrice = parseFloat(item.unit_price);
      if (isNaN(itemUnitPrice) || itemUnitPrice < foundItem.price) {
        itemUnitPrice = foundItem.price;
      }

      const itemTotal = itemUnitPrice * qty;
      calculatedTotalPrice += itemTotal;

      validatedOrderItems.push({
        menu_item_id: foundItem.id,
        item_name: foundItem.name,
        price: itemUnitPrice,
        quantity: qty,
        special_request: specialReq
      });
    }


    const sanitizedNote = (customer_note || '').toString().slice(0, 300).trim();

    // บันทึกลงฐานข้อมูลด้วย Transaction
    db.exec('BEGIN TRANSACTION;');
    let newOrder;
    try {
      const insertOrder = db.prepare(`
        INSERT INTO orders (table_no, status, total_price, customer_note, created_at, updated_at)
        VALUES (?, 'pending', ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
      `);
      const orderResult = insertOrder.run(tableNum, calculatedTotalPrice, sanitizedNote);
      const orderId = Number(orderResult.lastInsertRowid);

      const insertOrderItem = db.prepare(`
        INSERT INTO order_items (order_id, menu_item_id, item_name, price, quantity, special_request)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const item of validatedOrderItems) {
        insertOrderItem.run(
          orderId,
          item.menu_item_id,
          item.item_name,
          item.price,
          item.quantity,
          item.special_request
        );
      }

      db.exec('COMMIT;');

      newOrder = {
        id: orderId,
        table_no: tableNum,
        status: 'pending',
        total_price: calculatedTotalPrice,
        customer_note: sanitizedNote
      };
    } catch (txErr) {
      db.exec('ROLLBACK;');
      throw txErr;
    }

    // ส่งแจ้งเตือนเข้า LINE แบบ Non-blocking (async) ไม่บล็อก Response กลับลูกค้า
    sendLineOrderNotification(newOrder, validatedOrderItems).catch(err => {
      console.error('Async LINE notification error:', err);
    });

    // ส่งผลลัพธ์ตอบกลับลูกค้าทันที
    res.status(201).json({
      success: true,
      message: 'บันทึกออเดอร์เรียบร้อยแล้ว',
      data: {
        order_id: newOrder.id,
        table_no: newOrder.table_no,
        total_price: newOrder.total_price,
        items_count: validatedOrderItems.length
      }
    });
  } catch (err) {
    console.error('Error saving order:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการบันทึกออเดอร์' });
  }
});

// 3. ดึงรายการออเดอร์ทั้งหมด (สำหรับหน้าครัว/แคชเชียร์)
app.get('/api/orders', (req, res) => {
  try {
    const statusFilter = req.query.status;
    let query = 'SELECT * FROM orders';
    const params = [];

    if (statusFilter && ['pending', 'preparing', 'served', 'cancelled'].includes(statusFilter)) {
      query += ' WHERE status = ?';
      params.push(statusFilter);
    }

    query += ' ORDER BY id ASC';

    const orders = db.prepare(query).all(...params);

    if (orders.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // ดึง items ของแต่ละ order
    const orderIds = orders.map(o => Number(o.id));
    const placeholders = orderIds.map(() => '?').join(',');
    const items = db.prepare(`SELECT * FROM order_items WHERE order_id IN (${placeholders})`).all(...orderIds);

    const itemsByOrderId = {};
    for (const item of items) {
      const oId = Number(item.order_id);
      if (!itemsByOrderId[oId]) {
        itemsByOrderId[oId] = [];
      }
      itemsByOrderId[oId].push(item);
    }

    const result = orders.map(order => ({
      ...order,
      id: Number(order.id),
      table_no: Number(order.table_no),
      total_price: Number(order.total_price),
      items: itemsByOrderId[Number(order.id)] || []
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการดึงรายการออเดอร์' });
  }
});

// 4. อัปเดตสถานะออเดอร์ (pending -> preparing -> served -> cancelled)
app.patch('/api/orders/:id', (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const { status } = req.body;

    if (isNaN(orderId)) {
      return res.status(400).json({ success: false, error: 'Order ID ไม่ถูกต้อง' });
    }

    const validStatuses = ['pending', 'preparing', 'served', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `สถานะไม่ถูกต้อง (ต้องเป็น: ${validStatuses.join(', ')})`
      });
    }

    const updateStmt = db.prepare(`
      UPDATE orders 
      SET status = ?, updated_at = datetime('now', 'localtime') 
      WHERE id = ?
    `);

    const result = updateStmt.run(status, orderId);

    if (Number(result.changes) === 0) {
      return res.status(404).json({ success: false, error: 'ไม่พบออเดอร์ที่ระบุ' });
    }

    res.json({
      success: true,
      message: `อัปเดตสถานะออเดอร์ #${orderId} เป็น "${status}" สำเร็จ`,
      data: { order_id: orderId, status }
    });
  } catch (err) {
    console.error('Error updating order status:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการอัปเดตสถานะ' });
  }
});

// 5. Endpoint ทดสอบส่ง LINE Messaging API
app.post('/api/test-line', async (req, res) => {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const targetId = process.env.LINE_TARGET_ID;

  if (!token || !targetId) {
    return res.status(400).json({
      success: false,
      error: 'กรุณาตั้งค่า LINE_CHANNEL_ACCESS_TOKEN และ LINE_TARGET_ID ในไฟล์ .env ก่อน'
    });
  }

  const testOrder = {
    id: 999,
    table_no: 1,
    total_price: 120,
    customer_note: 'ทดสอบระบบแจ้งเตือน LINE'
  };

  const testItems = [
    { item_name: 'ข้าวกะเพราหมูสับเต้าหู้กรอบ', quantity: 1, price: 60, special_request: 'เผ็ดน้อย' },
    { item_name: 'ชเวปส์มะนาวโซดา', quantity: 1, price: 20, special_request: '' }
  ];

  const ok = await sendLineOrderNotification(testOrder, testItems);
  if (ok) {
    res.json({ success: true, message: 'ส่งข้อความทดสอบเข้า LINE สำเร็จแล้ว!' });
  } else {
    res.status(500).json({ success: false, error: 'ส่ง LINE ไม่สำเร็จ กรุณาตรวจสอบ Token และ Target ID ใน .env' });
  }
});

// Host info สำหรับ QR Generator
app.get('/api/host-info', (req, res) => {
  const localIp = getLocalIp();
  res.json({
    localIp: localIp,
    port: PORT,
    localOrderUrl: `http://${localIp}:${PORT}/order`
  });
});

// Route aliases เพื่อความสะดวก
app.get('/order', (req, res) => {
  res.sendFile(getHtmlPath('order-form.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(getHtmlPath('order-dashboard.html'));
});

app.get('/kitchen', (req, res) => {
  res.sendFile(getHtmlPath('order-dashboard.html'));
});

app.get('/qr', (req, res) => {
  res.sendFile(getHtmlPath('qr-generator.html'));
});


// Start Server
app.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log(`🚀 เซิร์ฟเวอร์พร้อมทำงาน:`);
  console.log(`   - บนคอมพิวเตอร์นี้: http://localhost:${PORT}`);
  console.log(`   - บนมือถือ (Wi-Fi เดียวกัน): http://${localIp}:${PORT}/order?table=1`);
  console.log(`👨‍🍳 หน้าจอห้องครัว: http://localhost:${PORT}/dashboard`);
  console.log(`🖨️ หน้าสร้าง QR Code: http://localhost:${PORT}/qr`);
});

