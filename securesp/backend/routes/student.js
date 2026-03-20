const express  = require('express');
const { body } = require('express-validator');
const bcrypt   = require('bcryptjs');

const db       = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

// All student routes require authentication
router.use(requireAuth);

// ── GET /api/student/profile ──────────────────────────────────────────────────
router.get('/profile', async (req, res) => {
  const user = await db.prepare(`
    SELECT uuid, full_name, email, username, role, student_id, created_at, last_login
    FROM users WHERE id = ?
  `).get(req.user.id);
  return res.json({ user });
});

// ── PUT /api/student/profile ──────────────────────────────────────────────────
router.put('/profile',
  [
    body('full_name').trim().isLength({ min: 2, max: 80 }).withMessage('Full name must be 2–80 characters.'),
    body('email').trim().isEmail().normalizeEmail().withMessage('Valid email required.'),
  ],
  validate,
  async (req, res) => {
    const { full_name, email } = req.body;

    const conflict = await db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.user.id);
    if (conflict) return res.status(409).json({ error: 'Email already in use.' });

    await db.prepare('UPDATE users SET full_name = ?, email = ? WHERE id = ?')
      .run(full_name, email, req.user.id);

    return res.json({ message: 'Profile updated.' });
  }
);

// ── PUT /api/student/password ─────────────────────────────────────────────────
router.put('/password',
  [
    body('current_password').notEmpty().withMessage('Current password required.'),
    body('new_password')
      .isLength({ min: 8 })
      .matches(/[A-Z]/).withMessage('Must contain an uppercase letter.')
      .matches(/[a-z]/).withMessage('Must contain a lowercase letter.')
      .matches(/[0-9]/).withMessage('Must contain a number.')
      .matches(/[^A-Za-z0-9]/).withMessage('Must contain a special character.'),
  ],
  validate,
  async (req, res) => {
    const { current_password, new_password } = req.body;

    const user = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

    const hash = await bcrypt.hash(new_password, 12);
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);

    return res.json({ message: 'Password updated successfully.' });
  }
);

// ── GET /api/student/courses ──────────────────────────────────────────────────
router.get('/courses', async (req, res) => {
  const courses = await db.prepare(`
    SELECT c.id, c.code, c.name, c.description, c.instructor, c.credits, c.semester,
           e.enrolled_at, e.grade, e.status
    FROM enrollments e
    JOIN courses c ON c.id = e.course_id
    WHERE e.student_id = ?
    ORDER BY c.code
  `).all(req.user.id);
  return res.json({ courses });
});

// ── GET /api/student/courses/available ────────────────────────────────────────
router.get('/courses/available', async (req, res) => {
  const courses = await db.prepare(`
    SELECT c.id, c.code, c.name, c.description, c.instructor, c.credits, c.semester,
           c.capacity,
           (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id AND status = 'active') AS enrolled_count
    FROM courses c
    WHERE c.is_active = 1
      AND c.id NOT IN (
        SELECT course_id FROM enrollments WHERE student_id = ? AND status != 'dropped'
      )
    ORDER BY c.code
  `).all(req.user.id);
  return res.json({ courses });
});

// ── POST /api/student/courses/:id/enroll ─────────────────────────────────────
router.post('/courses/:id/enroll', async (req, res) => {
  const courseId = parseInt(req.params.id, 10);
  if (!courseId) return res.status(400).json({ error: 'Invalid course ID.' });

  const course = await db.prepare('SELECT id, capacity FROM courses WHERE id = ? AND is_active = 1').get(courseId);
  if (!course) return res.status(404).json({ error: 'Course not found.' });

  const countRow = await db.prepare("SELECT COUNT(*) AS n FROM enrollments WHERE course_id = ? AND status = 'active'").get(courseId);
  if (countRow.n >= course.capacity) return res.status(409).json({ error: 'Course is full.' });

  const existing = await db.prepare('SELECT id, status FROM enrollments WHERE student_id = ? AND course_id = ?')
    .get(req.user.id, courseId);

  if (existing) {
    if (existing.status === 'active') return res.status(409).json({ error: 'Already enrolled.' });
    await db.prepare("UPDATE enrollments SET status = 'active', enrolled_at = NOW() WHERE id = ?").run(existing.id);
  } else {
    await db.prepare('INSERT INTO enrollments (student_id, course_id) VALUES (?, ?)').run(req.user.id, courseId);
  }

  return res.status(201).json({ message: 'Enrolled successfully.' });
});

// ── DELETE /api/student/courses/:id/drop ─────────────────────────────────────
router.delete('/courses/:id/drop', async (req, res) => {
  const courseId = parseInt(req.params.id, 10);
  const enrollment = await db.prepare(
    "SELECT id FROM enrollments WHERE student_id = ? AND course_id = ? AND status = 'active'"
  ).get(req.user.id, courseId);

  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' });

  await db.prepare("UPDATE enrollments SET status = 'dropped' WHERE id = ?").run(enrollment.id);
  return res.json({ message: 'Course dropped.' });
});

// ── GET /api/student/announcements ───────────────────────────────────────────
router.get('/announcements', async (req, res) => {
  const announcements = await db.prepare(`
    SELECT a.id, a.title, a.content, a.target, a.created_at,
           u.full_name AS author
    FROM announcements a
    JOIN users u ON u.id = a.author_id
    WHERE a.is_active = 1 AND a.target IN ('all', 'students')
    ORDER BY a.created_at DESC
    LIMIT 20
  `).all();
  return res.json({ announcements });
});

module.exports = router;
