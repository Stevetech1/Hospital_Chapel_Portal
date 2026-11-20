# Deployment checklist

1. Provision Linux hosting or a managed container platform and managed PostgreSQL.
2. Set unique secrets; never reuse the example values.
3. Set `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_ORIGIN`, `NEXT_PUBLIC_API_URL`, `CHURCH_TIMEZONE`.
4. Put the application behind HTTPS reverse proxy and configure secure headers.
5. Restrict database access to backend only.
6. Configure upload storage (S3-compatible or private object storage) with MIME/type/size scanning.
7. Configure Resend transactional email (`RESEND_API_KEY`, `EMAIL_FROM`) with a verified sender domain and set `PUBLIC_SITE_URL`; password-reset links are single-use and expire after 30 minutes.
8. Configure payment provider webhooks and verify signatures server-side before marking a donation successful.
9. Set official domain, canonical URLs, sitemap, robots and analytics IDs.
10. Configure daily encrypted backups, retention and restore drills.
11. Provision first Super Administrator securely; enforce MFA in production.
12. Obtain church approval for privacy notice, retention policy and NDPA compliance review.
13. Complete role/permission tests and penetration/security review before opening member or student accounts.


## Administrator provisioning and payment setup
- Run the `bootstrap-admin` CLI once using temporary environment variables. Password must be at least 16 characters. Never ship a default account or credentials.
- Keep `JWT_SECRET` private and rotate it using a planned session invalidation window.
- Configure Paystack/Flutterwave credentials and webhook endpoints only after beneficiary approval. The application independently verifies provider transactions before setting `SUCCESS`.
- Set `PUBLIC_SITE_URL` to the canonical HTTPS domain so donation QR codes and password-reset links resolve to the production website.
- Private uploads use `/data/private-uploads`; mount persistent storage and back it up. Do not expose this directory through a static web server.
- The current Docker startup uses `prisma db push` for the initial development bootstrap. Before production, create and review a committed Prisma migration and use `prisma migrate deploy`.

## Upload security note
The application enforces size limits, MIME allow-listing and basic file-signature checks and stores uploads outside the public web root. Before production, add malware scanning/quarantine and an approved private object-storage provider. Signature checks are not a substitute for antivirus scanning.
