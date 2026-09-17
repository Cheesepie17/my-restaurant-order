require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const rateLimit = require('express-rate-limit');
const db = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000;

// ดึงไฟล์ HTML ตัวใหม่ล่าสุดที่ root ก่อนเสมอ
function getHtmlPath(filename) {
  const rootPath = path.join(__dirname, filename);
  if (fs.existsSync(rootPath)) {
    return rootPath;
  }
  return path.join(__dirname, 'public', filename);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

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
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: { success: false, error: 'คุณทำรายการบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' },
  standardHeaders: true,
  legacyHeaders: false,
});

async function sendLineOrderNotification(order, items) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const targetId = process.env.LINE_TARGET_ID;

  if (!token || !targetId || token === 'your_line_channel_access_token_here') {
    return false;
  }

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
        messages: [{ type: 'text', text: messageText }]
      })
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

app.get('/api/menu', (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order ASC, id ASC').all();
    const items = db.prepare('SELECT * FROM menu_items WHERE is_available = 1 ORDER BY category_id ASC, id ASC').all();

    const menuWithCategories = categories.map(cat => ({
      id: cat.id,
      name: cat.name,
      items: items.filter(item => item.category_id === cat.id)
    })).filter(cat => cat.items.length > 0);

    res.json({ success: true, data: menuWithCategories });
  } catch (err) {
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการดึงรายการเมนู' });
  }
});

app.post('/api/orders', orderLimiter, async (req, res) => {
  try {
    const { table_no, customer_note, items } = req.body;
    const tableNum = parseInt(table_no, 10);
    if (isNaN(tableNum) || tableNum < 1 || tableNum > 4) {
      return res.status(400).json({ success: false, error: 'เลขโต๊ะไม่ถูกต้อง (1-4 เท่านั้น)' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'กรุณาเลือกรายการอาหาร' });
    }

    const itemIds = items.map(i => parseInt(i.menu_item_id, 10)).filter(id => !isNaN(id));
    const placeholders = itemIds.map(() => '?').join(',');
    const dbItems = db.prepare(`SELECT * FROM menu_items WHERE id IN (${placeholders}) AND is_available = 1`).all(...itemIds);
    const dbItemMap = new Map(dbItems.map(item => [Number(item.id), item]));

    let calculatedTotalPrice = 0;
    const validatedOrderItems = [];

    for (const item of items) {
      const menuItemId = parseInt(item.menu_item_id, 10);
      const qty = parseInt(item.quantity, 10);
      const specialReq = (item.special_request || '').toString().slice(0, 250).trim();

      const foundItem = dbItemMap.get(menuItemId);
      if (!foundItem) continue;

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

    sendLineOrderNotification(newOrder, validatedOrderItems).catch(console.error);

    res.status(201).json({
      success: true,
      message: 'บันทึกออเดอร์เรียบร้อยแล้ว',
      data: { order_id: newOrder.id, table_no: newOrder.table_no, total_price: newOrder.total_price }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการบันทึกออเดอร์' });
  }
});

app.get('/api/orders', (req, res) => {
  try {
    const orders = db.prepare('SELECT * FROM orders ORDER BY id ASC').all();
    if (orders.length === 0) return res.json({ success: true, data: [] });

    const orderIds = orders.map(o => Number(o.id));
    const placeholders = orderIds.map(() => '?').join(',');
    const items = db.prepare(`SELECT * FROM order_items WHERE order_id IN (${placeholders})`).all(...orderIds);

    const itemsByOrderId = {};
    for (const item of items) {
      const oId = Number(item.order_id);
      if (!itemsByOrderId[oId]) itemsByOrderId[oId] = [];
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
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการดึงรายการออเดอร์' });
  }
});

app.patch('/api/orders/:id', (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const { status } = req.body;
    db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`).run(status, orderId);
    res.json({ success: true, data: { order_id: orderId, status } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
  }
});

app.get('/api/host-info', (req, res) => {
  const localIp = getLocalIp();
  res.json({ localIp, port: PORT, localOrderUrl: `http://${localIp}:${PORT}/order` });
});

// Route aliases
app.get('/order', (req, res) => res.sendFile(getHtmlPath('order-form.html')));
app.get('/dashboard', (req, res) => res.sendFile(getHtmlPath('order-dashboard.html')));
app.get('/kitchen', (req, res) => res.sendFile(getHtmlPath('order-dashboard.html')));
app.get('/qr', (req, res) => res.sendFile(getHtmlPath('qr-generator.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
