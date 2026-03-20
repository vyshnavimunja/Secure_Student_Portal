/**
 * seed.js – Run once with: node config/seed.js
 * Creates default admin, sample students, courses, and announcements.
 */
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

const SALT_ROUNDS = 12;

async function seed() {
  await db.initDb();
  console.log('Seeding database…\n');

  // ── Admin ────────────────────────────────────────────────────────────────────
  const adminExists = await db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  if (!adminExists) {
    const hash = await bcrypt.hash('Admin@1234', SALT_ROUNDS);
    await db.prepare(`
      INSERT INTO users (uuid, full_name, email, username, password_hash, role)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), 'System Administrator', 'admin@portal.edu', 'admin', hash, 'admin');
    console.log('  Created admin: admin / Admin@1234');
  } else {
    console.log('  Admin already exists, skipping.');
  }

  // ── Sample Students ──────────────────────────────────────────────────────────
  const students = [
    { name: 'Alice Johnson',  email: 'alice@student.edu',  username: 'alice',  sid: 'STU-0001' },
    { name: 'Bob Martinez',   email: 'bob@student.edu',    username: 'bob',    sid: 'STU-0002' },
    { name: 'Carol Williams', email: 'carol@student.edu',  username: 'carol',  sid: 'STU-0003' },
  ];
  for (const s of students) {
    const exists = await db.prepare('SELECT id FROM users WHERE username = ?').get(s.username);
    if (!exists) {
      const hash = await bcrypt.hash('Student@1234', SALT_ROUNDS);
      await db.prepare(`
        INSERT INTO users (uuid, full_name, email, username, password_hash, role, student_id)
        VALUES (?, ?, ?, ?, ?, 'student', ?)
      `).run(uuidv4(), s.name, s.email, s.username, hash, s.sid);
      console.log(`  Created student: ${s.username} / Student@1234`);
    }
  }

  // ── Courses ──────────────────────────────────────────────────────────────────
  const courses = [
    { code: 'CS101',   name: 'Introduction to Computer Science', desc: 'Fundamentals of programming and computational thinking.', instructor: 'Dr. Smith',  credits: 3, semester: 'Spring 2026' },
    { code: 'MATH201', name: 'Calculus I',                       desc: 'Limits, derivatives, and integrals.',                    instructor: 'Prof. Lee',  credits: 4, semester: 'Spring 2026' },
    { code: 'ENG110',  name: 'Academic Writing',                 desc: 'Essay structure, research, and argumentation.',          instructor: 'Ms. Davis', credits: 3, semester: 'Spring 2026' },
    { code: 'PHY150',  name: 'Physics I',                        desc: 'Mechanics, motion, and energy.',                        instructor: 'Dr. Kumar', credits: 4, semester: 'Spring 2026' },
    { code: 'CS202',   name: 'Data Structures',                  desc: 'Arrays, linked lists, trees, and algorithms.',          instructor: 'Dr. Smith',  credits: 3, semester: 'Spring 2026' },
  ];
  for (const c of courses) {
    const exists = await db.prepare('SELECT id FROM courses WHERE code = ?').get(c.code);
    if (!exists) {
      await db.prepare(`
        INSERT INTO courses (code, name, description, instructor, credits, semester)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(c.code, c.name, c.desc, c.instructor, c.credits, c.semester);
    }
  }
  console.log('  Courses seeded.');

  // ── Enroll Alice ──────────────────────────────────────────────────────────────
  const alice = await db.prepare("SELECT id FROM users WHERE username = 'alice'").get();
  if (alice) {
    const allCourses = await db.prepare('SELECT id FROM courses').all();
    for (const c of allCourses) {
      await db.prepare('INSERT IGNORE INTO enrollments (student_id, course_id) VALUES (?, ?)').run(alice.id, c.id);
    }
    console.log('  Enrolled alice in all courses.');
  }

  // ── Announcements ─────────────────────────────────────────────────────────────
  const admin    = await db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  const annCount = await db.prepare('SELECT COUNT(*) AS n FROM announcements').get();
  if (admin && annCount.n === 0) {
    const items = [
      { title: 'Welcome to Spring 2026!',       content: 'Welcome back students. The semester begins March 10. Please verify your course enrollments in your dashboard.', target: 'all' },
      { title: 'Library Hours Extended',         content: 'The library will be open until midnight Monday-Thursday during exam periods.', target: 'students' },
      { title: 'System Maintenance - March 15',  content: 'The portal will be unavailable from 2:00 AM to 4:00 AM on March 15 for scheduled maintenance.', target: 'all' },
    ];
    for (const a of items) {
      await db.prepare('INSERT INTO announcements (title, content, author_id, target) VALUES (?, ?, ?, ?)').run(a.title, a.content, admin.id, a.target);
    }
    console.log('  Announcements seeded.');
  }

  console.log('\nSeeding complete!\n');
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
