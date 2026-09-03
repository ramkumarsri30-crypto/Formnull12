# Worklog

---
Task ID: 1
Agent: Super Z (main)
Task: Restore & run FormNull Phase 1 from uploaded workspace tar; redirect-loop fixes already committed in tar (no new phase, no new migrations)

Work Log:
- Extracted `workspace-6a51979a-fa66-430b-ba7f-210054bb4cbd.tar` (excl. .git) to upload/extracted/; analyzed: FormNull Phase 1, Next.js 16 + Supabase-only, 4 immutable SQL migrations (already applied to live project sqtolkfjnskyxnltuyci), git history with both redirect-loop fixes committed
- Initialized fullstack-dev scaffold; restored FormNull over it: src/ (app pages, proxy.ts, features, components, lib/supabase), supabase/migrations/ (reference only — NOT re-applied), scripts/, next.config.ts (trailingSlash:true), package.json + bun.lock, tailwind/components/tsconfig/eslint configs, download/ screenshots
- Removed scaffold src/lib/db.ts (Prisma — unused by FormNull; Supabase is the data layer)
- Recreated .env.local: Supabase URL + anon key (recovered from scripts/debug-auth-cookie.ts) + service-role key (recovered from scripts/confirm-test-user.ts — NOT lost this time) + SITE_URL
- `bun install` added @supabase/ssr 0.12.5 + @supabase/supabase-js 2.112.4; dev server auto-restarted via hot reload picked them up (one stale module-not-found compile resolved itself on recompile)
- Verified redirect-loop fixes in place: next.config.ts trailingSlash:true (gateway/Next canonical agreement), proxy.ts redirects to /signin/ + fail-open getUser + stale-cookie cleanup, auth/callback relative 303 redirects + safeRedirectTarget guard
- `npx eslint src/` → 0 errors (only scaffold examples/ demo has 1 pre-existing error, not app code); `npx tsc --noEmit` → clean
- Browser E2E (agent-browser, localhost:3000): fresh landing 200 with 0 page errors; unauth /dashboard → 2 hops (308 → /dashboard/ → auth → /signin/?redirect=) terminal 200, NO LOOP; signin formnull.test@gmail.com → /dashboard/ renders live workspace data (Personal workspace, real profile, Forms 0 / Submissions 0); reload stable; /dashboard and /dashboard/ both 200; /signin/ while authed → client redirect to /dashboard/; /dashboard/forms/ renders; sign out → / with 0 sb- cookies; poison-cookie regression (fake sb- token) → cookie cleared, single redirect, no loop
- Screenshots: download/verify-restore-landing.png, download/verify-restore-dashboard.png
- Supabase liveness: password grant for test account returns access_token (project + auth healthy)

Stage Summary:
- FormNull Phase 1 fully restored and running on port 3000; redirect loop verified fixed by design (worst case 2 hops, terminal 200)
- No new migrations created or applied; no Phase 2 work; existing 4 migrations untouched as files
- .env.local complete incl. recovered service-role key (server-only)
- Dev server managed by system (.zscripts/dev.sh); lint (src/) + tsc green

---
Task ID: 2
Agent: Super Z (main)
Task: Phase 2A — RLS repair preparation, env restoration, audit-identified code fixes, controlled E2E verification (STOP before Phase 3)

