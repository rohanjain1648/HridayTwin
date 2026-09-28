# MyZenn — Design System & UI Documentation

> A complete reference for the visual language, theming, color system, typography, components, and frontend architecture of the **MyZenn** mental-wellness platform.
>
> Live: **myzenn.com** · Stack: **React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui (Radix primitives)**

---

## Table of Contents
1. [Design Philosophy](#1-design-philosophy)
2. [Tech & Tooling](#2-tech--tooling)
3. [Theming System (6 Themes)](#3-theming-system-6-themes)
4. [Color Tokens](#4-color-tokens)
5. [Typography](#5-typography)
6. [Spacing, Radius & Layout](#6-spacing-radius--layout)
7. [Shadows & Elevation](#7-shadows--elevation)
8. [Gradients](#8-gradients)
9. [Glassmorphism](#9-glassmorphism)
10. [Animations & Motion](#10-animations--motion)
11. [Component Library](#11-component-library)
12. [Button System](#12-button-system)
13. [Iconography](#13-iconography)
14. [Layout & Navigation Patterns](#14-layout--navigation-patterns)
15. [Data Visualization](#15-data-visualization)
16. [3D / Immersive UI](#16-3d--immersive-ui)
17. [Accessibility & Responsiveness](#17-accessibility--responsiveness)
18. [File Reference](#18-file-reference)

---

## 1. Design Philosophy

MyZenn's theme system is explicitly **"Inspired by: VS Code, Linear, Notion, Headspace"** (per `src/styles/theme.css`). The aesthetic combines:

- **Calm, premium minimalism** — clean surfaces, generous whitespace, soft shadows.
- **Glassmorphism** — frosted, translucent panels with backdrop blur throughout.
- **Mesh gradients** — subtle radial color washes applied to the page background.
- **Teal-centric brand identity** — "MyZen Teal" is the default primary across the light experience.
- **Adaptive multi-theme** — 6 fully designed color worlds, some unlocked through gamified achievements.
- **Soft motion** — gentle floating, breathing pulses, and fade-in-up reveals (never jarring), respecting reduced-motion preferences.

The brand name renders as **`MYZENN`** in a thin, wide-tracked display font, with an **"M" monogram** tile as the logo mark.

---

## 2. Tech & Tooling

| Concern | Choice |
|---|---|
| Framework | React 18.3 + TypeScript 5.8 |
| Build tool | Vite 5 (`@vitejs/plugin-react-swc`) |
| Styling | Tailwind CSS 3.4 + `tailwindcss-animate` |
| Component layer | shadcn/ui (style: `default`, baseColor: `slate`, CSS variables on) |
| Primitives | Radix UI (accordion, dialog, dropdown, popover, tooltip, etc.) |
| Class utilities | `clsx` + `tailwind-merge` via `cn()` (`@/lib/utils`) |
| Variants | `class-variance-authority` (cva) |
| Theme switching | `next-themes` (class-based, 6 themes) |
| Animation | `framer-motion` 12, Tailwind keyframes, `tailwindcss-animate` |
| Icons | `lucide-react` |
| Charts | `recharts`, `d3-scale`, `d3-shape`, `d3-hierarchy` |
| 3D / WebGL | `three`, `@react-three/fiber`, `@react-three/drei`, `maath` |
| Audio | `tone` (synth instruments, chimes) |
| Lottie | `lottie-react`, `@lottiefiles/dotlottie-react` |
| Confetti / fun | `canvas-confetti` |
| Forms | `react-hook-form` + `zod` + `@hookform/resolvers` |
| Toasts | `sonner` |
| Drawers | `vaul` |
| Carousels | `embla-carousel-react` |

**Path aliases:** `@/components`, `@/components/ui`, `@/lib`, `@/lib/utils`, `@/hooks`.

---

## 3. Theming System (6 Themes)

Themes are applied as a class on `<html>` via `next-themes` and defined in [`src/styles/theme.css`](src/styles/theme.css). Each theme overrides the same set of HSL CSS custom properties, so all components automatically re-skin.

| Theme | Class | Mood / Inspiration | Background | Primary |
|---|---|---|---|---|
| **Light** (default) | `:root` / `.light` | Clean, minimal, Apple-inspired | `0 0% 100%` (white) | Teal `180 100% 35%` |
| **Dark** | `.dark` | Sophisticated deep dark, VS Code | `220 40% 4%` | Teal `180 80% 50%` |
| **Mint** | `.mint` | Fresh, calming green, Calm app | `140 40% 98%` | Green `160 70% 35%` |
| **Sunset** | `.sunset` | Warm amber/coral, Headspace | `30 50% 98%` | Orange `25 90% 50%` |
| **Ocean** | `.ocean` | Deep blue, relaxing, Slack/Figma | `215 60% 6%` | Sky `200 85% 55%` |
| **Cosmic** | `.cosmic` | Purple/violet galaxy, Dracula | `265 50% 5%` | Violet `280 80% 60%` |

> All color values are stored as **HSL channel triplets** (e.g. `180 100% 35%`) and consumed as `hsl(var(--token))`, which makes opacity modifiers like `bg-primary/20` work cleanly.

### Theme selector UX
Defined in [`src/components/ThemeSelector.tsx`](src/components/ThemeSelector.tsx):
- A responsive grid (`grid-cols-2 sm:grid-cols-3`) of theme tiles.
- Each tile: a circular color swatch + Lucide icon (`Sun`, `Moon`, `Leaf`, `Waves`, `Sunset`, `Sparkles`), label, and tooltip with a short description.
- **Light & Dark are always available**; **Mint, Ocean, Sunset, Cosmic are "premium" themes unlocked through achievements** (`useAchievements().unlockedThemes`).
- Locked tiles render with `opacity-50 grayscale cursor-not-allowed` and a `Lock` icon.
- Active tile: `border-primary ring-2 ring-primary/20 bg-accent` with a `Check` badge.
- `DEV_UNLOCK_ALL_THEMES = true` flag currently unlocks everything for testing (shows a "DEV MODE" pill).

---

## 4. Color Tokens

Every theme defines this consistent token contract (shown here with **Light** theme values). Reference: [`src/styles/theme.css`](src/styles/theme.css).

### Semantic tokens (Light)
| Token | HSL | Purpose |
|---|---|---|
| `--background` | `0 0% 100%` | Page background |
| `--foreground` | `220 20% 10%` | Body text |
| `--card` / `--card-foreground` | `0 0% 100%` / `220 20% 10%` | Card surfaces |
| `--popover` / `--popover-foreground` | `0 0% 100%` / `220 20% 10%` | Popovers / menus |
| `--primary` / `--primary-foreground` | `180 100% 35%` / `0 0% 100%` | Brand actions |
| `--primary-glow` | `180 85% 55%` | Glow accents |
| `--secondary` / `--secondary-foreground` | `220 15% 96%` / `220 20% 10%` | Secondary surfaces |
| `--muted` / `--muted-foreground` | `220 15% 96%` / `220 10% 45%` | Muted text/bg |
| `--accent` / `--accent-foreground` | `180 30% 96%` / `180 100% 25%` | Subtle highlights |
| `--destructive` / `--destructive-foreground` | `0 85% 60%` / `0 0% 100%` | Errors / delete |
| `--warm` / `--warm-foreground` | `30 80% 55%` / `0 0% 100%` | Warm accent |
| `--border` | `220 15% 90%` | Borders |
| `--input` | `220 15% 90%` | Input borders |
| `--ring` | `180 100% 35%` | Focus rings |

### Brand teal scale (Light `:root`)
A dedicated 50–700 teal ramp ("MyZen Teal"):

```
--myzen-teal-50 : 180 100% 98%
--myzen-teal-100: 180 100% 94%
--myzen-teal-200: 180 95% 85%
--myzen-teal-300: 180 90% 70%
--myzen-teal-400: 180 85% 55%
--myzen-teal-500: 180 100% 35%   ← brand primary
--myzen-teal-600: 180 100% 25%
--myzen-teal-700: 180 100% 20%
```

### Fixed brand utility colors
Hard-coded in [`tailwind.config.ts`](tailwind.config.ts) (not theme-adaptive):
| Tailwind class | Hex | Use |
|---|---|---|
| `wellness` | `#10B981` | Wellness/positive states |
| `calm` | `#6366F1` | Calm/indigo accent |
| `positive` | `#22C55E` | Positive/success metrics |

### Sidebar tokens
A separate `--sidebar-*` set (`background`, `foreground`, `primary`, `accent`, `border`, `ring`) supports the shadcn sidebar component.

---

## 5. Typography

Imported from Google Fonts in [`src/index.css`](src/index.css):

```
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:...&family=Outfit:wght@100..900&display=swap');
```

| Role | Family | Tailwind class | Applied to |
|---|---|---|---|
| **Body / UI** | `DM Sans` (fallback `system-ui, sans-serif`) | `font-sans` | `body`, default text |
| **Display / Headings** | `Outfit` (fallback `system-ui, sans-serif`) | `font-display` | `h1`–`h6` automatically |

**Conventions observed:**
- Headings use Outfit and frequently lean on light/thin weights for an airy, premium feel.
- The logo wordmark `MYZENN` uses `font-display text-xl font-thin tracking-[0.1em]` (wide letter-spacing). The monogram "M" uses `font-display font-light`.
- Body is `antialiased`.
- `.text-gradient` utility clips the hero gradient into text (`-webkit-background-clip: text`).

---

## 6. Spacing, Radius & Layout

### Container
From [`tailwind.config.ts`](tailwind.config.ts):
```
container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } }
```
Common page wrappers also use `container max-w-6xl mx-auto`.

### Border radius
Driven by `--radius: 0.75rem` (12px):
| Token | Value |
|---|---|
| `rounded-sm` | `calc(radius - 4px)` = 8px |
| `rounded-md` | `calc(radius - 2px)` = 10px |
| `rounded-lg` | `radius` = 12px |
| `rounded-xl` | `calc(radius + 4px)` = 16px |
| `rounded-2xl` | `calc(radius + 8px)` = 20px |
| `rounded-3xl` | `calc(radius + 16px)` = 28px |

Pills (`rounded-full`) are used heavily for nav links, badges, and the voice button.

---

## 7. Shadows & Elevation

Theme-aware shadow tokens (values shift per theme for correct contrast). Exposed as Tailwind `shadow-soft | shadow-glow | shadow-card | shadow-float` and matching utility classes.

| Token | Light value | Role |
|---|---|---|
| `--shadow-soft` | `0 4px 20px -2px rgba(0,0,0,0.08)` | Resting elevation |
| `--shadow-card` | `0 8px 32px -4px rgba(0,0,0,0.1)` | Cards |
| `--shadow-float` | `0 20px 40px -5px rgba(0,0,0,0.12)` | Hover / floating |
| `--shadow-glow` | `0 0 20px rgba(0,200,200,0.3)` | Teal glow on focus/CTA |

Dark/Ocean/Cosmic variants use deeper, colored glows (e.g. cosmic glow `rgba(180,100,255,0.2)`).

---

## 8. Gradients

Theme-scoped gradient variables (each theme redefines them):

| Variable | Light definition | Utility class |
|---|---|---|
| `--gradient-hero` | `linear-gradient(135deg, hsl(180 100% 35%), hsl(200 80% 50%))` | `.gradient-hero` |
| `--gradient-calm` | `linear-gradient(180deg, #F8FAFC, #EFF6FF)` | `.gradient-calm` |
| `--gradient-warm` | `linear-gradient(135deg, hsl(30 80% 55%), hsl(40 90% 60%))` | `.gradient-warm` |
| `--gradient-glass` | `linear-gradient(180deg, rgba(255,255,255,0.7), rgba(255,255,255,0.3))` | `.gradient-glass` |

### Mesh gradient background
Applied to `<body>` via `.mesh-gradient` — six radial gradients positioned at the corners/edges using `--primary` and `--accent` at low alpha, with `background-attachment: fixed` and a 0.5s color transition for smooth theme changes.

---

## 9. Glassmorphism

Adaptive glass tokens per theme:
- `--glass-bg` — light themes use a subtle solid tint (e.g. `rgba(240,245,250,0.85)`); dark themes use `rgba(255,255,255,0.05)`.
- `--glass-border` — low-alpha border.

Utility classes (in [`src/index.css`](src/index.css)):
| Class | Behavior |
|---|---|
| `.glass-morphism` | `var(--glass-bg)` + `backdrop-blur(16px)` + glass border + soft shadow |
| `.glass-card` | `backdrop-blur(12px)` + card shadow + 0.3s transition; on hover lifts `translateY(-2px)`, shows float shadow, border turns `primary/0.3` |
| `.gradient-glass` | gradient fill + `backdrop-blur(20px)` + glass border |

Used for nav bars, headers, cards, and overlay surfaces throughout (e.g. `Navigation` uses `glass-card border-b border-border/50`).

---

## 10. Animations & Motion

### Tailwind keyframes / animations
Defined in [`tailwind.config.ts`](tailwind.config.ts) and [`src/index.css`](src/index.css):

| Animation | Class | Effect |
|---|---|---|
| `voice-pulse` | `animate-voice-pulse` | Scale 1→1.15 + opacity fade, 2s infinite (voice orb halo) |
| `voice-wave` | `animate-voice-wave` | `scaleY` 0.3→1, 0.8s infinite (audio bars) |
| `float` | `animate-float` | `translateY` 0→-10px, 4s infinite (floating elements) |
| `fade-in-up` | `animate-fade-in-up` | opacity + 20px rise, 0.6s reveal |
| `scale-in` | `animate-scale-in` | opacity + scale 0.95→1, 0.3s |
| `glow-pulse` | `animate-glow-pulse` | pulsing teal box-shadow, 3s |
| `shimmer` | `animate-shimmer` | sliding gradient (skeleton/loading) |
| `accordion-down/up` | (via tailwindcss-animate) | Radix accordion expand/collapse |

### Framer Motion
Used for entrance/page transitions, e.g. the header animates `initial={{opacity:0,y:-20}} → animate={{opacity:1,y:0}}` over 0.5s ([`MyZenHeader.tsx`](src/components/MyZenHeader.tsx)).

### Motion principles
- `html { scroll-behavior: smooth }`.
- Reduced-motion respected (`@media (prefers-reduced-motion: no-preference)` guards decorative spins in `App.css`).
- Hover micro-interactions: cards lift, buttons scale (`hover:scale-[1.02] active:scale-[0.98]`), glow shadows intensify.

---

## 11. Component Library

Built on **shadcn/ui** (Radix primitives) — full set lives in [`src/components/ui/`](src/components/ui/) and a mirrored set in `src/components/mental-health-agent-ui/ui/`. Available primitives include:

`accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button, button-group, calendar, card, carousel, chart, checkbox, collapsible, command, context-menu, dialog, drawer, dropdown-menu, empty, field, form, hover-card, input, input-group, input-otp, item, kbd, label, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner (toast), spinner, switch, table, tabs, textarea, toast, toggle, tooltip`.

### Notable custom / feature components ([`src/components/`](src/components/))
| Component | Purpose |
|---|---|
| `MyZenHeader` | Reusable glass logo header w/ theme toggle + optional language indicator |
| `Navigation` | Fixed glass top-bar "Back to Sanctuary" |
| `ThemeSelector` / `ThemeToggle` | Theme grid & quick toggle |
| `VoiceOrb` / `live-assessment/orb` | Animated AI voice companion orb (MyPal) |
| `Visualizer` / `LiveTranscript` / `StreamingText` | Voice/transcription UI |
| `StarField` / `EmotionSunburst` | Decorative + d3 emotion viz |
| `StreakHeatmap` / `ProgressCharts` / `AchievementsList` / `ShareableStats` | Gamification & analytics (MyReport) |
| `BoxBreathingSquare` | Breathing animation (MyBreath) |
| `games/*` (`BreathingBall`, `ColorConfuse`, `MemoryMatch`, `MoodColors`, `ShellGame`, `WordFlow`) | MyPlay cognitive games |
| `mental-health-agent-ui/*` | MyGuru assessment flow (question display, sentiment, progress, report) |
| `FeatureErrorBoundary` / `ErrorBoundary` / `MinorHiccup` | Graceful error UI |
| `ProfessionalHelpBanner` | Crisis / professional-help callout |

---

## 12. Button System

From [`src/components/ui/button.tsx`](src/components/ui/button.tsx) — `cva`-based. Base: `inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all duration-300`, focus ring, disabled opacity, auto-sized SVG icons.

### Variants
| Variant | Styling |
|---|---|
| `default` | `bg-primary` + soft shadow → glow on hover |
| `destructive` | `bg-destructive` |
| `outline` | 2px `primary/30` border, transparent, fills `primary/10` on hover |
| `secondary` | `bg-secondary` |
| `ghost` | transparent, `accent` bg on hover |
| `link` | underlined primary text |
| `hero` | `gradient-hero` + float shadow + `hover:scale-[1.02] active:scale-[0.98]` |
| `warm` | `bg-warm` accent |
| `glass` | `gradient-glass` + blur + `primary/20` border |
| `voice` | `gradient-hero`, **round**, glow, `hover:scale-105 active:scale-95` |

### Sizes
| Size | Dimensions |
|---|---|
| `default` | `h-11 px-5` |
| `sm` | `h-9 px-4 rounded-lg` |
| `lg` | `h-12 px-8 rounded-xl text-base` |
| `xl` | `h-14 px-10 rounded-2xl text-lg font-semibold` |
| `icon` | `h-11 w-11` |
| `voice` | `h-20 w-20` (large round mic button) |

---

## 13. Iconography

- **Library:** `lucide-react` (v0.462) — used app-wide.
- Default icon size in buttons: `size-4` (16px), auto-applied to SVG children.
- Theme icons: `Sun, Moon, Leaf, Waves, Sunset, Sparkles`.
- Common UI icons: `Palette, Lock, Check, Globe, ArrowLeft`, etc.
- Custom SVG icon component: [`src/components/icons/BodyScanIcon.tsx`](src/components/icons/BodyScanIcon.tsx).
- Emoji are used as lightweight accents (flags for languages, 🔒 for locked states).

---

## 14. Layout & Navigation Patterns

- **App shell:** [`src/components/layout/Layout.tsx`](src/components/layout/Layout.tsx) + [`Navigation.tsx`](src/components/layout/Navigation.tsx).
- **Fixed translucent headers:** `fixed top-0 inset-x-0 z-50` with glass styling, blurred over scrolling content.
- **Logo behavior:** clicking the `MYZENN` mark / "M" tile routes home (`/`); sub-pages show a "Back to Sanctuary" link → `/mysanctuary`.
- **Routing:** `react-router-dom` v6.
- **The 4 product modules** each have their own page surfaces: **MyGuru** (assessment), **MyPal** (voice companion), **MySanctuary** (17 wellness tools hub), **MyReport** (analytics). Tool metadata (name, route, category, duration) is centralized in `src/data/sanctuaryTools.ts`.
- Pills + chips: rounded-full elements with `bg-white/5 border border-white/10 backdrop-blur-md` for secondary indicators (e.g. language chip).

---

## 15. Data Visualization

- **Charts:** `recharts` (`ProgressCharts`, `ShareableStats`) plus shadcn `chart` wrapper.
- **D3:** `d3-scale`, `d3-shape`, `d3-hierarchy` power custom visuals like `EmotionSunburst` and the Plutchik emotion wheel (MyWheel).
- **Heatmaps:** `StreakHeatmap` for habit streaks.
- **Export:** `html2canvas` + `jspdf` for shareable/printable reports; `react-qr-code` for share links.
- Chart palettes lean on the theme tokens plus the fixed `wellness/calm/positive` brand colors.

---

## 16. 3D / Immersive UI

MySanctuary contains WebGL/3D experiences:
- **Engine:** `three` + `@react-three/fiber` + `@react-three/drei` + `maath`.
- **MySpaces** — 3D WebGL meditation environments (cultural spaces).
- **MyVR** — 360° immersive environments.
- **MyParticles** — interactive zen particle visualizer.
- **MyChimes** — pentatonic instrument using `tone`.
- **AI / sensing:** `@tensorflow/tfjs` (+ webgl/webgpu backends), `@mediapipe/face_mesh` & `pose`, `@vladmandic/face-api`, `react-webcam` for unreleased biometric/facial features (MyPulse, MyMirror).
- **Lottie** animations via `lottie-react` / `dotlottie-react`.

---

## 17. Accessibility & Responsiveness

- **Dark mode:** class-based (`darkMode: ["class"]`), 4 of 6 themes are dark/low-light.
- **Focus visibility:** all interactive elements use `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.
- **Reduced motion:** decorative animations gated behind `prefers-reduced-motion`.
- **Responsive:** mobile-first Tailwind breakpoints; grids collapse (`grid-cols-2 sm:grid-cols-3`), containers cap at `1400px` (`2xl`).
- **Radix primitives** provide ARIA semantics, keyboard nav, and focus management out of the box.
- **Tooltips** supply supplementary descriptions for icon-only / locked controls.
- Color tokens stored as HSL for predictable contrast tuning per theme.

---

## 18. File Reference

| File | Contains |
|---|---|
| [`tailwind.config.ts`](tailwind.config.ts) | Color token mapping, fonts, radius, shadows, keyframes/animations, container |
| [`src/index.css`](src/index.css) | Font imports, base layer, utility classes (gradients, glass, mesh, animations) |
| [`src/styles/theme.css`](src/styles/theme.css) | All 6 theme definitions (CSS variables) |
| [`components.json`](components.json) | shadcn/ui config (style `default`, baseColor `slate`, aliases) |
| [`src/components/ui/`](src/components/ui/) | shadcn primitive components |
| [`src/components/ui/button.tsx`](src/components/ui/button.tsx) | Button variants & sizes |
| [`src/components/ThemeSelector.tsx`](src/components/ThemeSelector.tsx) | Theme picker UI + unlock logic |
| [`src/components/MyZenHeader.tsx`](src/components/MyZenHeader.tsx) | Branded glass header |
| [`src/components/layout/`](src/components/layout/) | App shell & navigation |
| [`src/data/sanctuaryTools.ts`](src/data/sanctuaryTools.ts) | Tool metadata (names, routes, categories) |
| [`src/App.css`](src/App.css) | Legacy/root styles (logo, reduced-motion) |

---

*Generated as a frontend/UI reference for the MyZenn platform. Token values reflect the current state of `theme.css` and `tailwind.config.ts`.*
