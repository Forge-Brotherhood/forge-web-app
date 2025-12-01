# Forge Design Tokens

Reference documentation for consistent UI styling across the web application.

## Spacing

| Token | Value | Tailwind | Usage |
|-------|-------|----------|-------|
| Card padding | 16px | `p-4` | All cards, containers |
| List item gap | 12px | `space-y-3` | Feed items, response lists |
| Section gap | 24px | `space-y-6`, `mb-6` | Major page sections |

## Border Radius

| Token | Value | Tailwind | Usage |
|-------|-------|----------|-------|
| Cards/Containers | 12px | `rounded-xl` | Primary surfaces |
| Buttons | 12px | `rounded-xl` | Action buttons |
| Status chips | 9999px | `rounded-full` | Badges, tags |
| Avatars | 50% | `rounded-full` | Profile images |

## Avatars

| Context | Size | Tailwind |
|---------|------|----------|
| Standard (lists, comments) | 32px | `w-8 h-8` |
| Compose forms | 40px | `w-10 h-10` |
| Profile page | 64px+ | `w-16 h-16` |

## Colors

### Card Backgrounds
- **Standard**: `bg-card` (solid, no opacity)
- **Hover**: `hover:bg-accent/5`
- **Shadow**: `shadow-sm dark:shadow-none` (subtle elevation in light mode only)

### Status Chips
| Status | Background | Text |
|--------|------------|------|
| Answered | `bg-green-500/15` | `text-green-600 dark:text-green-400` |
| Update | `bg-amber-500/15` | `text-amber-600 dark:text-amber-400` |
| Open/Default | `bg-blue-500/15` | `text-blue-600 dark:text-blue-400` |

## Loading States

- Use skeleton components with `animate-pulse`
- Match skeleton structure to actual content layout
- Show 3 skeleton items for feed loading
- Skeleton structure:
  - Avatar: `w-8 h-8 rounded-full bg-muted`
  - Text lines: `h-4 bg-muted rounded`
  - Action buttons: `h-8 w-20 bg-muted rounded`

## Empty States

Use the `EmptyState` component with:
- Centered layout: `py-16 px-8`
- Icon size: `w-12 h-12 text-muted-foreground`
- Title: `text-[17px] font-semibold text-foreground`
- Message: `text-[15px] text-muted-foreground text-center`
- Optional action button

## Transitions

- Card hover: `transition-colors duration-200`
- Button press: `active:scale-[0.98]`
- Focus ring: `focus:ring-2 focus:ring-accent/20`

## Reference Components

- **PrayerListItemCard**: `/src/features/prayer/components/PrayerListItemCard.tsx`
- **StartSessionButton**: `/src/features/prayer/components/StartSessionButton.tsx`
- **EmptyState**: `/src/components/empty-state.tsx`
- **FeedCardSkeleton**: `/src/components/feed-card.tsx`
