const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const router = express.Router();

const RESET_TOKENS = new Map();

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET || 'testsecret', { expiresIn: '1d' });
}

const VALID_ROLES = new Set(['donor', 'receiver', 'delivery']);

function normalizeRole(role) {
  return typeof role === 'string' ? role.toLowerCase() : '';
}

function validateRoleSelection(currentRole, desiredRole) {
  if (!desiredRole) {
    return { nextRole: currentRole };
  }

  if (!VALID_ROLES.has(desiredRole)) {
    return { error: 'Invalid role selected' };
  }

  if (currentRole === 'donor' && desiredRole !== 'donor') {
    return { error: 'Certified donors must continue as donors.' };
  }

  if ((currentRole === 'receiver' || currentRole === 'delivery') && desiredRole !== currentRole && desiredRole !== 'donor') {
    return { error: 'You can continue with your assigned role or upgrade to donor only.' };
  }

  return { nextRole: desiredRole || currentRole };
}

// Register a user (simple, email + password + role)
router.post('/register', async (req, res) => {
  const { displayName, email, password, role, homeLat, homeLng } = req.body;
  const normalizedRole = normalizeRole(role);
  if (!email || !password || !normalizedRole) return res.status(400).json({ msg: 'email, password, role are required' });
  if (!VALID_ROLES.has(normalizedRole)) return res.status(400).json({ msg: 'Invalid role selected' });
  if (homeLat == null || homeLng == null) return res.status(400).json({ msg: 'Profile location is required' });

  try {
    const db = await req.db;
    const existing = await db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing) return res.status(400).json({ msg: 'User already exists' });

    const hash = await bcrypt.hash(password, 10);
    const result = await db.run(
      'INSERT INTO users (display_name, email, password, role, points, home_lat, home_lng) VALUES (?, ?, ?, ?, 0, ?, ?)',
      [displayName || email.split('@')[0], email.toLowerCase(), hash, normalizedRole, Number(homeLat), Number(homeLng)]
    );

    const user = {
      id: result.lastID,
      display_name: displayName || email.split('@')[0],
      email: email.toLowerCase(),
      role: normalizedRole,
      points: 0,
      home_lat: Number(homeLat),
      home_lng: Number(homeLng)
    };
    const token = signToken({ id: user.id, role: user.role });
    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  const { email, password, desiredRole } = req.body;
  if (!email || !password) return res.status(400).json({ msg: 'Email and password required' });

  try {
    const db = await req.db;
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (!user) return res.status(401).json({ msg: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ msg: 'Invalid credentials' });

    const roleDecision = validateRoleSelection(user.role, normalizeRole(desiredRole));
    if (roleDecision.error) return res.status(403).json({ msg: roleDecision.error });

    if (roleDecision.nextRole !== user.role) {
      await db.run('UPDATE users SET role = ? WHERE id = ?', [roleDecision.nextRole, user.id]);
      user.role = roleDecision.nextRole;
    }

    const token = signToken({ id: user.id, role: user.role });
    delete user.password;
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ msg: 'Email required' });

  try {
    const db = await req.db;
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (!user) return res.status(200).json({ msg: 'If your email exists, reset link is sent.' });

    const token = Math.random().toString(36).substring(2, 15);
    RESET_TOKENS.set(token, { userId: user.id, expires: Date.now() + 3600 * 1000 });

    const resetUrl = `http://localhost:4303/reset?token=${encodeURIComponent(token)}`;
    console.log(`Reset token for ${email}: ${resetUrl}`);
    res.json({ msg: 'Reset link sent to your email (console for dev)', resetUrl, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ msg: 'token and newPassword required' });

  const entry = RESET_TOKENS.get(token);
  if (!entry || entry.expires < Date.now()) {
    return res.status(400).json({ msg: 'Invalid or expired token' });
  }

  try {
    const hash = await bcrypt.hash(newPassword, 10);
    const db = await req.db;
    await db.run('UPDATE users SET password = ? WHERE id = ?', [hash, entry.userId]);
    RESET_TOKENS.delete(token);
    res.json({ msg: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ msg: 'Unauthorized' });

  try {
    const token = auth.split(' ')[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'testsecret');
    const db = await req.db;
    const user = await db.get('SELECT id, display_name, email, role, points, home_lat, home_lng FROM users WHERE id = ?', [payload.id]);
    if (!user) return res.status(404).json({ msg: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(401).json({ msg: 'Invalid token' });
  }
});

router.post('/location', async (req, res) => {
  const { userId, lat, lng } = req.body;
  if (!userId || lat == null || lng == null) return res.status(400).json({ msg: 'userId, lat, lng are required' });

  try {
    const db = await req.db;
    await db.run('UPDATE users SET home_lat = ?, home_lng = ? WHERE id = ?', [Number(lat), Number(lng), Number(userId)]);
    res.json({ msg: 'Location updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
