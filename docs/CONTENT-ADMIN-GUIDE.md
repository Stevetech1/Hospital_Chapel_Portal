# Content administration guide

The public interface intentionally distinguishes confirmed information from pending records. The database uses approval states: DRAFT, SUBMITTED, APPROVED, REJECTED and ARCHIVED. Public read endpoints return APPROVED records only.

Use the Prisma Studio or a protected administration module during initial content onboarding. A production administrator UI must authenticate users and enforce server-side role checks; do not expose database management tools publicly.

For each leader, capture full name, role, photograph, biography, service years, appointment/departure dates, achievements, contributions and annual themes during tenure.

For each department/committee capture description, functions, terms of reference, leader, secretary, members, establishment date, meeting schedule, activities, reports, photos and documents.

For each family unit capture profile, leader, secretary, membership, functions, activities, meeting schedule, announcements, reports, photographs and resources.


## Available management workspaces
- Church leaders: `/admin` with leadership, departments, family units, themes, members, events, sermons, projects, outreach, documents, content pages and account management according to role.
- Family Unit Leaders: only their assigned family-unit profile and members. They cannot change the assigned unit number.
- Department Leaders: only the department whose `leaderUserId` matches their account; they cannot reassign themselves to another department. Assignment is stored on the account as `familyUnitNumber`.
- Finance Administrators: read-only verified donation ledger and finance summaries. Donation entries cannot be manually marked successful.
- Media Administrators: events, sermons, documents and content pages.
- Academy administrators: `/admin` with scope-specific classes, students, staff, admissions, guardians, resources, assignments, assessment and attendance modules according to role. Teachers see only assigned-class rosters and records.
- Parents: `/parent-portal`; a guardian must be explicitly linked to each student.
- Students: `/student-portal`; the account must be linked to one student record.
- Church members: `/member-portal`; member account must be linked to a membership record.

The JSON editor in the current management UI is a structured first-stage record editor. The backend validates each resource against an explicit schema. It is not a substitute for the future guided forms and complete report-card UI.
