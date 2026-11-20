PostgreSQL is provisioned by Docker Compose. Prisma schema is the canonical relational schema and can be deployed with `npx prisma db push`; for controlled production releases, create and commit migrations with `npx prisma migrate dev --name init`, then deploy with `npx prisma migrate deploy`.

Recommended production controls:
- Distinct database roles for application and backup jobs.
- Automated encrypted daily backups and periodic restore tests.
- Restrict database network access to the API service.
- Enable TLS for remote database connections.
- Consider PostgreSQL Row-Level Security for sensitive member and Academy data.
