const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function ensureColumn(db, table, column, sqlType) {
    const columns = await db.all(`PRAGMA table_info(${table});`);
    const existingColumns = new Set(columns.map((item) => item.name));

    if (!existingColumns.has(column)) {
        await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType};`);
    }
}

async function initDB() {
    const db = await open({
        filename: './foodbridge.db',
        driver: sqlite3.Database
    });

    await db.exec('PRAGMA foreign_keys = ON;');

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            display_name TEXT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT CHECK(role IN ('donor', 'receiver', 'delivery')) NOT NULL,
            points INTEGER DEFAULT 0,
            home_lat REAL,
            home_lng REAL
        );
    `);

    await ensureColumn(db, 'users', 'display_name', 'TEXT');
    await ensureColumn(db, 'users', 'home_lat', 'REAL');
    await ensureColumn(db, 'users', 'home_lng', 'REAL');

    await db.exec(`
        CREATE TABLE IF NOT EXISTS listings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            donor_id INTEGER,
            title TEXT NOT NULL,
            qty INTEGER NOT NULL,
            total_qty INTEGER,
            available_qty INTEGER,
            foodType TEXT,
            lng REAL,
            lat REAL,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(donor_id) REFERENCES users(id)
        );
    `);

    await ensureColumn(db, 'listings', 'donor_id', 'INTEGER REFERENCES users(id)');
    await ensureColumn(db, 'listings', 'foodType', 'TEXT');
    await ensureColumn(db, 'listings', 'lng', 'REAL');
    await ensureColumn(db, 'listings', 'lat', 'REAL');
    await ensureColumn(db, 'listings', 'total_qty', 'INTEGER');
    await ensureColumn(db, 'listings', 'available_qty', 'INTEGER');

    await db.exec(`
        UPDATE listings
        SET total_qty = COALESCE(total_qty, qty),
            available_qty = COALESCE(available_qty, qty),
            donor_id = donor_id
        WHERE total_qty IS NULL OR available_qty IS NULL;
    `);

    const donorCountRow = await db.get(`SELECT COUNT(*) AS donor_count FROM users WHERE role = 'donor'`);
    if (Number(donorCountRow?.donor_count || 0) === 1) {
        const onlyDonor = await db.get(`SELECT id FROM users WHERE role = 'donor' LIMIT 1`);
        if (onlyDonor?.id) {
            await db.run(`UPDATE listings SET donor_id = ? WHERE donor_id IS NULL`, [onlyDonor.id]);
        }
    }

    await db.exec(`
        CREATE TABLE IF NOT EXISTS requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            listing_id INTEGER NOT NULL,
            donor_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            delivery_user_id INTEGER,
            requested_qty INTEGER NOT NULL,
            status TEXT DEFAULT 'pending_delivery',
            assignment_mode TEXT DEFAULT 'manual',
            random_offer_expires_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(listing_id) REFERENCES listings(id),
            FOREIGN KEY(donor_id) REFERENCES users(id),
            FOREIGN KEY(receiver_id) REFERENCES users(id),
            FOREIGN KEY(delivery_user_id) REFERENCES users(id)
        );
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            message TEXT NOT NULL,
            related_request_id INTEGER,
            is_read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(related_request_id) REFERENCES requests(id)
        );
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id INTEGER NOT NULL UNIQUE,
            donor_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            stars INTEGER NOT NULL,
            comment TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(request_id) REFERENCES requests(id),
            FOREIGN KEY(donor_id) REFERENCES users(id),
            FOREIGN KEY(receiver_id) REFERENCES users(id)
        );
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS delivery_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            listing_id INTEGER NOT NULL,
            receiver_id INTEGER,
            distance REAL,
            transport_type TEXT,
            status TEXT DEFAULT 'assigned',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(listing_id) REFERENCES listings(id),
            FOREIGN KEY(receiver_id) REFERENCES users(id)
        );
    `);

    console.log('SQLite database ready and schema synced');
    return db;
}

module.exports = initDB;
