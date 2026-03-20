const express  = require('express');
const bcrypt   = require('bcryptjs');
const { body, param, query } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const db       = require('../config/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

// All admin routes require auth + admin role
router.use(requireAuth, requireRole('admin'));

// ── GET /api/admin/stats ──────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [s, as, tc, te, ta] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'student'").get(),
      db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'student' AND is_active = 1").get(),
      db.prepare('SELECT COUNT(*) AS n FROM courses WHERE is_active = 1').get(),
      db.prepare("SELECT COUNT(*) AS n FROM enrollments WHERE status = 'active'").get(),
      db.prepare('SELECT COUNT(*) AS n FROM announcements WHERE is_active = 1').get(),
    ]);
    return res.json({ stats: {
      total_students:      s.n,
      active_students:     as.n,
      total_courses:       tc.n,
      total_enrollments:   te.n,
      total_announcements: ta.n,
    }});
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load stats.' });
  }
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────
router.get('/users',
  [
    query('role').optional().isIn(['student', 'admin']),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('search').optional().trim().isLength({ max: 100 }),
  ],
  validate,
  async (req, res) => {
    const role   = req.query.role   || null;
    const page   = req.query.page   || 1;
    const limit  = req.query.limit  || 20;
    const search = req.query.search || null;
    const offset = (page - 1) * limit;

    let where = 'WHERE 1=1';
    const params = [];

    if (role)   { where += ' AND u.role = ?';   params.push(role); }
    if (search) {
      where += ' AND (u.full_name LIKE ? OR u.email LIKE ? OR u.username LIKE ?)';
      const q = `%${search}%`;
      params.push(q, q, q);
    }

    const totalRow = await db.prepare(`SELECT COUNT(*) AS n FROM users u ${where}`).get(...params);
    const total    = totalRow.n;

    const users = await db.prepare(`
      SELECT u.id, u.uuid, u.full_name, u.email, u.username, u.role,
             u.student_id, u.is_active, u.created_at, u.last_login
      FROM users u ${where}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return res.json({ users, total, page, limit });
  }
);

// ── GET /api/admin/users/:id ──────────────────────────────────────────────────
router.get('/users/:id', async (req, res) => {
  const user = await db.prepare(`
    SELECT id, uuid, full_name, email, username, role,
           student_id, is_active, created_at, last_login
    FROM users WHERE id = ?
  `).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const enrollments = await db.prepare(`
    SELECT c.code, c.name, e.status, e.grade, e.enrolled_at
    FROM enrollments e JOIN courses c ON c.id = e.course_id
    WHERE e.student_id = ?
    ORDER BY e.enrolled_at DESC
  `).all(req.params.id);

  return res.json({ user, enrollments });
});

// ── POST /api/admin/users ─────────────────────────────────────────────────────
router.post('/users',
  [
    body('full_name').trim().isLength({ min: 2, max: 80 }),
    body('email').trim().isEmail().normalizeEmail(),
    body('username').trim().isLength({ min: 3, max: 30 }).matches(/^[a-zA-Z0-9_]+$/),
    body('password').isLength({ min: 8 })
      .matches(/[A-Z]/).matches(/[a-z]/).matches(/[0-9]/).matches(/[^A-Za-z0-9]/),
    body('role').isIn(['student', 'admin']),
  ],
  validate,
  async (req, res) => {
    const { full_name, email, username, password, role } = req.body;

    const byEmail = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (byEmail) return res.status(409).json({ error: 'Email already registered.' });

    const byUser = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (byUser) return res.status(409).json({ error: 'Username already taken.' });

    const hash = await bcrypt.hash(password, 12);
    const uuid = uuidv4();

    let student_id = null;
    if (role === 'student') {
      const countRow = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'student'").get();
      student_id = `STU-${String(countRow.n + 1).padStart(4, '0')}`;
    }

    const result = await db.prepare(`
      INSERT INTO users (uuid, full_name, email, username, password_hash, role, student_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uuid, full_name, email, username, hash, role, student_id);

    return res.status(201).json({ message: 'User created.', id: result.lastInsertRowid });
  }
);

// ── PUT /api/admin/users/:id ──────────────────────────────────────────────────
router.put('/users/:id',
  [
    body('full_name').optional().trim().isLength({ min: 2, max: 80 }),
    body('email').optional().trim().isEmail().normalizeEmail(),
    body('is_active').optional().isBoolean().toBoolean(),
    body('role').optional().isIn(['student', 'admin']),
  ],
  validate,
  async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    const user   = await db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (userId === req.user.id && req.body.role && req.body.role !== 'admin') {
      return res.status(400).json({ error: 'Cannot change your own role.' });
    }
    if (userId === req.user.id && req.body.is_active === false) {
      return res.status(400).json({ error: 'Cannot disable your own account.' });
    }

    const fields = [];
    const values = [];

    if (req.body.full_name !== undefined) { fields.push('full_name = ?');  values.push(req.body.full_name); }
    if (req.body.email     !== undefined) {
      const conflict = await db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(req.body.email, userId);
      if (conflict) return res.status(409).json({ error: 'Email already in use.' });
      fields.push('email = ?'); values.push(req.body.email);
    }
    if (req.body.is_active !== undefined) { fields.push('is_active = ?');  values.push(req.body.is_active ? 1 : 0); }
    if (req.body.role      !== undefined) { fields.push('role = ?');        values.push(req.body.role); }

    if (!fields.length) return res.status(400).json({ error: 'No fields to update.' });

    values.push(userId);
    await db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    return res.json({ message: 'User updated.' });
  }
);

