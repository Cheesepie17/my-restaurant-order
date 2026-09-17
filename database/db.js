const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'restaurant.db');
const db = new DatabaseSync(dbPath);

// เปิดใช้งาน Write-Ahead Logging เพื่อประสิทธิภาพ
db.exec('PRAGMA journal_mode = WAL;');

// สร้างโครงสร้างตารางฐานข้อมูล
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    description TEXT DEFAULT '',
    is_available INTEGER DEFAULT 1,
    FOREIGN KEY (category_id) REFERENCES categories (id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_no INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'preparing', 'served', 'cancelled')) DEFAULT 'pending',
    total_price REAL NOT NULL DEFAULT 0,
    customer_note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    menu_item_id INTEGER,
    item_name TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    special_request TEXT DEFAULT '',
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
  );
`);

// ตรวจสอบและ Seed ข้อมูลเมนูเริ่มต้น หากยังไม่มีข้อมูล
const countCategories = db.prepare('SELECT COUNT(*) as count FROM categories').get();

if (Number(countCategories.count) === 0) {
  console.log('🌱 กำลังสร้างข้อมูลเมนูเริ่มต้นลงในฐานข้อมูล...');

  const insertCategory = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
  const insertItem = db.prepare('INSERT INTO menu_items (category_id, name, price, description, is_available) VALUES (?, ?, ?, ?, ?)');

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. หมวดอาหารจานเดียว / ข้าว
    const catRice = insertCategory.run('อาหารจานเดียว / เมนูข้าว', 1);
    const riceId = Number(catRice.lastInsertRowid);

    const riceItems = [
      { name: 'ข้าวกะเพราหมูสับเต้าหู้กรอบ', price: 60, desc: 'กะเพราหมูสับรสจัดจ้านพร้อมเต้าหู้ไข่ทอดกรอบ' },
      { name: 'ข้าวกะเพรา', price: 50, desc: 'ผัดกะเพราสูตรโบราณ รสเข้มข้น' },
      { name: 'ข้าวกะเพราเครื่องในไก่', price: 55, desc: 'กะเพราเครื่องในไก่สดใหม่ ผัดใบกะเพราหอมๆ' },
      { name: 'ข้าวหมูกรอบคั่วพริกเกลือ', price: 65, desc: 'หมูกรอบชิ้นโต คั่วพริกเกลือกระเทียมสด' },
      { name: 'ข้าวหมูนุ่มผัดน้ำพริกเผานมสดใบโหระพา', price: 60, desc: 'หมูนุ่มละมุน ผัดน้ำพริกเผารสกลมกล่อม' },
      { name: 'ข้าวหมูสับผัดเผ็ดพริกไทยอ่อนใบโหระพา', price: 60, desc: 'รสชาติเผ็ดร้อน หอมกลิ่นสมุนไพร' },
      { name: 'ข้าวห่อหมกไข่ข้นทะเล', price: 75, desc: 'ไข่ข้นนุ่มละมุน ผสานเครื่องห่อหมกทะเลเข้มข้น' },
      { name: 'ข้าวไข่ข้นกุ้ง', price: 65, desc: 'ไข่ข้นเยิ้มๆ ท็อปด้วยกุ้งสดเด้ง' },
      { name: 'ข้าวผัดปู', price: 70, desc: 'ข้าวผัดเนื้อปูเน้นๆ กลิ่นกระทะหอมกรุ่น' },
      { name: 'ข้าวผัด', price: 50, desc: 'ข้าวผัดโบราณ หอมกลิ่นกระทะ' },
      { name: 'ข้าวผัดกะเพราหมูตุ๋น', price: 65, desc: 'หมูตุ๋นเปื่อยนุ่ม ผัดกะเพรารสเด็ด' },
      { name: 'ข้าวผัดกะเพราหน่อไม้ดอง', price: 55, desc: 'กะเพราหน่อไม้ดอง เผ็ดเปรี้ยวลงตัว' },
      { name: 'ข้าวทอดกระเทียม', price: 50, desc: 'กระเทียมเจียวหอมกรอบ ราดข้าวสวยร้อนๆ' },
      { name: 'ข้าวคะน้า', price: 50, desc: 'คะน้าสดกรอบ ผัดน้ำมันหอย' },
      { name: 'ข้าวผัดพริกแกง', price: 55, desc: 'ผัดพริกแกงตำเอง หอมสมุนไพร' },
      { name: 'ข้าวพริกแกงหน่อไม้ดอง', price: 55, desc: 'พริกแกงรสเข้มข้น ผัดหน่อไม้ดอง' },
      { name: 'ข้าวผัดพริกอ่อน', price: 50, desc: 'พริกหยวกผัดหมู รสกลมกล่อมไม่เผ็ดมาก' },
      { name: 'ข้าวผัดฉ่า', price: 55, desc: 'สมุนไพรผัดฉ่า รสแซ่บถึงใจ' },
      { name: 'ข้าวแพนงผัดแห้ง', price: 60, desc: 'แพนงกะทิเข้มข้น รสละมุน' },
      { name: 'ข้าวเขียวหวานผัดแห้ง', price: 60, desc: 'แกงเขียวหวานผัดแห้ง หอมใบโหระพา' },
      { name: 'ข้าวราดผัดพริกเผา', price: 55, desc: 'ผัดพริกเผารสหวานเค็มกำลังดี' },
      { name: 'ข้าวราดถั่วฝักยาวหมูสับ', price: 50, desc: 'ถั่วฝักยาวกรอบ ผัดหมูสับ' },
      { name: 'ข้าวไก่หวานซีอิ๊ว', price: 50, desc: 'ไก่ผัดซีอิ๊วดำหวาน รสชาติคุ้นเคย' },
      { name: 'ข้าวต้ม', price: 45, desc: 'ข้าวต้มร้อนๆ ซดคล่องคอ' },
      { name: 'ข้าวไข่เจียว', price: 40, desc: 'ไข่เจียวฟูกรอบ ร้อนๆ' },
      { name: 'ข้าวเปล่า', price: 10, desc: 'ข้าวสวยหอมมะลิ' }
    ];

    for (const item of riceItems) {
      insertItem.run(riceId, item.name, item.price, item.desc, 1);
    }

    // 2. หมวดเมนูเส้น / ต้ม
    const catNoodle = insertCategory.run('เมนูเส้น / ต้ม', 2);
    const noodleId = Number(catNoodle.lastInsertRowid);

    const noodleItems = [
      { name: 'ผัดซีอิ๊ว', price: 55, desc: 'เส้นใหญ่ผัดซีอิ๊วหอมกระทะ คะน้ากรอบ' },
      { name: 'ราดหน้า', price: 55, desc: 'น้ำราดหน้าเหนียวข้นกำลังดี คะน้าสดกรอบ' },
      { name: 'มาม่าผัดขี้เมา', price: 55, desc: 'เส้นมาม่าเหนียวนุ่ม ผัดขี้เมาเผ็ดร้อน' },
      { name: 'สุกี้', price: 60, desc: 'สุกี้น้ำ/แห้ง พร้อมน้ำจิ้มสูตรเด็ด' }
    ];

    for (const item of noodleItems) {
      insertItem.run(noodleId, item.name, item.price, item.desc, 1);
    }

    // 3. หมวดเครื่องดื่ม
    const catDrink = insertCategory.run('เครื่องดื่ม', 3);
    const drinkId = Number(catDrink.lastInsertRowid);

    const drinkItems = [
      { name: 'โค้ก ไม่มีน้ำตาล (ขวด)', price: 20, desc: 'โค้ก Zero Sugar สดชื่นคลายร้อน' },
      { name: 'ชเวปส์มะนาวโซดา ไม่มีน้ำตาล (กระป๋อง)', price: 20, desc: 'รสเปรี้ยวซ่า สดชื่น' },
      { name: 'น้ำส้มมินิทเมดสแปลช', price: 18, desc: 'น้ำส้มรสชาติสดชื่น ดับกระหาย' },
      { name: 'น้ำเปล่า + น้ำแข็ง', price: 10, desc: 'น้ำดื่มสะอาดพร้อมน้ำแข็งเย็นสดชื่น' }
    ];

    for (const item of drinkItems) {
      insertItem.run(drinkId, item.name, item.price, item.desc, 1);
    }

    db.exec('COMMIT;');
    console.log('✅ ลงข้อมูลเมนูเริ่มต้นเรียบร้อยแล้ว');
  } catch (err) {
    db.exec('ROLLBACK;');
    console.error('❌ ไม่สามารถ Seed ข้อมูลเมนูเริ่มต้นได้:', err);
  }
}

module.exports = db;
