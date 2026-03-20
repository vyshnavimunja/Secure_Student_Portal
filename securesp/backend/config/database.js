require('dotenv').config();
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host:               process.env.DB_HOST     || 'localhost',
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'securesp_db',
  port:               parseInt(process.env.DB_PORT || '3306', 10),
  waitForConnections: true,
  connectionLimit:    10,
  charset:            'utf8mb4',
  timezone:           '+00:00',
};

let pool = null;

// ── Compat wrapper (mirrors better-sqlite3 API but async) ──────────────────────
function prepare(sql) {
  return {
    async get(...args) {
      if (!pool) throw new Error('Database not initialised.');
      const params = args.flat();
      const [rows] = await pool.execute(sql, params.length ? params : undefined);
      return rows[0] || null;
    },
    async all(...args) {
      if (!pool) throw new Error('Database not initialised.');
      const params = args.flat();
      const [rows] = await pool.execute(sql, params.length ? params : undefined);
      return rows;
    },
    async run(...args) {
      if (!pool) throw new Error('Database not initialised.');
      const params = args.flat();
      const [result] = await pool.execute(sql, params.length ? params : undefined);
      return { changes: result.affectedRows, lastInsertRowid: result.insertId };
    },
  };
}

// ── Schema initialisation ──────────────────────────────────────────────────────
async function initDb() {
  if (pool) return;

  pool = mysql.createPool(DB_CONFIG);

  // Verify the connection is reachable
  const conn = await pool.getConnection();
  conn.release();

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      uuid          VARCHAR(36)  NOT NULL UNIQUE,
      full_name     VARCHAR(80)  NOT NULL,
      email         VARCHAR(255) NOT NULL UNIQUE,
      username      VARCHAR(30)  NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role          ENUM('student','admin') NOT NULL DEFAULT 'student',
      student_id    VARCHAR(20)  UNIQUE,
      is_active     TINYINT(1)   NOT NULL DEFAULT 1,
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login    DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS courses (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      code        VARCHAR(20)  NOT NULL UNIQUE,
      name        VARCHAR(100) NOT NULL,
      description TEXT,
      instructor  VARCHAR(80)  NOT NULL,
      credits     INT          NOT NULL DEFAULT 3,
      semester    VARCHAR(30)  NOT NULL,
      capacity    INT          NOT NULL DEFAULT 30,
      is_active   TINYINT(1)   NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      student_id  INT      NOT NULL,
      course_id   INT      NOT NULL,
      enrolled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      grade       VARCHAR(5),
      status      ENUM('active','dropped','completed') NOT NULL DEFAULT 'active',
      UNIQUE KEY uq_student_course (student_id, course_id),
      CONSTRAINT fk_enroll_student FOREIGN KEY (student_id) REFERENCES users(id)   ON DELETE CASCADE,
      CONSTRAINT fk_enroll_course  FOREIGN KEY (course_id)  REFERENCES courses(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS announcements (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      title       VARCHAR(150) NOT NULL,
      content     TEXT         NOT NULL,
      author_id   INT          NOT NULL,
      target      ENUM('all','students','admins') NOT NULL DEFAULT 'all',
      is_active   TINYINT(1)   NOT NULL DEFAULT 1,
      created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_ann_author FOREIGN KEY (author_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT         NOT NULL,
      token_hash  VARCHAR(64) NOT NULL UNIQUE,
      expires_at  DATETIME    NOT NULL,
      created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_token_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

// ── Proxy so routes can do db.initDb() and db.prepare() ───────────────────────
const db = new Proxy({ prepare }, {
  get(target, prop) {
    if (prop === 'initDb') return initDb;
    return target[prop];
  },
});

module.exports = db;