// ── DELETE /api/admin/users/:id ───────────────────────────────────────────────
router.delete('/users/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (userId === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account.' });

  const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  await db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return res.json({ message: 'User deleted.' });
});

// ── GET /api/admin/courses ────────────────────────────────────────────────────
router.get('/courses', async (req, res) => {
  const courses = await db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id AND status = 'active') AS enrolled_count
    FROM courses c ORDER BY c.code
  `).all();
  return res.json({ courses });
});

// ── POST /api/admin/courses ───────────────────────────────────────────────────
router.post('/courses',
  [
    body('code').trim().isLength({ min: 2, max: 20 }).matches(/^[A-Z0-9]+$/),
    body('name').trim().isLength({ min: 3, max: 100 }),
    body('instructor').trim().isLength({ min: 2, max: 80 }),
    body('credits').isInt({ min: 1, max: 6 }).toInt(),
    body('semester').trim().isLength({ min: 3, max: 30 }),
    body('capacity').optional().isInt({ min: 1, max: 500 }).toInt(),
    body('description').optional().trim().isLength({ max: 500 }),
  ],
  validate,
  async (req, res) => {
    const { code, name, instructor, credits, semester, capacity = 30, description = '' } = req.body;

    const exists = await db.prepare('SELECT id FROM courses WHERE code = ?').get(code);
    if (exists) return res.status(409).json({ error: 'Course code already exists.' });

    const result = await db.prepare(`
      INSERT INTO courses (code, name, description, instructor, credits, semester, capacity)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(code, name, description, instructor, credits, semester, capacity);

    return res.status(201).json({ message: 'Course created.', id: result.lastInsertRowid });
  }
);

// ── PUT /api/admin/courses/:id ────────────────────────────────────────────────
router.put('/courses/:id',
  [
    body('name').optional().trim().isLength({ min: 3, max: 100 }),
    body('instructor').optional().trim().isLength({ min: 2, max: 80 }),
    body('credits').optional().isInt({ min: 1, max: 6 }).toInt(),
    body('is_active').optional().isBoolean().toBoolean(),
  ],
  validate,
  async (req, res) => {
    const course = await db.prepare('SELECT id FROM courses WHERE id = ?').get(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found.' });

    const fields = [], values = [];
    if (req.body.name       !== undefined) { fields.push('name = ?');       values.push(req.body.name); }
    if (req.body.instructor !== undefined) { fields.push('instructor = ?'); values.push(req.body.instructor); }
    if (req.body.credits    !== undefined) { fields.push('credits = ?');    values.push(req.body.credits); }
    if (req.body.is_active  !== undefined) { fields.push('is_active = ?');  values.push(req.body.is_active ? 1 : 0); }

    if (!fields.length) return res.status(400).json({ error: 'No fields to update.' });

    values.push(req.params.id);
    await db.prepare(`UPDATE courses SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return res.json({ message: 'Course updated.' });
  }
);

// ── GET /api/admin/announcements ──────────────────────────────────────────────
router.get('/announcements', async (req, res) => {
  const announcements = await db.prepare(`
    SELECT a.*, u.full_name AS author
    FROM announcements a JOIN users u ON u.id = a.author_id
    ORDER BY a.created_at DESC
  `).all();
  return res.json({ announcements });
});

// ── POST /api/admin/announcements ─────────────────────────────────────────────
router.post('/announcements',
  [
    body('title').trim().isLength({ min: 3, max: 150 }),
    body('content').trim().isLength({ min: 10, max: 2000 }),
    body('target').isIn(['all', 'students', 'admins']),
  ],
  validate,
  async (req, res) => {
    const { title, content, target } = req.body;
    const result = await db.prepare(
      'INSERT INTO announcements (title, content, author_id, target) VALUES (?, ?, ?, ?)'
    ).run(title, content, req.user.id, target);
    return res.status(201).json({ message: 'Announcement created.', id: result.lastInsertRowid });
  }
);

// ── DELETE /api/admin/announcements/:id ───────────────────────────────────────
router.delete('/announcements/:id', async (req, res) => {
  const result = await db.prepare('UPDATE announcements SET is_active = 0 WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Announcement not found.' });
  return res.json({ message: 'Announcement removed.' });
});

module.exports = router;
