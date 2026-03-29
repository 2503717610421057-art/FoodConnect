const express = require('express');
const router = express.Router();

const RANDOM_OFFER_WINDOW_MS = 45 * 1000;

function donorMilestone(completedCount, avgStars) {
  if (completedCount >= 100 && avgStars >= 4.5) return 'Mega Donor';
  if (completedCount >= 50) return 'Community Hero';
  if (completedCount >= 10) return 'Rising Donor';
  return 'Starter Donor';
}

async function refreshExpiredRandomOffers(db) {
  await db.run(`
    UPDATE requests
    SET status = 'pending_delivery',
        delivery_user_id = NULL,
        random_offer_expires_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE status = 'delivery_offered'
      AND random_offer_expires_at IS NOT NULL
      AND datetime(random_offer_expires_at) <= datetime('now')
  `);
}

async function addNotification(db, userId, type, message, requestId = null) {
  await db.run(
    `INSERT INTO notifications (user_id, type, message, related_request_id)
     VALUES (?, ?, ?, ?)`,
    [userId, type, message, requestId]
  );
}

async function getLeaderboard(db) {
  return db.all(`
    SELECT
      u.id,
      COALESCE(u.display_name, substr(u.email, 1, instr(u.email, '@') - 1), 'Volunteer') AS name,
      COUNT(r.id) AS deliveries,
      COUNT(r.id) AS streak
    FROM requests r
    JOIN users u ON u.id = r.delivery_user_id
    WHERE r.status = 'delivered'
      AND strftime('%Y-%m', r.updated_at) = strftime('%Y-%m', 'now')
    GROUP BY u.id, u.display_name, u.email
    ORDER BY deliveries DESC, name ASC
    LIMIT 10
  `);
}

