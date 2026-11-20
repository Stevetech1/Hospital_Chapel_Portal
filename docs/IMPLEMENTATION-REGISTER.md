# Implementation register

## Supplied facts loaded as draft records
- Vision: “To build and nurture believers to propagate the gospel of our Lord Jesus.”
- 2026 theme: Divine Passover.
- 2025 theme: Divine Enlargement.
- Current pastor: Olusoji Billyrose.
- Secretary: Bro. Daniel Magaji.
- Assistant Secretary: Bro. David Habu Sulai.
- Board chairman: Dr. John Dahosa.
- Board members: Barr. Pastor A.S. Agari; Prof. Pastor Ojji Dike; Dr. Pastor Pius Idoko Ogolekwu; Dr. Pastor David Barau.
- 12 family unit records.
- All 18 named ministry/committee records.

All supplied leadership/department/theme seed records are drafts until an authorized administrator approves them for publication.

## Pending official materials
- Monthly subtopics for Divine Passover and Divine Enlargement.
- Theme Bible references and expositions.
- Biographies, appointment dates, service years, photographs and verified achievements.
- Pastors' and board chronology.
- Official church history, founding date, milestones, history book and constitution.
- Official names, leaders, secretaries and terms of reference for the 12 family units.
- Ministry and committee descriptions, leaders, members, meeting schedules and annual reports.
- Bible XML files and licensed Bible translation content.
- Approved Hymns and Songs & Solos content.
- Sermons, livestream URLs, social links, contact details and event calendar.
- Donation account/beneficiary approval and Paystack/Flutterwave credentials.
- Academy history, leadership, classes, curriculum, staff, admission requirements and safeguarding procedures.

## Privacy and approval
Prayer requests are stored in a separate private table and have no public listing endpoint. Testimonies are submitted for review and are not publicly listed by default. Academy student records are not exposed through public endpoints. Never store patient-identifiable information in outreach reports.


## Additional verified content transcribed from the first pages of the supplied website PDF
- Worship: Sunday 8:00–11:00 AM; prayer from 7:30 AM; Holy Communion on the first Sunday; Children's Sunday School from 8:00 AM.
- Mid-week: Wednesdays 5:00–7:00 PM; first Wednesday prayer and fasting; second and third Wednesdays Bible study; last Wednesday Brothers' and Sisters' Fellowship.
- Hospital visitation: Sundays 4:00–6:00 PM.
- Contact: P.O. Box 09, University of Abuja Teaching Hospital, Gwagwalada, Abuja FCT; 0811 041 7043; 0810 101 2255 (calls and WhatsApp); uathchapel@yahoo.com.
- History timeline: 1990, 1993, 1994, 1996, 1997, 1998, 1999, 2000, 2001–2003, 2007–2015 and 2026. See the History page for the supplied descriptions.

The supplied web materials also state the church's aim as building believers and making disciples, with activities including Christian formation, gospel preaching, Word/prayer/worship/fellowship, church ordinances and support for missionary work.

## Stage 2 implementation register (source-code delivery)

### Implemented in source
- Secure sign-in with 30-minute HttpOnly/SameSite=Strict session cookie, active-account re-check on authenticated requests, rate-limited login and no public registration endpoint.
- Server-side resource allow-lists, scope/role checks and strict Zod validation for church and Academy records.
- Account creation, role maintenance, deactivation and password reset through privileged routes; Super Administrator bootstrap remains an operator CLI task.
- Church dashboard modules for leadership, departments/committees, family units, annual/monthly themes, membership, events, sermons, projects, outreach, documents, content pages and verified donation ledger.
- Approval actions and content revision snapshots for selected institutional records; audit log and aggregate church reports.
- Family Unit Leader and Department Leader record boundaries.
- Private prayer-request queue and testimony moderation queue; no public prayer-request listing route.
- Private document storage, size/MIME/signature checks, scope-aware download checks and approval states.
- Academy class, student, staff, admission, guardian, learning-resource, assignment, assessment and attendance data models and administration routes.
- Explicit guardian-to-student links; parents can only view linked learners' results/attendance. Students can view their own profile, approved class assignments/results and submit assignment responses. Teachers can see only assigned class rosters and records and can grade those submissions.
- Paystack and Flutterwave checkout initialization, pending donation records, signature/webhook checks and independent provider transaction verification before success.
- Donation QR generation, giving page and server-checked return status.
- PWA manifest, official logo icon, static asset service worker, robots and sitemap routes.

### Static checks performed
- 17 TypeScript/TSX source files passed TypeScript transpile syntax diagnostics (0 syntax diagnostics).
- Project static integrity script passed 14 required-file checks, 3 JSON checks and 11 implementation-pattern checks.
- Docker Compose YAML parsed successfully with PyYAML.
- Service worker and static verification script passed Node syntax checks.

### Not verified in this environment
- `npm install` could not complete because the npm registry was unreachable (`EAI_AGAIN`), and the offline npm cache did not contain `@prisma/client`; dependencies are not installed in this workspace.
- Consequently a full Next.js production build, backend TypeScript type-check against installed package declarations, Prisma schema validation/generation, database `db push`/migration and API integration tests were not run.
- Docker is not installed in this workspace, so `docker compose up` was not executed.
- No live payment provider, SMTP, domain, production storage, backups, analytics or social/streaming accounts were connected.

### Still pending
- Full visual and workflow testing after dependency installation, Prisma validation, reviewed database migrations, automated integration tests and security review.
- Production malware scanning for uploads, object storage lifecycle, encrypted backups, restore tests, HTTPS, monitoring, secrets manager, privacy notice and retention schedule.
- Church-approved payment beneficiary and Paystack/Flutterwave production credentials/webhook configuration.
- Church-approved monthly theme subtitles, Bible references, expositions, leadership biographies, committee terms of reference, unit leaders and history source documents.
- Bible XML import/search, licensed translation content, hymnal/Songs & Solos import, sermon media pipeline, live-stream/social integrations, newsletter and WhatsApp integration.
- Academy-approved curriculum, subjects, school calendar, admissions rules, fees, safeguarding policy, staff and student records.
- Complete guided forms, report cards, attendance calendar, timetable, admissions document workflow and Academy parent/teacher UI polish.
