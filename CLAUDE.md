# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Hebrew, fully RTL PWA for planning a week of home cooking, with a roulette for picking dishes. React 18 + TypeScript + Vite, local data in IndexedDB (Dexie), optional sync through Supabase. The product spec is `MealRouletteFiles/meal-planner-spec-he-v1.1.md`, and code comments cite its requirement IDs (`FR-5.5`, `FR-7.3`, …). `README.md` is in Hebrew and covers setup, sync, and install-on-phone.

## Commands

```bash
npm run dev                              # Vite dev server (port 5173)
npm test                                 # vitest run — all tests
npx vitest run src/engine/fridge.test.ts # one test file
npx vitest run -t "ranks a fully"        # tests whose name matches
npx tsc -b --noEmit                      # typecheck (npm run build = tsc -b && vite build)
```

There is no linter. Tests run in the `node` environment and only pick up `src/**/*.test.ts`, so there are no component or UI tests. A test that touches Dexie must `import 'fake-indexeddb/auto'` before anything that imports `src/db/db.ts` (see `src/services/week.test.ts`).

Without `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in `.env`, the app runs fully local with no sync and no AI features.

## Deploy

- **The site:** every push to `master` runs `.github/workflows/deploy.yml`, which runs the tests, builds, and publishes to GitHub Pages. The README says `main`, but the branch is `master`.
- **Edge functions:** `supabase/functions/*` are Deno functions that proxy Groq (`openai/gpt-oss-20b`) so the API key stays server-side. Deploy them with `npx supabase functions deploy <name> --project-ref dibyvpxckflmemmtyhze`. The project is already linked in `supabase/.temp`.
- **Server schema:** `supabase/schema.sql` is meant to be re-runnable. A new column on an existing table goes in as `alter table … add column if not exists …`, next to the `create table`.

## Architecture

**Local-first writes.** Every synced write goes through `save` / `saveMany` / `remove` in `src/db/repo.ts`. These write the Dexie row and an `outbox` row in one transaction; the UI reads with `useLiveQuery` and never waits on the network. `src/sync/sync.ts` pushes the outbox by upserting whole rows per table, then pulls everything past a watermark. Conflicts are last-write-wins on `updated_at`, except that a locally locked cook session always wins. Deletes are soft (`deleted_at`), so filter with `alive()` / `!deleted_at`.

**Adding a field to a synced type** (anything extending `Synced` in `src/types.ts`) needs a matching Postgres column. Rows are pushed whole, so an unknown key makes that table's whole upsert batch fail, and the outbox stops draining for every row. Apply the column to the live DB (`npx supabase db query --linked "alter table …"`) before client code that writes it ships. Make new fields optional so older rows still type-check.

**Local-only data.** `fridgeItems` and the `meta` key/value table (`getMeta` / `setMeta` in `src/db/db.ts`) never sync. `meta` holds the household id, the sync watermark, one-time migration versions, and the last AI fridge suggestion.

**Pure engine.** `src/engine/` is pure logic: the planner and roulette are seeded (`rng.ts`) and deterministic, which is why cooldown and relaxation rules are unit-tested without a browser. The rest covers shopping-list aggregation and unit handling, fridge matching, drag-to-swap on the week screen (`weekSwap.ts`), ingredient classification and aisle guessing (`ingredient-art.ts`), and converting AI output into a library dish (`ai-dish.ts`). `src/services/week.ts` turns engine plans into rows. The wheel animation only displays a decision that has already been made.

**Library data.** Dishes carry `ingredients` (quantity, unit, aisle, `is_scalable`, and `is_main`, the one or two ingredients the dish is built around). Fridge matching only suggests a dish when one of its `is_main` ingredients is on hand. The starter library is `src/db/seed-data.json`, bundled into the app; `MealRouletteFiles/meal-library-seed.json` is the original source and has drifted from it. `importSeedLibrary` in `src/db/seed.ts` matches by name. When you change the seed's main-ingredient marks, bump `SEED_MAINS_VERSION` so `applySeedMains` re-applies them once to households that already imported the library.

**AI features** (`src/sync/ai.ts`) all resolve to `null` on any failure, never throwing, so callers always have a local fallback. `generate-dish` suggests a dish from fridge items; `generate-recipe` expands it to amounts and steps on demand; `generate-dish-image` and `pick-week-dishes` do what their names say. The model leaves Hebrew acronym quotes (מ"ל, ק"ג) unescaped inside JSON, so parse its output defensively (see `fixHebrewAcronyms` in `generate-recipe`).

## Conventions

- **Hebrew grammar:** UI text and AI prompts use **masculine** Hebrew when addressing the user or the app (הוסף, בחר, חושב…), not feminine. A word that agrees with a feminine noun stays feminine (האפליקציה שומרת, המנה נכנסת).
- **Emoji:** in text that has an emoji, the emoji goes at the end ("שמירה במאגר 💾", not "💾 שמירה במאגר").
- **Styling:** styles live in `src/styles/theme.css`, with color tokens on `:root` and dark-mode overrides there; components also use inline `style` a lot. Reuse the existing `Sheet`, `Modal`, `Field`, `Notice` and `EmptyState` from `src/components/ui.tsx`.
- **Line endings:** many source files use CRLF. When editing with scripts, preserve each file's line endings.
- **Comments:** the codebase explains *why* in fairly long comments; match that density.
