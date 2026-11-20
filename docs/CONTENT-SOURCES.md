# Hospital Chapel content sources and configuration notes

## Chapel information supplied for this project

The following items were taken from the user's previously supplied Hospital Chapel materials and existing project seed data: the Chapel vision, current pastor and secretaries, Board names, annual themes for 2025 and 2026, 12 family-unit placeholders, ministry/committee names, worship and visitation schedule, and the historical timeline. These are kept editable and should be checked by Church leadership before publication.

## Online institutional reference

The public website uses the University of Abuja Teaching Hospital (UATH) official website only for host-institution context and host-hospital contact details:

- https://uath.gov.ng/about — UATH's institutional profile, location and published mission/context.
- https://uath.gov.ng/contact — UATH's published address, telephone and email.
- https://uath.gov.ng/ — UATH public website.

Hospital details must not be presented as Hospital Chapel's own contact information. The Chapel's phone numbers, email and worship schedule are from the supplied Chapel project materials and remain subject to confirmation.

## Information not reliably found online

No authoritative public source was identified for the Chapel's official Facebook, Instagram, YouTube, TikTok or X accounts, complete monthly theme subtopics, approved Bible references, full official history book, biographies, current family-unit leaders, committee terms of reference, Academy curriculum, approved financial beneficiary details or official livestream links. The source code therefore includes clearly marked placeholders rather than invented accounts or institutional facts.

## Manual configuration

- Public content and social account URLs: `frontend/lib/site-config.ts`
- Carousel images and captions: `frontend/components/ImageCarousel.tsx`
- Backend secrets, payment keys, sender configuration and deployment URLs: copy `.env.example` to `.env` and fill it locally.
- Never put secrets or private member/student records in frontend configuration.