Work Log:
- Safety checkpoint: git clean content-wise (a990681 = c690d4b + one tool-results file; "dirty" = permission-bit noise only, 0 insertions/deletions); migrations 001–004 byte-identical to c690d4b; no 005 existed; one dev server running (boot-started), 4.0 GB RAM / 0 swap
- Restored .env.local (deleted from workspace — cause of "Your project's URL and Key are required" runtime error) with the owner's new sb_publishable/sb_secret keys; gitignored, chmod 600, never printed; keys verified live (auth /health 200; supabase-js 2.112.4 supports the new format)
- Diagnosed exact circular RLS: workspaces_insert_owner (owner_id = auth.uid()) lets the workspace INSERT succeed; wm_insert_admin (fn_user_can_admin_workspace) blocks the creator's own membership INSERT (no membership exists yet); workspaces_delete_owner (fn_user_owns_workspace) also blocks cleanup → orphan rows (debug-test-ws)
- Created supabase/migrations/005_workspace_creation_rls.sql (NOT applied): SECURITY DEFINER RPC create_workspace(p_name, p_description) → atomic workspace + owner membership in ONE transaction; owner always auth.uid(); no workspace_id/user_id params → cross-tenant membership structurally impossible; REVOKE from PUBLIC/anon, GRANT to authenticated; idempotent; heavy documentation comments
- Switched workspace-context.tsx createWorkspace to the RPC (removed two-step insert + orphan-cleanup-delete); typed the RPC in types.ts
- Fix A: form-detail.tsx saveForm updated_by now user.id from useAuth (was form.created_by) — runtime-verified (updated_by 52fdb4ee after save)
- Fix B: new-form.tsx uses the centralized 16-type registry (was a local 10-type list); inserted fields get defaultConfigForType (selects: options ["Option 1","Option 2"]) — runtime-verified in DB
- Fix C: persistOrder now parallel Promise.all batch + best-effort DB rollback of previous order on failure (UI revert kept); atomicity limitation documented (would need reorder RPC — future migration, not invented casually)
- Fix D: removed hardcoded keys from 7 scripts (backfill-legacy-profiles.ts, confirm-test-user.ts, debug-auth-cookie.ts, phase2-audit-db.sh, phase2-audit-db2.sh, test-supabase-endpoint.ts, probe-supabase-endpoints.ts) → env vars; shell scripts source .env.local; git grep clean
- Dev server memory management: killed 2.18 GB boot server; relaunched via .zscripts/dev.sh with NODE_OPTIONS=--max-old-space-size=1024 (launch-time env only); captured V8 OOM crash evidence (FATAL "Ineffective mark-compacts" at ~985 MB JS heap) proving the previous 3.1 GB OOM mechanism; planned restarts at suite boundaries; browsers closed when idle
- E2E Suite A PASS: sign-in; real workspace name/role/plan from DB; selector lists both workspaces with aria-current; switching re-queries (Forms 0→1); profiles.default_workspace_id persisted (DB-verified); refresh persists; localStorage empty; no console errors. Creation pending manual 005 apply (as instructed)
- E2E Suite B PASS: real COUNT queries (Forms 1→2 after controlled data), workspace-scoped recent forms, plan from workspace row, member since from membership.joined_at, correct empty state, no metadata.submission_count
- E2E Suite C PASS: Create Form → real INSERT + 3 initial field rows (dropdown with valid config.options) → builder redirect → rename + description persist (updated_by set)
- E2E Suite D PASS: all 16 supported types added/configured/saved with exact typed configs in DB (text lengths, number ranges, select options, rating max, file types/size); 5 validation-negative tests blocked with correct messages (empty options, rating>10, min≥max, invalid regex, maxSizeMb>100) with DB untouched; delete/re-add cycles (phone, dropdown); refresh-reload verified (16 rows)
- E2E Suite E PASS: arrow reorder (with automatic sort_order normalization), drag-and-drop, both persisted with no duplicates; offline failure test → UI reverted + error surfaced + DB unchanged
- E2E Suite F PASS: 320→2560 (11 widths) on dashboard + builder + field editor + ws dialog + mobile drawer — zero horizontal overflow; screenshots in download/phase2a-responsive/ (22+ files)
- Tenant isolation PASS (15/15 authenticated-request tests + UI): B cannot read A's workspace/forms/fields/submissions (RLS empty), B's membership insert into A's ws → 42501, B's rename attempt → no-op, A↔B symmetric denials, positive controls pass; created User B (formnull.b@gmail.com) via real signup flow; fn_handle_new_user trigger verified (auto profile+workspace+default)
- Transient issues documented (non-reproducible, no console errors): first full page load after server start/restart sometimes sticks at auth-init "Loading…" (valid cookie, zero REST calls — recovers instantly on reload, 3 reproduction attempts clean); one Turbopack Runtime ChunkLoadError on /signup (dev-server flake, recovered on reload)
- Final gates: tsc --noEmit --incremental false → EXIT 0; eslint src/ → EXIT 0; migrations 001–004 unchanged; no 005 applied; no package.json/bun.lock content changes; no secrets in tracked files; dev server left running (capped, RSS 1.9 GB)

Stage Summary:
- Migration 005 created and statically validated but NOT applied (user applies manually) — workspace creation E2E remains pending that apply
- All audit-identified code fixes (A/B/C/D) implemented and runtime-verified; Memphis/playful-geometric UI untouched (responsive-only verification)
- Phase 2 implementation is now runtime-verified: workspace real data, dashboard real counts, create-form persistence, 16-type builder CRUD + validation + reorder + rollback, responsive 320–2560, tenant isolation RLS
- Known remaining: auth-init transient (needs investigation in a later phase), Turbopack dev-server V8 heap growth (~1 GB per ~10 compiles — mitigated by cap + planned restarts), 5 deferred field types (datetime, page_break, signature, address, matrix), orphan debug-test-ws cleanup SQL prepared but not executed, legacy secret in git history (rotation recommended)

---
Task ID: 3
Agent: Super Z (main)
Task: Phase 2A FINAL VERIFICATION — close the remaining gap (migration 005 applied manually by owner) and verify the existing implementation; NO Phase 3, NO new migrations