router.get('/delivery', async (req, res) => {
  try {
    const db = await req.db;
    await refreshExpiredRandomOffers(db);

    const rows = await db.all(`
      SELECT
        r.id,
        r.requested_qty AS qty,
        r.status,
        r.assignment_mode,
        r.delivery_user_id,
        r.random_offer_expires_at,
        l.title,
        l.foodType,
        l.lat,
        l.lng,
        l.donor_id,
        COALESCE(d.display_name, substr(d.email, 1, instr(d.email, '@') - 1), 'Donor') AS donor_name,
        COALESCE(rc.display_name, substr(rc.email, 1, instr(rc.email, '@') - 1), 'Receiver') AS receiver_name,
        rc.home_lat AS receiver_lat,
        rc.home_lng AS receiver_lng
      FROM requests r
      JOIN listings l ON l.id = r.listing_id
      JOIN users d ON d.id = r.donor_id
      JOIN users rc ON rc.id = r.receiver_id
      WHERE r.status IN ('pending_delivery', 'delivery_offered', 'delivery_accepted')
      ORDER BY r.created_at DESC
    `);

    res.json(rows.map((item) => ({
      ...item,
      distance: item.receiver_lat != null && item.receiver_lng != null && item.lat != null && item.lng != null
        ? (Math.sqrt(Math.pow(Number(item.lat) - Number(item.receiver_lat), 2) + Math.pow(Number(item.lng) - Number(item.receiver_lng), 2)) * 111).toFixed(1)
        : (Math.random() * 12 + 1).toFixed(1)
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/create', async (req, res) => {
  const { listingId, receiverId, requestedQty } = req.body;
  if (!listingId || !receiverId || !requestedQty) {
    return res.status(400).json({ msg: 'listingId, receiverId and requestedQty are required' });
  }

  try {
    const db = await req.db;
    const listing = await db.get(`
      SELECT l.*, COALESCE(u.display_name, substr(u.email, 1, instr(u.email, '@') - 1), 'Donor') AS donor_name
      FROM listings l
      LEFT JOIN users u ON u.id = l.donor_id
      WHERE l.id = ?
    `, [listingId]);

    if (!listing) return res.status(404).json({ msg: 'Listing not found' });
    if (!listing.donor_id) return res.status(400).json({ msg: 'This legacy listing is missing donor ownership. Please recreate the listing or run donor backfill.' });

    const qty = Number(requestedQty);
    if (qty <= 0) return res.status(400).json({ msg: 'Requested quantity must be positive' });
    if (qty > Number(listing.available_qty ?? listing.qty ?? 0)) {
      return res.status(400).json({ msg: 'Requested quantity exceeds available stock' });
    }

    await db.run('BEGIN TRANSACTION');
    const requestResult = await db.run(`
      INSERT INTO requests (listing_id, donor_id, receiver_id, requested_qty, status, assignment_mode)
      VALUES (?, ?, ?, ?, 'pending_delivery', 'manual')
    `, [listingId, listing.donor_id, receiverId, qty]);

    const nextAvailableQty = Number(listing.available_qty ?? listing.qty) - qty;
    await db.run(`
      UPDATE listings
      SET available_qty = ?, status = ?
      WHERE id = ?
    `, [nextAvailableQty, nextAvailableQty > 0 ? 'partially_reserved' : 'fully_reserved', listingId]);

    await addNotification(
      db,
      listing.donor_id,
      'request_created',
      `Your listing "${listing.title}" was selected for ${qty} item(s).`,
      requestResult.lastID
    );
    await db.run('COMMIT');

    res.status(201).json({ id: requestResult.lastID, message: 'Request created', availableQty: nextAvailableQty });
  } catch (err) {
    try {
      const db = await req.db;
      await db.run('ROLLBACK');
    } catch {}
    res.status(500).json({ error: err.message });
  }
});

router.post('/:requestId/cancel', async (req, res) => {
  const requestId = Number(req.params.requestId);
  const cancelQty = Number(req.body.cancelQty || 0);

  if (!cancelQty || cancelQty < 1) {
    return res.status(400).json({ msg: 'cancelQty must be at least 1' });
  }

  try {
    const db = await req.db;
    const request = await db.get(`
      SELECT r.*, l.title, l.available_qty, l.total_qty, l.id AS listing_id
      FROM requests r
      JOIN listings l ON l.id = r.listing_id
      WHERE r.id = ?
    `, [requestId]);

    if (!request) return res.status(404).json({ msg: 'Request not found' });
    if (!['pending_delivery', 'delivery_offered', 'delivery_accepted'].includes(request.status)) {
      return res.status(400).json({ msg: 'This request can no longer be cancelled' });
    }
    if (cancelQty > Number(request.requested_qty)) {
      return res.status(400).json({ msg: 'Cannot cancel more than requested quantity' });
    }

    await db.run('BEGIN TRANSACTION');
    const remainingQty = Number(request.requested_qty) - cancelQty;
    const restoredAvailableQty = Number(request.available_qty) + cancelQty;

    await db.run(`
      UPDATE listings
      SET available_qty = ?, status = ?
      WHERE id = ?
    `, [restoredAvailableQty, restoredAvailableQty > 0 ? 'active' : 'fully_reserved', request.listing_id]);

    if (remainingQty === 0) {
      await db.run(`
        UPDATE requests
        SET requested_qty = 0, status = 'cancelled_full', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [requestId]);
    } else {
      await db.run(`
        UPDATE requests
        SET requested_qty = ?, status = 'cancelled_partial', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [remainingQty, requestId]);
    }

    await addNotification(
      db,
      request.donor_id,
      'request_cancelled',
      `Receiver updated request for "${request.title}". ${cancelQty} item(s) were released back into stock.`,
      requestId
    );
    await db.run('COMMIT');

    res.json({
      message: remainingQty === 0 ? 'Request cancelled fully' : 'Request reduced successfully',
      remainingQty,
      availableQty: restoredAvailableQty
    });
  } catch (err) {
    try {
      const db = await req.db;
      await db.run('ROLLBACK');
    } catch {}
    res.status(500).json({ error: err.message });
  }
});

router.post('/:requestId/take', async (req, res) => {
  const requestId = Number(req.params.requestId);
  const deliveryUserId = Number(req.body.deliveryUserId);

  if (!deliveryUserId) return res.status(400).json({ msg: 'deliveryUserId is required' });

  try {
    const db = await req.db;
    await refreshExpiredRandomOffers(db);

    const request = await db.get(`
      SELECT r.*, l.title
      FROM requests r
      JOIN listings l ON l.id = r.listing_id
      WHERE r.id = ?
    `, [requestId]);

    if (!request) return res.status(404).json({ msg: 'Request not found' });
    if (!['pending_delivery', 'delivery_offered', 'cancelled_partial'].includes(request.status)) {
      return res.status(400).json({ msg: 'Request is not available for pickup' });
    }

    await db.run(`
      UPDATE requests
      SET delivery_user_id = ?, status = 'delivery_accepted', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [deliveryUserId, requestId]);

    await addNotification(db, request.donor_id, 'delivery_accepted', `A delivery volunteer accepted "${request.title}".`, requestId);
    await addNotification(db, request.receiver_id, 'delivery_accepted', `A delivery volunteer accepted your request for "${request.title}".`, requestId);

    res.json({ message: 'Order accepted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:requestId/random-assign', async (req, res) => {
  const requestId = Number(req.params.requestId);

  try {
    const db = await req.db;
    await refreshExpiredRandomOffers(db);

    const request = await db.get(`SELECT * FROM requests WHERE id = ?`, [requestId]);
    if (!request) return res.status(404).json({ msg: 'Request not found' });

    const volunteers = await db.all(`SELECT id FROM users WHERE role = 'delivery' ORDER BY RANDOM()`);
    if (!volunteers.length) return res.status(400).json({ msg: 'No delivery volunteers available' });

    const chosen = volunteers[0];
    const expiresAt = new Date(Date.now() + RANDOM_OFFER_WINDOW_MS).toISOString();
    await db.run(`
      UPDATE requests
      SET delivery_user_id = ?, status = 'delivery_offered', assignment_mode = 'random', random_offer_expires_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [chosen.id, expiresAt, requestId]);

    await addNotification(db, chosen.id, 'random_offer', `A delivery request is waiting for your acceptance.`, requestId);
    res.json({ message: 'Random offer sent', deliveryUserId: chosen.id, expiresAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:requestId/complete', async (req, res) => {
  const requestId = Number(req.params.requestId);

  try {
    const db = await req.db;
    const request = await db.get(`
      SELECT r.*, l.title
      FROM requests r
      JOIN listings l ON l.id = r.listing_id
      WHERE r.id = ?
    `, [requestId]);

    if (!request) return res.status(404).json({ msg: 'Request not found' });
    if (!request.delivery_user_id) return res.status(400).json({ msg: 'No delivery volunteer assigned' });

    await db.run(`
      UPDATE requests
      SET status = 'delivered', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [requestId]);

    await db.run(`
      UPDATE listings
      SET status = CASE WHEN available_qty > 0 THEN 'active' ELSE 'completed' END
      WHERE id = ?
    `, [request.listing_id]);

    await db.run(`UPDATE users SET points = COALESCE(points, 0) + 5 WHERE id = ?`, [request.donor_id]);
    await db.run(`UPDATE users SET points = COALESCE(points, 0) + 3 WHERE id = ?`, [request.delivery_user_id]);

    await addNotification(db, request.donor_id, 'delivery_completed', `Delivery completed for "${request.title}".`, requestId);
    await addNotification(db, request.receiver_id, 'delivery_completed', `Your request for "${request.title}" was delivered. Please leave a review.`, requestId);

    res.json({ message: 'Delivery marked complete' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:requestId/review', async (req, res) => {
  const requestId = Number(req.params.requestId);
  const { receiverId, stars, comment } = req.body;

  if (!receiverId || !stars) return res.status(400).json({ msg: 'receiverId and stars are required' });

  try {
    const db = await req.db;
    const request = await db.get(`SELECT * FROM requests WHERE id = ?`, [requestId]);
    if (!request) return res.status(404).json({ msg: 'Request not found' });
    if (request.receiver_id !== Number(receiverId)) return res.status(403).json({ msg: 'Only the receiver can review this request' });

    await db.run(`
      INSERT OR REPLACE INTO reviews (request_id, donor_id, receiver_id, stars, comment)
      VALUES (?, ?, ?, ?, ?)
    `, [requestId, request.donor_id, receiverId, Number(stars), comment || '']);

    await addNotification(db, request.donor_id, 'review_received', `You received a ${stars}-star review.`, requestId);
    res.json({ message: 'Review submitted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/receiver/:receiverId', async (req, res) => {
  try {
    const db = await req.db;
    const receiverId = Number(req.params.receiverId);
    const rows = await db.all(`
      SELECT
        r.*,
        l.title,
        l.foodType,
        COALESCE(d.display_name, substr(d.email, 1, instr(d.email, '@') - 1), 'Donor') AS donor_name,
        COALESCE(v.display_name, substr(v.email, 1, instr(v.email, '@') - 1), 'Pending') AS delivery_name
      FROM requests r
      JOIN listings l ON l.id = r.listing_id
      JOIN users d ON d.id = r.donor_id
      LEFT JOIN users v ON v.id = r.delivery_user_id
      WHERE r.receiver_id = ?
      ORDER BY r.created_at DESC
    `, [receiverId]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/notifications/:userId', async (req, res) => {
  try {
    const db = await req.db;
    const rows = await db.all(`
      SELECT *
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `, [Number(req.params.userId)]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/leaderboard/monthly', async (req, res) => {
  try {
    const db = await req.db;
    const rows = await getLeaderboard(db);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/donor/:donorId/live-map', async (req, res) => {
  try {
    const db = await req.db;
    const donorId = Number(req.params.donorId);
    const rows = await db.all(`
      SELECT
        r.id AS request_id,
        r.status,
        r.requested_qty,
        l.title,
        l.lat AS donor_lat,
        l.lng AS donor_lng,
        rc.home_lat AS receiver_lat,
        rc.home_lng AS receiver_lng,
        COALESCE(rc.display_name, substr(rc.email, 1, instr(rc.email, '@') - 1), 'Receiver') AS receiver_name
      FROM requests r
      JOIN listings l ON l.id = r.listing_id
      JOIN users rc ON rc.id = r.receiver_id
      WHERE r.donor_id = ?
        AND r.status IN ('pending_delivery', 'delivery_offered', 'delivery_accepted')
      ORDER BY r.created_at DESC
    `, [donorId]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/donor/:donorId/summary', async (req, res) => {
  try {
    const db = await req.db;
    const donorId = Number(req.params.donorId);
    const stats = await db.get(`
      SELECT
        COUNT(DISTINCT l.id) AS listings_count,
        COUNT(DISTINCT CASE WHEN r.status = 'delivered' THEN r.id END) AS completed_deliveries,
        ROUND(AVG(rv.stars), 1) AS average_stars
      FROM users u
      LEFT JOIN listings l ON l.donor_id = u.id
      LEFT JOIN requests r ON r.donor_id = u.id
      LEFT JOIN reviews rv ON rv.donor_id = u.id
      WHERE u.id = ?
    `, [donorId]);

    const recentReviews = await db.all(`
      SELECT rv.*, COALESCE(u.display_name, substr(u.email, 1, instr(u.email, '@') - 1), 'Receiver') AS receiver_name
      FROM reviews rv
      JOIN users u ON u.id = rv.receiver_id
      WHERE rv.donor_id = ?
      ORDER BY rv.created_at DESC
      LIMIT 5
    `, [donorId]);

    const notifications = await db.all(`
      SELECT *
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `, [donorId]);

    const completedCount = Number(stats?.completed_deliveries || 0);
    const averageStars = Number(stats?.average_stars || 0);

    res.json({
      ...stats,
      milestone: donorMilestone(completedCount, averageStars),
      reviews: recentReviews,
      notifications
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
