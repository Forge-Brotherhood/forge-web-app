# Forge - Prayer Request Social Network

A modern Next.js 15 web application for sharing and supporting prayer requests in a faith-based community.

## Features

- **Modern Tech Stack**: Built with Next.js 15, TypeScript, Tailwind CSS, and shadcn/ui components
- **Theme Support**: Full dark, light, and system theme support
- **Prayer Requests**: Create and share prayer requests with the community
- **Anonymous Posts**: Option to share requests anonymously for privacy
- **Clean Design**: Modern, accessible UI with a focus on simplicity and compassion
- **Responsive**: Fully responsive design that works on all devices

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the development server:
   ```bash
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000) in your browser

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run db:migrate:deploy` - Apply Prisma migrations to the target database (prod-safe)

## Production migrations (Vercel)

This repo uses Prisma migrations in `prisma/migrations/*`. **These are not applied just by checking in code**—they must run during deployment.

- **Vercel deploy behavior**: if `package.json` contains a `vercel-build` script, Vercel will run it during production builds.
- **Configured here**: `vercel-build` runs `prisma migrate deploy` before `next build` **only when**:
  - `VERCEL_ENV=production`
  - `RUN_PRISMA_MIGRATIONS=true`

This lets you deploy code safely even if production hasn’t been baselined to Prisma migrations yet (common if you used `prisma db push` historically).

### Baseline / “current schema already exists” scenarios

If production was ever updated via `prisma db push` or manual SQL (so the schema exists but `_prisma_migrations` doesn’t reflect it), `prisma migrate deploy` can fail.

To fix, connect to the **production** database and run:

```bash
npx prisma migrate status
```

If Prisma reports migrations missing but the schema already matches, mark them applied (baseline):

```bash
npx prisma migrate resolve --applied <migration_folder_name>
```

Then re-run:

```bash
npx prisma migrate deploy
```

### If `prisma migrate diff` outputs a large script

That usually means **production schema does not match** `prisma/schema.prisma` (either it’s behind, or it drifted).

Recommended sequence:

0. **If `prisma db push` fails due to required columns on existing data** (common for Bible highlights/notes):

Run the backfill bridge SQL first (adds required range columns with safe defaults + backfills from legacy `verseId`), then retry `db push`:

```bash
DATABASE_URL="..." npx prisma db execute --file prisma/manual/backfill-bible-ranges.sql
```

Or via npm:

```bash
DATABASE_URL="..." npm run db:backfill:bible-ranges
```

1. **Bring prod schema up to current** (historically consistent with `db push`):

```bash
DATABASE_URL="..." npx prisma db push
```

2. **Verify there’s no drift**:

```bash
DATABASE_URL="..." npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```

3. Once the diff is empty (or only benign noise), **baseline** by resolving your initial migration(s) as applied, then enable `RUN_PRISMA_MIGRATIONS=true` on Vercel Production.

### Common `db push` failure: legacy GroupType enum values

If prod has legacy `Group.groupType` values like `circle` / `core`, Prisma may fail converting the enum.

Run:

```bash
DATABASE_URL="..." npm run db:backfill:group-type:add-values
DATABASE_URL="..." npm run db:backfill:group-type:remap
```

Then retry:

```bash
DATABASE_URL="..." npx prisma db push --accept-data-loss
```

## Project Structure

```
forge-web-app/
├── app/                    # Next.js App Router
│   ├── globals.css        # Global styles with Tailwind CSS
│   ├── layout.tsx         # Root layout component
│   └── page.tsx           # Home page
├── components/            # React components
│   ├── ui/               # shadcn/ui components
│   ├── navbar.tsx        # Navigation component
│   ├── prayer-card.tsx   # Prayer request card
│   ├── create-prayer.tsx # Prayer creation form
│   └── theme-toggle.tsx  # Theme switcher
└── lib/
    └── utils.ts          # Utility functions
```

## Technologies Used

- **Next.js 15** - React framework with App Router
- **TypeScript** - Type safety
- **Tailwind CSS 4** - Utility-first CSS framework
- **shadcn/ui** - Beautiful, accessible UI components
- **next-themes** - Theme management
- **Radix UI** - Headless UI primitives
- **Lucide React** - Icon library

## License

ISC