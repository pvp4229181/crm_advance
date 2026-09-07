# Lead CRM

An ERP-style lead and opportunity CRM built with React, Express, TypeScript and MongoDB.

## Start locally

1. Copy `server/.env.example` to `server/.env`.
2. Start MongoDB locally (transactions in lead conversion require a replica set in production).
3. Run `npm install`, `npm run seed`, then `npm run dev`.
4. Sign in with `admin@orbitcrm.test` / `Password123!`.

The web app runs at `http://localhost:5173` and the API at `http://localhost:4000`.

## Email invitations and roles

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, and `APP_URL` in `server/.env`. Then sign in as an Administrator and open **Configuration → Users → Invite person**. Select the recipient's role and Lead CRM will email a single-use link where they set their own password.

For Gmail SMTP use `smtp.gmail.com`, port `587`, `SMTP_SECURE=false`, and a Google App Password rather than the account password. In production, `APP_URL` must be the public HTTPS URL of the web application.
