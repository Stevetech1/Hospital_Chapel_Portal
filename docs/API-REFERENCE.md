# API reference — implementation stage 2

Base URL: `http://localhost:4000` locally. Authenticated routes use the HttpOnly `hcuath_session` cookie set by `/api/auth/login`. Browser requests must use `credentials: 'include'`. No public account-registration endpoint exists.

## Authentication
- `POST /api/auth/login` — `{ "email", "password" }`; sets a 30-minute HttpOnly, SameSite=Strict cookie.
- `GET /api/auth/me` — current active account and role/scope.
- `POST /api/auth/logout` — clears the session cookie.
- `POST /api/auth/forgot-password` — `{ "email" }`; returns a generic confirmation and sends a one-time reset link when Resend is configured.
- `POST /api/auth/reset-password` — `{ "token", "password" }`; consumes a hashed, 30-minute token, requires a 16+ character password and revokes existing sessions.
- Password reset email delivery requires `RESEND_API_KEY`, `EMAIL_FROM` and `PUBLIC_SITE_URL`.
- `POST /api/admin/users` / `POST /api/admin/academy/users` — privileged account provisioning; password minimum 16 characters.
- `GET /api/admin/users` / `GET /api/admin/academy/users` — safe account fields only.
- `PATCH /api/admin/users/:id` / `PATCH /api/admin/academy/users/:id` — authorized role/status/profile/password maintenance. A current SYSTEM-scoped Super Administrator can provision additional Super Administrators without a fixed count limit; the last active Super Administrator cannot be suspended or demoted.

## Church administration
Generic validated endpoints:
- `GET|POST /api/admin/leadership`
- `GET|POST /api/admin/departments`
- `GET|POST /api/admin/familyUnits`
- `GET|POST /api/admin/themes`
- `GET|POST /api/admin/monthlyThemes`
- `GET|POST /api/admin/members`
- `GET|POST /api/admin/events`
- `GET|POST /api/admin/sermons`
- `GET|POST /api/admin/projects`
- `GET|POST /api/admin/outreach`
- `GET|POST /api/admin/documents`
- `GET|POST /api/admin/contentPages`
- `PATCH /api/admin/:resource/:id` — allow-listed updates only.
- `POST /api/admin/:resource/:id/approval` — `{ "status": "APPROVED" | "REJECTED" | "DRAFT" | "SUBMITTED" | "ARCHIVED" }` where supported.
- `GET /api/admin/:resource/:id/revisions` — saved snapshots for selected institutional content.
- `GET /api/admin/private/prayer-requests`; `PATCH /api/admin/private/prayer-requests/:id` — restricted prayer queue.
- `GET /api/admin/private/testimonies`; `POST /api/admin/private/testimonies/:id/approval` — testimony moderation.
- `POST /api/admin/documents/upload` — private file upload, maximum 25 MB, allowed file formats and basic signature checks.
- `GET /api/admin/documents/:id/download` — authenticated document download.
- `GET /api/admin/reports/church`, `GET /api/admin/audit-logs`, `GET /api/admin/overview`.

Family Unit Leaders can only access the family unit whose number is assigned to their account and members allocated to that unit. Department Leaders can only access the department whose `leaderUserId` matches their account.

## Academy administration and portals
- `GET|POST /api/admin/academicClasses` — class setup.
- `POST /api/admin/academy/classes/:classId/teachers` — assign an existing active Academy teacher account.
- `GET /api/teacher/classes` — assigned classes and minimal roster fields only.
- `GET|POST /api/admin/academyStudents`, `academyStaff`, `academyApplications`, `academyResources`, `academyDocuments`, `academicAssignments`, `studentAssessments`, `attendanceRecords` — role/scope checked management resources.
- `GET|POST /api/admin/academy/guardians` — guardian profile management.
- `POST /api/admin/academy/guardians/:guardianId/link-student` — explicitly link a student to a guardian.
- `GET /api/parent/students`; `GET /api/parent/students/:studentId/records` — parent can access only linked learners.
- `GET /api/student/me`, `/api/student/assignments`, `/api/student/assessments`; `POST /api/student/assignments/:id/submit` — student can access only their own profile/results and approved assignments for their class.
- `GET /api/admin/reports/academy` — aggregate-only report for authorized Academy administrators.
- `POST /api/admin/academy/documents/upload`; `GET /api/admin/documents/:id/download` — Academy-scoped document storage and access checks.

## Public endpoints
- `GET /health`
- `GET /api/public/leadership`, `/departments`, `/family-units`, `/themes`, `/events`, `/sermons`, `/content/:slug`, `/documents`
- `GET /api/public/documents/:id/download` — only approved public Church documents.
- `POST /api/public/prayer-requests`, `/testimonies`, `/contact`
- `GET /api/public/donation-qr?category=...`
- `POST /api/public/donations/initialize` — creates a pending transaction and starts provider checkout when configured.
- `GET /api/public/donations/:reference/status` — returns limited payment status fields.

## Payments
- `POST /api/webhooks/paystack` validates the Paystack HMAC signature and independently verifies the transaction with Paystack before marking it successful.
- `POST /api/webhooks/flutterwave` validates the configured webhook hash and independently verifies the transaction with Flutterwave before marking it successful.
- No browser callback can set a donation to SUCCESS. Do not manually edit the donation status.

## Production notes
This API reference documents implemented route contracts, not a claim that the production deployment or provider accounts are active. Configure secrets, HTTPS, persistent private file storage, malware scanning, reviewed database migrations, backups, monitoring and NDPA/privacy policies before live use.
