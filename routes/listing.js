const express = require('express');
const router = express.Router();

function toDisplayName(user) {
  return user?.display_name || user?.email?.split('@')[0] || 'Donor';
}

router.post('/create', async (req, res) => {
  const { donorId, title, qty, foodType, lng, lat } = req.body;

  if (!donorId || !title || !qty) {
    return res.status(400).json({ msg: 'donorId, title and qty are required' });
  }

  try {
    const db = await req.db;
    const donor = await db.get('SELECT id, display_name, email FROM users WHERE id = ? AND role = ?', [donorId, 'donor']);
    if (!donor) {
      return res.status(400).json({ msg: 'Valid donor account required' });
    }

    const numericQty = Number(qty);
    const result = await db.run(
      `INSERT INTO listings (donor_id, title, qty, total_qty, available_qty, foodType, lng, lat, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [donorId, title, numericQty, numericQty, numericQty, foodType || 'Meal', Number(lng), Number(lat)]
    );

    await db.run(
      `INSERT INTO notifications (user_id, type, message)
       VALUES (?, ?, ?)`,
      [donorId, 'listing_created', `Your listing "${title}" is now live.`]
    );

    res.status(201).json({
      id: result.lastID,
      message: 'Listing created successfully',
      donorName: toDisplayName(donor)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/nearby', async (req, res) => {
  try {
    const db = await req.db;
    const { lng, lat, foodType } = req.query;

    let sql = `
      SELECT l.*, u.display_name AS donor_name, u.email AS donor_email
        , u.home_lat AS donor_live_lat, u.home_lng AS donor_live_lng
      FROM listings l
      LEFT JOIN users u ON u.id = l.donor_id
      WHERE l.status IN ('active', 'partially_reserved') AND COALESCE(l.available_qty, 0) > 0
    `;
    const params = [];

    if (foodType) {
      sql += ' AND l.foodType = ?';
      params.push(foodType);
    }

    const listings = await db.all(sql, params);
    const enhanced = listings
      .map((item) => ({
        ...item,
        donor_name: item.donor_name || item.donor_email?.split('@')[0] || 'Donor',
        distance: item.lat && item.lng && lat && lng ? (
          Math.sqrt(Math.pow(Number(item.lat) - Number(lat), 2) + Math.pow(Number(item.lng) - Number(lng), 2)) * 111
        ).toFixed(1) : (Math.random() * 5).toFixed(1)
      }))
      .sort((a, b) => Number(a.distance) - Number(b.distance));

    res.json(enhanced);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const db = await req.db;
    const listings = await db.all(`
      SELECT l.*, u.display_name AS donor_name, u.email AS donor_email
        , u.home_lat AS donor_live_lat, u.home_lng AS donor_live_lng
      FROM listings l
      LEFT JOIN users u ON u.id = l.donor_id
      WHERE l.status IN ('active', 'partially_reserved') AND COALESCE(l.available_qty, 0) > 0
      ORDER BY l.created_at DESC
    `);

    res.json(listings.map((item) => ({
      ...item,
      donor_name: item.donor_name || item.donor_email?.split('@')[0] || 'Donor'
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/donor/:donorId', async (req, res) => {
  try {
    const db = await req.db;
    const donorId = Number(req.params.donorId);

    const listings = await db.all(`
      SELECT l.*,
        (SELECT COUNT(*) FROM requests r WHERE r.listing_id = l.id) AS selection_count
      FROM listings l
      WHERE l.donor_id = ?
      ORDER BY l.created_at DESC
    `, [donorId]);

    res.json(listings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
