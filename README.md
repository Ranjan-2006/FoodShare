# FoodShare

FoodShare is a responsive food-surplus redistribution platform. Food donors can publish and track surplus food, community organizations can browse and safely claim listings, and administrators can manage accounts, listings, claims, and platform analytics.

## Technology

- HTML5, CSS3, and vanilla JavaScript modules (ES6+)
- Supabase Auth, PostgreSQL, Row Level Security, and Storage
- Chart.js for administrator analytics
- Lucide for icons
- Google Fonts and Unsplash-hosted decorative photography

The application is a static website. It does not require a Node.js server or a private backend. Only the Supabase publishable key is used by browser code; authorization and claim integrity are enforced by PostgreSQL.

## Project layout

```text
FoodShare/
├── index.html                 Public landing page
├── login.html                 Sign-in
├── register.html              Donor / NGO registration
├── donor/                     Donor dashboard, donation form/list, profile
├── ngo/                       NGO dashboard, marketplace, claims, profile
├── admin/                     Admin overview, user/donation/claim management, reports
├── css/
│   ├── style.css              Shared design system and landing page
│   ├── auth.css               Login and registration
│   └── dashboard.css          Responsive role-based workspaces
├── js/
│   ├── config.js              Supabase URL and publishable key
│   ├── supabase.js            Supabase client
│   ├── common.js              Shared helpers, shell, and notifications
│   ├── auth.js                Authentication and registration
│   ├── app.js                 Page initialization and role routing
│   ├── donor.js               Donor workflows
│   ├── ngo.js                 Marketplace and claim workflows
│   └── admin.js               Management and analytics
└── database/
    └── schema.sql             Tables, indexes, policies, storage, and RPCs
```

## Configure Supabase

1. Create a Supabase project and open **Project Settings → API**.
2. Copy the project URL and the **publishable key** (or legacy anon key).
3. Edit `js/config.js`:

   ```js
   export const SUPABASE_URL = "https://YOUR_PROJECT_ID.supabase.co";
   export const SUPABASE_ANON_KEY = "YOUR_SUPABASE_PUBLISHABLE_KEY";
   ```

   Use the project root URL only. Do **not** append `/rest/v1`, `/auth/v1`, or another API path. Do not put a service-role key in the site. Publishable keys are intended for browser use; Row Level Security policies enforce access.

4. In the Supabase SQL Editor, run the complete `database/schema.sql` script. This creates the tables and indexes, enables RLS, configures the public food-image bucket and its policies, and installs the protected claim and reporting functions.
5. In **Authentication → Providers**, enable Email. Configure email confirmation and the allowed redirect URLs for local development and your deployed domain. With email confirmation enabled, registration asks the user to confirm their address before logging in.
6. Serve the project over HTTP rather than opening HTML files directly. For example, from the project root:

   ```powershell
   python -m http.server 8000
   ```

   Open `http://localhost:8000`. Python is only a static-file development server; it is not part of the application stack.

Without a configured Supabase project, the landing page explains that live impact statistics are unavailable, authentication shows the configuration message, and protected pages explain how to connect Supabase. The app does not simulate successful database operations.

## Create the first administrator securely

Administrator roles are never offered in public registration. First create and verify an account using the normal registration flow. Then open `database/admin-bootstrap.sql`, replace `admin@example.com` with that exact account email, and run the script in the trusted Supabase SQL Editor. The script updates the role-protection trigger to permit trusted SQL Editor bootstrapping (without permitting a normal signed-in user to promote themselves), verifies that exactly one account matches, and promotes that account.

For reference, the promotion performed by the script is:

```sql
update public.users
set role = 'admin',
    is_active = true
where id = (
  select id
  from auth.users
  where lower(email) = lower('admin@example.com')
);
```

Verify that exactly one account was promoted:

```sql
select id, full_name, email, role, is_active
from public.users
where lower(email) = lower('admin@example.com');
```

Use the account to log in. The database prevents a user from changing their own role; an existing administrator or trusted project owner must assign administrator access. Keep SQL Editor and project-owner access restricted to trusted operators.

If you already installed the schema, run `database/admin-bootstrap.sql` rather than rerunning `database/schema.sql`; the main schema creates tables and types and is intended for a fresh project.

## Implemented workflows

- Public overview and live platform impact statistics.
- Email/password sign-in, donor/NGO registration, password visibility, validation, and role-based routing.
- Donor donation creation, image upload, editing and deletion of available listings, status tracking, and claimed-NGO lookup.
- NGO marketplace search, category/location filters, expiry/newest sorting, donation details, atomic claiming, pickup contact details, and collection status updates.
- Admin user activation, user search/filtering, donation moderation, claim monitoring, platform statistics, and live Chart.js reports.
- Responsive layouts, loading states, empty states, notifications, and confirmation prompts.
- RLS-protected profile, donation, claim, and image operations. A database function atomically changes a listing from available to claimed, so concurrent organizations cannot claim the same donation.

## Deploy to Vercel

1. Push the static project to a Git repository and import it into Vercel.
2. Keep the project root as the **Root Directory**. No build command or output directory is required; the HTML files are served directly.
3. Set the project’s Supabase URL and publishable key in `js/config.js` before deployment. These are public client settings, not secrets.
4. Add the deployed domain to Supabase Authentication’s allowed redirect URLs.
5. Deploy and test registration, login, role-based dashboards, donation creation, an NGO claim, claim status changes, and administrator access.

The same static files can also be hosted by Netlify or another static web host. If local or deployed access is served from a subpath, ensure the host preserves the project’s relative page paths.