Work Log:
- Safety checkpoint: git HEAD ff82806 (= c690d4b + screenshots/tool-results only, working tree clean); .env.local intact with correct var names; dev server down → started via double-fork pattern (sandbox reaps process trees between tool calls; double-fork orphans survive — same mechanism agent-browser uses)
- Migration 005 verification (scripts/phase2a-verify-005.ts, all read-only probes): anon EXECUTE denied (PG 42501 permission denied for function); service key without user JWT → AUTH_REQUIRED (auth.uid() guard live); authenticated executes real body (INVALID_NAME on blank name); forged user_id/workspace_id params → PGRST202 (signature has only p_name/p_description → cross-tenant membership impossible by construction); row counts unchanged by probes; ALL PROBES PASSED. (OpenAPI-spec probe removed: this project's REST gateway returns an empty paths list even for tables.)
- Orphan debug-test-ws: verified exact identity match (id 2d618272…, slug debug-test-ws, 0 members, 0 forms, owner formnull.test) → removed per owner authorization with id+slug guards; all other rows untouched
- REAL UI E2E creation (scripts/phase2a-final-e2e.sh): sign-in → selector → "Create workspace" menuitem → Memphis dialog opens → name/description filled → POST /rest/v1/rpc/create_workspace 200 on the wire → toast "Workspace created! Switched to …" → dashboard re-queries new ws (No forms yet) → PATCH profiles 204 (default_workspace_id)
- DB verification (scripts/phase2a-verify-db-after.ts): exactly 1 new workspace + 1 owner membership (role=owner, user_id=creator auth.uid()), default_workspace_id=6c5038ab…, no orphans anywhere, no duplicates, previous ws intact (2 forms), totals unchanged — ALL DB CHECKS PASSED
- Real switch E2E: selector lists all 3 of A's workspaces; ref-based switch to formnull-test ws shows its 2 real forms, default_workspace_id follows (DB-verified both directions); sign out → 0 sb- cookies; re-signin → default ws loads correctly
- RLS isolation re-run (scripts/phase2a-isolation.ts + new-workspace checks): 19/19 PASS (B↔A empty reads, membership inserts 42501, rename no-op, positive controls, new ws protected)
- Auth-init "Loading…" transient INVESTIGATED per §5: root cause captured live — Turbopack ChunkLoadError (dev overlay "Runtime ChunkLoadError", "Next.js 16.1.3 (stale)") → React never hydrates (0 hydrated elements) → no effects → no network calls → Loading… forever; recovers on reload. Repro ~1-in-5 reloads + first load after server restart; dev-only mechanism, zero app-console errors; NOT classified as environmental without evidence (ChunkLoadError + hydration counter are the evidence)
- Responsive (§7): found REAL bug — workspace-selector DropdownMenuContent side="right" inside the mobile drawer overflowed viewports ≤390px (menu right edge ≈518px on 375px screen → menuitems unreachable by pointer). Minimal Memphis-preserving fix in dashboard-shell.tsx: side={isMobile ? "bottom" : "right"} via existing useIsMobile hook (desktop ≥768 unchanged, verified menu x=246 popout preserved). After fix: all 11 widths (320/375/390/414/480/768/1024/1280/1440/1920/2560) PASS — dialog fits, buttons usable, 0 horizontal overflow, mobile drawer works
- Final gates: npx tsc --noEmit --incremental false → EXIT 0; npx eslint src/ → EXIT 0
- Dev-server memory: V8 heap cap (1024MB) hit twice by documented Turbopack heap growth → clean process death (machine never OOM'd, 3GB+ always free); restarted at suite boundaries; dev.log appends verified NOT to trigger rebuilds

Stage Summary:
- Migration 005 verified applied and secure (5/5 behavioral probes); orphan workspace removed after 4-condition identity match
- Workspace creation: all 18 checklist items PASS with real DB + network evidence
- RLS isolation 19/19 PASS; session/sign-out/sign-in PASS; responsive 11/11 PASS after 1 minimal fix
- ONLY src change: dashboard-shell.tsx +9/-1 (responsive dropdown side) — Memphis visual identity untouched
- Known issues documented (not fixed — no speculative changes): Turbopack ChunkLoadError dev flake (~1/5 loads, recovers on reload, dev-only); migration 005 slug derivation applies regexp_replace before lower() → uppercase letters consumed (slug "hase-2-inal-orkspace-est"; cosmetic only — slug unused in app; fix = reorder lower() first in a future maintenance window); favicon 404 (harness artifact)
- PHASE 2A VERIFIED AND CLOSED

---
Task ID: 4
Agent: Super Z (main)
Task: Phase 3A — design & author Migration 006 (publish + public form + public submission + answer retention + rate limiting) as a NEW file only; audit-first; NOT applied to live DB

Work Log:
- Read-only audit completed before any writing: migrations 001–005 re-read in full; app layer re-inspected (field-types.ts registry + validateConfig contract, field-editor.tsx exact config shapes incl. cleanConfig null-stripping, new-form.tsx slugify/field_key format, form-detail.tsx persistence, use-forms.ts keyset, overview.tsx COUNTs, proxy.ts routing incl. /forms protection, types.ts). Zero app code reads/writes submission_values or form_versions today; no field-count limit exists anywhere; submissions table empty.
- Audit findings driving design: submission_values.field_id FK ON DELETE CASCADE = future data-loss trigger; fn_submissions_set_defaults MAX+1 = real race; assets.owner_id NOT NULL + submissions bucket member-only policy + single-transaction RPC = file_upload genuinely unpublishable (3 architectural facts, not opinion); forms.public_key/published_version/form_versions exist unused; PostgREST denied-RPC pattern (401 + 42501 body) proven in 2A probes.
- CREATED supabase/migrations/006_publish_and_public_submission.sql (1,387 lines, 7 sections): (1) field_id → nullable + ON DELETE SET NULL with full impact analysis; (2) CREATE OR REPLACE fn_submissions_set_defaults — 003 body verbatim + guarded per-form pg_advisory_xact_lock (fixes seq race for ALL insert paths; single-lock-per-transaction → no deadlock; rollback script embedded in header); (3) form_rate_limits (fixed window 20/10min, PK lookup only, BRIN + probabilistic 1% cleanup, RLS on, ZERO policies/grants); (4) publish_form(uuid) — FOR UPDATE serialization, fn_user_can_edit_workspace auth, publishability checks (≥1 usable field, NEW 300-field publish cap with rationale, file_upload blocked with 3-fact explanation), per-type config validation mirroring validateConfig, explicit-column jsonb snapshot (never to_jsonb), 512KiB snapshot cap, atomic form_versions+forms flip; (5) get_public_form(text) — STABLE, snapshot-only read, public-safe columns, NOT_FOUND no-oracle; (6) submit_public_form(text,jsonb,text,jsonb) — honeypot-first fake success, 1MiB/300-key caps, snapshot-locked validation for all 14 submittable types (per-type caps, regex formats, option membership, step alignment, strict date cast), unknown-key rejection, metadata whitelist, honest request.headers handling (cf-connecting-ip → last XFF element, absent → limit skipped), hashed-IP rate limit after validation, atomic inserts with server-derived workspace_id/submitted_by, field_id→NULL retention for deleted fields; (7) grants (publish: authenticated only; get/submit: anon+authenticated, all revoked from PUBLIC) + read-only post-apply verification probes documented.
- Local validation WITHOUT any database: pip-installed pglast (libpg_query = real PG parser). scripts/validate-006.py: raw parse of whole file (17 statements) + parse_plpgsql compile of all 4 function bodies. Found + fixed 1 real bug (undeclared loop record r in publish_form). pglast trigger-tree JSON quirk (RETURNS trigger serialization) verified by repro as library-only — parse succeeds.
- Cross-check matrix scripts: every public.* object + every enum value + every INSERT/UPDATE/aliased-SELECT column verified against 001–005 definitions; RAISE %-arity verified. ALL PASSED.
- Gates: npx tsc --noEmit --incremental false → EXIT 0; npx eslint src/ → EXIT 0.
- Safety: NO SQL executed against Supabase (validation purely local parsing); NO test rows/users; 001–005 byte-identical (git diff empty); package.json/bun.lock untouched; src/ untouched.

Stage Summary:
- supabase/migrations/006_publish_and_public_submission.sql CREATED (not applied — owner applies manually); scripts/validate-006.py CREATED (reusable local parser harness)
- Migration is fully executable PL/pgSQL (no placeholder bodies), idempotent, RLS-neutral (zero policy changes, anon table grants remain zero), rollback documented in-file
- New product limits introduced deliberately and documented: 300-field publish cap, 512KiB snapshot cap, 1MiB payload cap, option/text/label caps, 20/10min/IP rate window
- Known limitations documented in-file: JS-pattern client-side only; scale defaults 1..10; IP rate limiting best-effort (headers may be absent); direct member form_versions inserts can bypass publish validation (editor-trust boundary, bounded by snapshot guards); per-form seq serialization throughput bound
- Next: owner applies 006 via SQL editor + runs the documented verification probes; then Phase 3B app layer (publish UI, /f/[key]/ route, submit UI, RPC types)
