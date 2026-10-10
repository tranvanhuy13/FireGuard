# FireGuard Frontend

This is the Next.js frontend for the FireGuard project, built with React 19, Next.js App Router, Tailwind CSS, and Framer Motion.

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Configure Environment Variables:
Copy `.env.example` to `.env.local` or create it with the following:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
NEXT_PUBLIC_USE_MOCK=true
```

> **Note:** Set `NEXT_PUBLIC_USE_MOCK=true` to run the UI with mock data when the backend is not available.

3. Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Architecture

- **`src/app`**: Next.js App Router layout and pages (Landing, Login, Register, Dashboard).
- **`src/components`**: Reusable UI components (Button, Input, Layout, Modals) and specific feature components.
- **`src/context`**: React contexts for Authentication (`AuthContext.tsx`) and Internationalization (`LanguageContext.tsx`).
- **`src/lib/api`**: Centralized API client (`client.ts`) wrapping `fetch` and handling mock scenarios.
- **`src/locales`**: i18n dictionaries for English (`en.ts`) and Vietnamese (`vi.ts`).

## RBAC (Role-Based Access Control)

Roles available:
- **Viewer**: Read-only access to live feeds, history, and stats.
- **Operator**: Can toggle cameras, analyze videos, acknowledge alerts, and test notifications.
- **Admin**: Can manage users, edit cameras, configure settings, and view audit logs.

Access is controlled via `useAuth().can('permission')` and by conditionally rendering navigation items in `DashboardLayout`.

## Testing the Mock Mode

With `NEXT_PUBLIC_USE_MOCK=true`, the API client automatically returns predefined mock responses for `/auth/login`, `/auth/register`, `/auth/me`, and delays responses to simulate network latency.

This allows frontend development and demoing without starting the FastAPI backend.
