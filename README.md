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