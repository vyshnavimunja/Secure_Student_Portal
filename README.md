Languages & Technologies Used

JavaScript (Node.js)	Entire backend — server, routes, database, middleware
JavaScript (Vanilla)	Entire frontend — all client-side logic
HTML5	Frontend page structure
CSS3	Frontend styling and layout
SQL (MySQL)	Database queries throughout the backend
Frontend (User Interface)
Built with plain HTML, CSS, and Vanilla JavaScript — no frameworks.

3 HTML pages: index.html (login/register), dashboard.html (student), admin.html (admin panel)
css/style.css — single stylesheet with CSS variables, responsive grid layout, sidebar navigation, modals, and card components
js/api.js — centralized HTTP client using the browser's native fetch API. Automatically retries requests after silently refreshing expired tokens
js/auth.js — handles login/register form submissions and redirects based on user role
js/dashboard.js — student dashboard logic: course enrollment/drop, profile editing, password change, announcements
js/admin.js — admin panel logic: user/course/announcement management with modals, search, and pagination
Backend (Server and Database)
Built with Node.js + Express.js, connected to MySQL via mysql2.

server.js — Express app entry point. Configures security headers (Helmet), CORS, body parsing, global rate limiting, mounts all API routes, and serves the static frontend files
config/database.js — MySQL connection pool wrapper using mysql2/promise. Exposes a prepare(sql).get/all/run() async API used by all routes. Also runs CREATE TABLE IF NOT EXISTS on startup to auto-initialise the schema
config/seed.js — one-time script that populates the database with a default admin, 3 sample students, 5 courses, enrollments, and announcements
routes/auth.js — handles /api/auth/*: register, login, logout, token refresh, and /me
routes/student.js — handles /api/student/*: profile, password change, enrolled courses, available courses, enroll, drop, announcements
routes/admin.js — handles /api/admin/*: system stats, full user/course/announcement CRUD with pagination and search
Database tables: users, courses, enrollments, announcements, refresh_tokens

Middleware (Authentication, Security & Communication)
Implemented in middleware/auth.js and middleware/validate.js, plus third-party Express middleware.

Middleware	Library.
JWT Auth	jsonwebtoken	Signs and verifies short-lived access tokens (15 min) and long-lived refresh tokens (7 days) stored in HTTP-only cookies
Token rotation	custom	On every refresh, the old token is deleted and a new one is issued — stored as a SHA-256 hash in the DB to prevent reuse
Role guard	custom (requireRole)	Blocks access to admin routes if the logged-in user is not an admin
Input validation	express-validator	Validates and sanitizes all request bodies before they reach route logic
Security headers	helmet	Sets Content-Security-Policy, X-Content-Type-Options, and other HTTP security headers
Rate limiting	express-rate-limit	Global: 200 req/15 min per IP. Auth endpoints: 10 req/15 min to prevent brute-force
CORS	cors	Restricts which origins can call the API
Password hashing	bcryptjs	All passwords hashed with bcrypt at cost factor 12 before storage — never stored in plain text


