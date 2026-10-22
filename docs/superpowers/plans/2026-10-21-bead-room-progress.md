# Implementation progress — plan: docs/superpowers/plans/2026-10-21-bead-room.md

## Direct HTML opening guard — 2026-10-21

- User screenshots show file:// access to public/index.html, with /styles.css resolving to file:///C:/styles.css and the application module blocked by the browser's local-file CORS policy.
- Changed entry resources to relative paths and added a deferred classic boot.js. Local-file mode hides the nonfunctional workbench and shows styled instructions to run 启动拼豆.cmd. HTTP/HTTPS mode loads app.mjs normally. No browser security restrictions are disabled.
- Added /boot.js to the server's static allowlist. Tests run the actual bootstrap in file/http/https contexts, and fetch the actual HTTP entry resources and all application modules with MIME checks. Full suite52/52 passed; npm.cmd run check includes boot.js syntax.
- An isolated temporary HTTP room rendered all291 colors, with CSS grid active and no captured browser warnings/errors. Screenshot: docs/boot-http-preview.png. Browser tool security rejected file:// navigation because only http/https are permitted; local-file branching is verified by automated execution, not claimed as a real-browser file:// check. Existing user artwork was not used for mutation tests.

## MARD palette expansion — 2026-10-21

- User initially requested 331 colors and supplied reference swatches, then selected makebead/craft-color-codes/data/csv/mard-291.csv as the source. Imported the actual 291 codes, not invented filler. Upstream version 85beca536d40b1a6254dc130d7d5923d96db9f7b and MIT notice are preserved in vendor/makebead/.
- Order: A B C D E F G H M P T R Y Q ZG, numeric ascending within each series. Four user reference overrides: B7 #3EAE7C, D5 #B34EC6, H1 #FFFFFF, H4 #868686; other source RGB values retained.
- Added code labels, group selection, code/HEX search, normalized leading zeroes, selected-color preservation after filtering, and independently scrolling desktop/mobile swatches.
- Legacy 24-color rooms are validated before in-memory conversion. Exact old RGB, cell/global revisions, and room keys survive; hidden legacy entries are retained only to render/export old artwork. Conversion writes nothing on load and persists through the regular atomic save on the next user edit. Actual user data was not edited in verification.
- Test-first failures observed for missing 291 colors, old-room conversion and search behavior; final full suite 48/48 passed. npm.cmd run check passed. PNG decoding verifies exact reference RGB and mixed legacy/last-extension colors at 4096 square. Two authenticated peers and restart preserve code ZG8/index290.
- Browser QA used an isolated temporary room on a random loopback port. Confirmed C07 search, ZG filtering and selection, A10 placement, no captured warn/error entries, and no horizontal overflow on desktop1011px and mobile360px. Mobile board remained visible at heights780 and619. Screenshots: docs/palette-desktop.png and docs/palette-mobile.png. No real phone or public tunnel used for this update.

## Project relocation — 2026-10-21

- User requested a separate project named pingdou. Current project root: C:\Users\35115\Documents\ChatGPT\pingdou.
- Moved the entire application, including dependencies, portable tunnel tool, existing artwork and room key; all 56 original application files and 3 moved design/plan documents passed SHA-256 verification immediately after the move.
- No application or tunnel process was active at migration. Start the application from the launchers in the new root. Original artwork data was preserved without modification.
- Package name and README launch path now use pingdou. Design, plan and progress files are inside this project's docs/superpowers; preview screenshots are in docs/.
- Verification from the new root: 41/41 tests passed, application and stop-script syntax checks passed, and all 6 local Markdown links resolved. Artwork hash remained unchanged during tests (4096 cells, 10 beads, revision 64). Private runtime data, dependencies and the tunnel executable remain ignored by Git.
- The new root has an independent Git repository on codex/pingdou. No author identity or global Git settings were changed. The old workspace now contains only its unrelated projects; the moved specification was removed from its old Git index.
- Codex sidebar registration was not performed: available app tools cannot create a local project, and the Computer Use guidance forbids automating the ChatGPT desktop app UI. Add this new folder through the app's project entry to register it.
- Entries below describe the earlier implementation and retain historical names and verification limits.

