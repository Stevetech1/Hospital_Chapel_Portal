# Hospital Chapel UATH Digital Ecosystem

A portable monorepo foundation for the Hospital Chapel UATH Church + Hospital Chapel Academy digital platform.

## What is included
- Next.js public Church and Academy experience, responsive and branded with the supplied official logo. Dedicated pages cover the Church's history, leadership, board, ministries, committees, 12 family units, themes, Bible study, Digital Bible, hymns, sermons, events, outreach, projects, prayer, testimonies, media, blog, giving and contact information.
- Church pages for leadership, departments, 12 family units, committees, annual themes, history, media, prayer, testimonies, events, outreach, projects and giving.
- Academy public area and dedicated parent/student/teacher/admin entry points. Public pages share a responsive navigation/footer and image carousel; social platform icon links are present with editable URL placeholders.
- Express REST API with secure cookie-based authentication, active-user session checks, resource-specific role/scope permissions, strict input validation, approval endpoints, version snapshots, audit logs, private prayer/testimony queues, document upload/download, Academy portals, membership and verified donation workflows.
- PostgreSQL relational schema covering church, academy, authentication, members/family units, academic classes, assessments, attendance, assignments, finance, documents, content revisions and audit records.
- Seed data for supplied office holders, board members, 2025/2026 themes, all 12 family units and all named ministry/committee units.
- Content-pending fields instead of fabricated biographies, historical claims or achievements.
- Docker Compose for local PostgreSQL + API + frontend.
- Deployment and data-governance notes.

## API documentation
See [docs/API-REFERENCE.md](docs/API-REFERENCE.md) for the current route list, role boundaries and payment workflow.

## Administration and security
- Visit `/admin` for the new administration control centre. Dedicated module pages are available under `/admin/...`; `/admin/workspace` retains the advanced legacy workspace while remaining functions are migrated into the dedicated pages. Accounts are provisioned by an authorized operator; public registration is disabled.
- The first Super Administrator is provisioned only through the protected CLI script; no default password is included.
- The login uses a 30-minute HttpOnly, SameSite=Strict cookie. Use HTTPS in production.
- The backend rejects startup if `JWT_SECRET` is missing or shorter than 32 characters.
- Family Unit Leaders are restricted to their assigned unit and its members. Academy parent access is limited to explicitly linked students.
- Prayer requests and student/guardian records have no public listing endpoints.
- Public content endpoints expose only approved content. Monthly themes also require approval.
- Uploaded documents are stored outside the public web root and downloaded through authenticated authorization checks.
- Donation records remain PENDING until a webhook signature is validated and the payment is independently verified with Paystack or Flutterwave.

## Important implementation status
This is a runnable, extensible first implementation package—not a claim that production services are already deployed or connected. Live payments, email/SMS, streaming destinations, social accounts, custom domain, production authentication policies, backups and Academy operational records require the Church's credentials, approved policies and deployment environment. No payment credentials or private member/student data are included.

## Run locally (Windows 10/11)
1. Install Node.js 20+ and Docker Desktop.
2. Extract this folder.
3. Open the folder in VS Code.
4. Copy `.env.example` to `.env`.
5. Edit `.env`: set a strong unique `POSTGRES_PASSWORD` and a cryptographically random `JWT_SECRET` of at least 32 characters. Also set the canonical site URL before deployment. The API refuses to start with a missing or example JWT secret.
6. In a terminal at the project root run:
   ```bash
   docker compose up --build
   ```
7. Open:
   - Church + Academy website: http://localhost:3000
   - API health: http://localhost:4000/health

## Create the first Super Administrator
After the database is running, execute the bootstrap CLI once with an administrator-approved email, full name and a unique password of at least 16 characters. Do not commit these values to `.env.example` or source control. Example PowerShell (replace the values locally):
```powershell
docker compose exec -e ADMIN_EMAIL="admin@your-approved-domain" -e ADMIN_FULL_NAME="Approved Administrator" -e ADMIN_PASSWORD="Use-A-Unique-16-Character-Or-Longer-Password" api npm run bootstrap-admin
```
Then remove the temporary environment values from the command/session. The script does not create a public registration route.

If you prefer not to use Docker:
- Start PostgreSQL and create database `hospital_chapel`.
- Copy `backend/.env.example` to `backend/.env`, then replace the database password, `JWT_SECRET`, email sender and payment settings. The backend loads this file for direct VS Code development.
- In `backend`, run `npm install`, `npx prisma generate`, `npx prisma db push`, `npm run seed`, `npm run dev`.
- Copy `frontend/.env.example` to `frontend/.env.local`.
- In `frontend`, run `npm install`, `npm run dev`.

## Password reset configuration
Set `RESEND_API_KEY` and `EMAIL_FROM` in the backend environment after verifying a sender domain with Resend. Set `PUBLIC_SITE_URL` to the live frontend URL. The forgot-password endpoint intentionally returns the same response for existing and unknown email addresses. Reset links expire after 30 minutes, are single-use, and revoke all existing login sessions when used. If email is not configured, the request is accepted generically but no email can be delivered; configure email before production.

## First administrator
For security, no universal default administrator password is shipped. Create the first account through the deployment operator process after setting a strong secret. Do not expose admin registration publicly.

## Next implementation gates
1. Church leadership approves names, spellings, positions and biographies.
2. Upload official church history, constitution, monthly theme subtopics, hymns and Bible XML files.
3. Confirm family unit names/leaders and committee terms of reference.
4. Provide approved social/streaming links, WhatsApp contact and church contact details.
5. Configure Paystack/Flutterwave test keys and webhook URLs in backend secrets.
6. Configure Resend email delivery (`RESEND_API_KEY` and `EMAIL_FROM`), verify the sender domain, and configure HTTPS, backups and privacy notice.
7. Configure `PAYSTACK_SECRET_KEY`, `FLUTTERWAVE_SECRET_KEY`, provider callbacks and webhook secret only after the Church approves the payment beneficiary and payment account.
8. Create database migrations and test restore/rollback before production deployment.
9. Academy supplies its approved levels, curriculum, staff, admission requirements and safeguarding/consent procedures.