## Earlier implementation record

- Execution authorized: user approved design and requested first-version construction.
- Environment: Node v24.19.0; npm 11.17.0; repo has no commits or author identity. Existing unrelated files preserved.
- Execution adaptation: dedicated bead-room/ directory on codex/bead-room branch; no commit or worktree baseline can be created without inventing author identity. Source files remain reviewable locally.
- Shared interfaces: Task1 board/store consumed by server and exporter; Task2 protocol consumed by browser; all property names fixed in plan.
- Task 1: complete. Rule/filesystem tests observed missing implementation then passed. Real failed-write fixture preserves old file.
- Task 2: complete. Real two-WebSocket tests cover solo, competing placement, mutual erase, rejected cover, failed write, restart, auth, malformed and oversized frames, snapshot during pending save.
- Task 3: complete. PNG worker actual IHDR/decompressed RGB verified 4096 square; immutable snapshot, busy protection and authenticated HTTP export verified.
- Task 4: complete. Responsive UI, pan/zoom, palette, keyboard, invitations, solo use and 4K downloads. Gesture tests observed RED then GREEN. Desktop and 360x780 browser QA confirmed synced placement/erase and direct-cover refusal; no real iOS/Android device used.
- Independent review: no Critical findings; two Important findings reproduced and fixed: sync preserves pending operations before export, partial pointer cancellation retains other fingers. Both regression tests observed assertion RED then GREEN. Touch target discrepancy corrected to minimum44px.
- Review boundaries retained: multiple competing server processes on one data directory, absolute power-loss durability and hostile public traffic defenses are beyond this one-service small-room version; no such guarantees are claimed.
- Final suite: 24/24 passed. Browser console had zero captured warning/error entries. Actual browser export downloaded bead-room-v3-4096x4096.png.
- Task 5: launchers and README written; local background service running. Direct tunnel launch was blocked by automatic approval policy (only reason returned: blocked by policy), so no attempt to bypass via alternate process paths. Official signed cloudflared portable and manual launcher supplied; public end-to-end verification and real-phone save remain unverified.
- User requested further checks. The live board was already in use (10 beads, revision64 at read-only inspection), so further mutation tests use temporary fixtures rather than touching the live artwork.
- Additional protocol cases passed: different-cell concurrency persists both, empty erase produces no write, non-ASCII key rejected, cross-origin upgrade and encoded private paths refused. Suite28/28.
- Current426x619 narrow viewport: every visible button >=44 CSS pixels, zero captured console warnings/errors. Current saved board validated with4096 cells and sum(cell revisions)=global revision.
- A separate persistent QA process was blocked by automatic approval policy before execution. Existing temporary test fixtures and read-only page checks were used instead; no bypass attempted.
- Additional launcher audit found pre-spawn cancellation, early spawn error handling and duplicate-start locking defects. A bounded fix with isolated process/network simulations is in progress; the running3210 service is untouched.
- Launcher fixes complete. Root read final source and reran full suite:41/41 pass.13 isolated launcher cases execute actual entry flow against temporary directories and synthetic network/child processes. RED→GREEN included cancellation, spawn failure, PID timing, partial PID writes, interrupted binary writes, duplicate/concurrent starts, cleanup, stale/replaced lock protection, late logs and complete invitation parsing.
- PNG verification also validates chunk checksums. Desktop1280x800 layout has no horizontal document overflow. Runtime preview screenshots saved in bead-room/docs/.
- Final verification limits: no public tunnel launched; real iOS/Android devices not used; PowerShell stop/stale-lock helper parsed and read but dynamic helper validation was blocked by policy. No blocked action was retried through another mechanism. Existing local service and artwork remain running and untouched by the further-check mutation tests.
