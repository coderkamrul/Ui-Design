# canvas-tool (working codename)

An **original** browser-based design tool: infinite canvas, frames as the
only container, a deliberately small flex layout model, CSS-shaped styling,
per-file design tokens, and export of frames as images or real code
(Tailwind / React / CSS).

> **Originality note.** This is an independent implementation built from a
> *behavioural* spec — a five-phase study that observed a reference product
> as a user and documented what it does, never its code or assets. No code,
> icons, fonts, illustrations or copy from that product are used anywhere in
> this repository. The spec lives in `~/workspace/paper-design-spec/`
> (`INDEX.md` there is the map). The product name is still TBD —
> "canvas-tool" is only a codename.

**Status: everything in the Phase 5 plan is now built** — the §7 MVP
(M3), the §8 depth list (M4), the Supabase backend integration, shader
layers (M5), multiplayer (M6), version history (M7), the post-M7
depth gaps (flex drag-reorder, guide dragging, OKLCH editor, cursor
chat), and the platform batch: an **MCP agent API**, **AI Create**
image/SVG (procedural — honestly labelled, see below), and
**plans/billing UI** (demo checkout — honestly labelled, see below).
What remains is not features but verification and hardening: the
configured (Supabase) mode is code-reviewed but has never run against
a real project, and the production-hardening notes at the end of
this README list what a real deployment still needs. M3 completed
the Phase 5 §7 MVP: undo/redo with coalescing, silent local
persistence with real file management, share settings, basic
comments, and export / Copy-as code. M4 went past the MVP into the
Phase 5 §8 depth list: a working **pen/path tool** with anchor
editing, **images** (fill kind, Place image, paste) stored as
in-document assets, **frame guides + drag snapping**, the **hide-UI
modes** that were the one open §7 item, and **artboard navigation**.
The **backend + auth integration** is built: persistence and sign-in
speak Supabase when a project is connected, and fall back to the exact
local behaviour when one isn't — see
[Backend & auth (Supabase)](#backend--auth-supabase) below for setup.
M5 adds **shader layers** — our own WebGL mesh gradient as a node type,
the "WebGL island" Phase 5 reserved for effects the DOM can't express —
see [What works in M5](#what-works-in-m5--shader-layers-webgl-island).
The checklist below maps the Phase 5 §7 MVP scope to what is actually
built; the stubs list after it is equally explicit about what is NOT
built.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
```

Stack: **Next.js 15 (App Router) + React 19 + Tailwind CSS v4, JSX, npm.**
Editor state uses **Zustand**. Rendering is **DOM-based** (each document
node is a real DOM element) — the Phase 5 decision that makes flex, text
editing and code export nearly free, since the design model is CSS-shaped.

## Routes

| Route         | What it is                                                                 |
| ------------- | -------------------------------------------------------------------------- |
| `/`           | Dashboard: 240px sidebar (team label, plan badge, nav, account footer), search field, Grid/List toggle, **New file** button (plan-capped on Free), **Import JSON** button, file cards from persistence (local registry or Supabase) with Rename / Duplicate / Export JSON / Archive menus, and an Archive section (Unarchive). Gated to `/login` in configured mode. |
| `/file/[id]`  | Editor: top bar (Undo/Redo, editable title, zoom menu, Comments, History, account area with plan chip, Share popover), left sidebar (Design/Theme tabs, Pages with add/rename, live Layers, token CRUD), toolbar strip (incl. procedural Create SVG / Create image), interactive canvas (pen + anchor editing, snapping, hide-UI modes), live inspector with Export + Copy-as. The document for the id is loaded via persistence and autosaves silently. Gated in configured mode. |
| `/login`      | Sign-in: email one-time-code flow (Supabase Auth) in configured mode; in local mode it explains that no backend is connected and links back to the app. |

## Layout of the code

```
app/
  page.js               dashboard
  file/[id]/page.js     editor route (renders components/EditorShell)
  login/page.js         email one-time-code sign-in (Supabase Auth)
  layout.js             root layout (system font stack, no webfonts;
                        mounts the AuthProvider session context)
  globals.css           Tailwind v4 import + our CSS-variable design tokens
components/
  EditorShell.jsx       top bar (undo/redo, editable title, zoom menu
                        with the Snap toggle, Comments button, Share
                        popover), sidebars, toolbar (+ Place-image
                        button), the three uiModes with floating chrome,
                        file load + silent autosave wiring, toasts
  Viewport.jsx          the canvas: pan/zoom transform, pointer gestures,
                        keyboard shortcuts (incl. Ctrl+Z / Ctrl+Shift+Z),
                        selection overlay + handles, text-editor overlay,
                        comment pins, pen drawing + anchor editing,
                        move-drag snapping, paste-an-image, flex
                        drag-reorder, guide dragging, cursor chat
  CanvasNode.jsx        the DOM renderer: full style stack + flex layout,
                        path (SVG) and image nodes, frame guides overlay
  Inspector.jsx         right-sidebar inspector: layout/flex, appearance,
                        fill (incl. image fills), outline, border,
                        shadows, filters, text, path + guides sections,
                        Export + Copy-as (M3); the colour editor has
                        Hex / RGB / HSL / OKLCH modes (lib/color.js)
  ThemePanel.jsx        left-sidebar Theme tab: token CRUD, aliases,
                        starter theme
  CommentsPanel.jsx     comment draft composer / thread / list overlay
  Collab.jsx            M6 multiplayer: useCollab room hook (identity,
                        transport join, presence publish, doc sync) +
                        the top-bar avatar stack / status popover;
                        cursor chat rides its presence + broadcasts
  HistoryPanel.jsx      M7 version history: save-current form, the
                        newest-first version list (relative + absolute
                        times, author, page/node counts) with Preview /
                        Restore / inline Rename / confirm Delete
  AiCreate.jsx          platform batch: the toolbar's Create SVG /
                        Create image buttons + prompt panel
                        (procedural generation via lib/ai.js, plan
                        usage cap, one-commit image-node insertion)
  UpgradeDialog.jsx     platform batch: Free vs Pro comparison,
                        monthly/yearly toggle, DEMO checkout form (no
                        payment is taken — see the Plans section),
                        downgrade with inline confirm
lib/
  model.js              document data model (JSDoc typedefs) + style/token
                        helpers (gradient/filter/shadow builders, delete-
                        token auto-detach) + isValidDoc / normalizeDoc
                        for Import JSON (platform batch)
  geometry.js           pure screen<->canvas math, rect/zoom/tree helpers
                        (tested by scripts/geom-test.mjs)
  flex.js               pure flex math: the spec's Fill distribution rule,
                        alignment mapping, flex-item styles, and the
                        drag-reorder helpers (insertionIndex midpoint
                        rule, reorderList) (tested by
                        scripts/model-test.mjs)
  theme.js              our starter theme (token group structure only —
                        names and values are our own)
  sample-doc.js         sample files + the sample document (freeform and
                        flex frames, a token-bound fill and gap)
  store.js              Zustand editor store (doc, page, selection array,
                        viewport, tool) + mutation actions with history
                        commits, undo/redo, toasts, comments
  history.js            pure undo-history helpers: snapshot entries,
                        coalescing window, 100-entry cap
                        (tested by scripts/history-test.mjs)
  persistence.js        file storage, API-shaped and async (list/load/
                        save/create/duplicate/updateMeta + M7 version
                        load/save beside the doc): localStorage in
                        local mode, the Supabase `files` table when
                        configured; seeds the sample files on first
                        run (locally, or as a first-login user's rows)
  supabase.js           env-gated Supabase client singleton:
                        isSupabaseConfigured() + getSupabase()
  rows.js               pure row <-> doc/meta mapping for the files
                        table (tested by scripts/row-shape-test.mjs)
  auth.js               session context for Supabase Auth (useSession);
                        a stable "local" state when unconfigured
  codegen.js            pure Copy-as generators: nodeToCss (with a :root
                        token block), nodeToTailwind, nodeToReact
                        (tested by scripts/codegen-test.mjs)
  path.js               pure bézier path math: anchors -> SVG `d`, bounds,
                        smooth-toggle handle creation/mirroring, anchor
                        normalisation (tested by scripts/path-test.mjs)
  snap.js               pure snapping math: snap-line collection (node
                        edges/centres + frame guides) and per-axis snap
                        resolution (tested by scripts/snap-test.mjs)
  shader.js             pure shader-layer data: 4 original presets,
                        parameter normalisation, hex -> RGB uniform
                        packing, and the original WebGL1 GLSL sources
                        (tested by scripts/shader-test.mjs)
  images.js             browser-side image intake: file -> downscaled
                        asset (max 1600px long edge); a dataURL locally,
                        a Supabase Storage upload (public URL) when
                        configured, with dataURL fallback on any failure
  collab.js             M6 multiplayer: import-free transport
                        abstraction (Supabase Realtime channel /
                        BroadcastChannel) + pure helpers — peer palette,
                        presence reduce/prune, cursor throttle, doc seq
                        guard (tested by scripts/collab-test.mjs)
  versions.js           M7 version history: import-free pure helpers —
                        makeVersion (deep snapshot, never nested),
                        pruneVersions (cap 30, autos first), 15-minute
                        auto-version policy, summaries + titles
                        (tested by scripts/versions-test.mjs)
  color.js              colour conversions for the Inspector's editor
                        (depth-gap batch): hex <-> rgb <-> hsl <->
                        oklch (OKLab matrices, linear-sRGB gamut
                        clamp), oklch() string parse/format — a view
                        layer only; docs still store hex + alpha
                        (tested by scripts/color-test.mjs)
  ai.js                 platform batch: PROCEDURAL generation —
                        import-free; FNV-1a prompt hash, mulberry32
                        PRNG, keyword-routed palettes, deterministic
                        seeded SVG compositions (5 motif families +
                        sky fallback). NOT an AI model — see the
                        AI Create section (tested by
                        scripts/ai-test.mjs)
  plans.js              platform batch: import-free plan definitions
                        (this product's own pricing) + limit helpers
                        (planOf, effectiveVersionCap, withinLimit) +
                        localStorage plan / AI-usage state (tested by
                        scripts/plans-test.mjs)
mcp/
  server.mjs            platform batch: zero-dependency MCP server
                        over stdio (hand-rolled JSON-RPC): 7 tools
                        editing document JSON files in a workspace
                        dir — see mcp/README.md (tested end-to-end by
                        scripts/mcp-test.mjs)
  README.md             MCP setup, client config, tool reference, and
                        the honest file-bridge architecture note
supabase/
  schema.sql            paste-into-SQL-editor schema: files table +
                        owner-only RLS + the public `assets` bucket with
                        owner-folder write policies + updated_at trigger
scripts/
  geom-test.mjs         node assertions for lib/geometry.js (8 checks)
  model-test.mjs        node assertions for lib/model.js + lib/flex.js (8)
  history-test.mjs      node assertions for lib/history.js (5)
  codegen-test.mjs      node assertions for lib/codegen.js (4)
  path-test.mjs         node assertions for lib/path.js (8)
  snap-test.mjs         node assertions for lib/snap.js (5)
  row-shape-test.mjs    node assertions for lib/rows.js (6)
  shader-test.mjs       node assertions for lib/shader.js (8)
  collab-test.mjs       node assertions for lib/collab.js (10)
  versions-test.mjs     node assertions for lib/versions.js (6)
  color-test.mjs        node assertions for lib/color.js (8)
  ai-test.mjs           node assertions for lib/ai.js (46)
  plans-test.mjs        node assertions for lib/plans.js (24)
  mcp-test.mjs          end-to-end: spawns mcp/server.mjs against a
                        temp dir and drives the full tool round trip
                        over NDJSON JSON-RPC (24)
```

Chrome metrics (40px top bar, 240/280px sidebars, 1px dividers, spacing and
radius scales, light-theme surfaces) come from our own token set in
`app/globals.css`, seeded from the Phase 2 spec measurements.

## Backend & auth (Supabase)

The app has two modes, chosen purely by environment — there is no
feature flag in the UI and no code change between them:

- **Local mode** (default): `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` are unset. Everything runs on
  localStorage exactly as the M3/M4 builds did; there is no sign-in;
  the dashboard and editor show a quiet "Local mode" label.
- **Configured mode**: both variables are set. Sign-in is required,
  files live in the Supabase `files` table (one row per file, document
  as jsonb, Row Level Security restricting each user to their own
  rows), and image uploads go to the `assets` storage bucket.

### Setup (one time, ~5 minutes)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the whole of
   [`supabase/schema.sql`](supabase/schema.sql), and run it. This
   creates the `files` table, its owner-only RLS policies, an
   `updated_at` trigger, and the public `assets` bucket with
   owner-folder write policies.
3. In **Authentication → Providers → Email**, make sure the Email
   provider is enabled and one-time codes (OTP) are allowed — the
   sign-in flow emails a 6-digit code (no passwords). Under
   **Authentication → URL Configuration**, add your app's URL
   (e.g. `http://localhost:3000`) as an allowed redirect/site URL.
4. Copy `.env.example` to `.env.local` and fill in the two values from
   **Project Settings → API** (Project URL + the **anon public** key —
   never the `service_role` key).
5. Restart `npm run dev`. The dashboard now redirects to `/login`;
   sign in with your email and the code it sends. On first login, the
   three sample files are created as your rows so the dashboard isn't
   empty.

### What works in each mode

| Capability | Local mode | Configured mode |
| ---------- | ---------- | --------------- |
| Files CRUD, archive, autosave (silent, 500ms debounce) | localStorage registry + per-file JSON | `files` table upserts (RLS owner-only) |
| Sign-in / sign-out | — (no accounts; "Local mode" label) | Email OTP via `/login`; dashboard + editor redirect there when signed out; email + Sign out in the dashboard footer and editor top bar |
| Sample files | Seeded into localStorage on first run | Seeded as your rows on first login (only when you have zero files) |
| Image assets | dataURL inside the document (localStorage quota applies) | Upload to `assets/<userId>/<assetId>.<ext>`; the document stores the public URL. **Any upload failure falls back to a dataURL**, so intake never breaks |
| Share settings | Stored per file, unenforced | Stored per file, **still unenforced** — see below |

### Honest limits

- **Configured mode is NOT live-verified.** This integration was built
  and code-reviewed without a real Supabase project (no credentials
  were available): the build, lint, all 42 unit checks and the
  local-mode smoke test pass, but no query has ever run against a real
  project. Expect the setup steps above to be the first real test —
  the likely friction points are Auth URL configuration and the exact
  OTP email template settings, not the schema.
- **Share links are not enforced in either mode.** The settings
  (anyone/team × edit/view) persist with the file, but RLS is
  owner-only: a "shared" file is still visible only to its owner.
  Real link access needs a share-token design (a separate table +
  policies or an edge function) and is deliberately not faked here.
- **One user, one workspace.** There are no teams/organisations in the
  data model yet — `owner_id` is the only tenancy concept; the doc's
  `teamId` field is still a constant.
- **Assets are public URLs.** The `assets` bucket is public-read by
  design (unguessable ids); writes are restricted to your own folder.
  Signed-URL delivery is a later hardening step.

## What works in M1 — canvas core

- **Viewport.** Pan with the Pan tool (H), Space+drag, or middle-drag;
  plain wheel = vertical pan, Shift+wheel = horizontal, Ctrl/Cmd+wheel =
  zoom to cursor. Zoom clamps to 2%–25,600% (the Phase 3 range). The
  top-bar zoom dropdown works: ×2 / ÷2 steps, Zoom to 100% (Shift+0),
  Zoom to fit (Shift+1), Zoom to selection (Shift+2). A 1-canvas-px pixel
  grid appears at zoom ≥ 100%.
- **Selection.** Click selects; Shift+click toggles nodes in/out;
  marquee-drag from empty canvas selects the top-level nodes the box
  intersects; Ctrl+A selects all top-level nodes; Escape steps a single
  selection out to its parent frame, then clears. Multi-select draws one
  union outline plus per-node outlines.
- **Move / resize / nudge.** Drag moves the whole selection (children ride
  along inside their frame). Eight screen-space resize handles; the
  opposite edge stays fixed, min size 1px, Shift on a corner keeps the
  aspect ratio, and a live "W × H" pill tracks the drag. Arrow keys nudge
  1px, Shift+Arrow 8px (canvas units, zoom-independent).
- **Creation.** Rectangle (R) and Frame (F): drag out the rect (a plain
  click drops a default-size node). Starting the drag inside a frame makes
  the new node that frame's child, in parent-relative coordinates. Text
  (T): click places a 120×24 "Text" node. New nodes are named
  ("Rectangle 2", …), land on top of the stacking order and appear in the
  Layers panel, which is fully live (indentation, click/Shift+click).
- **Editing keys.** Delete/Backspace removes the selection including
  subtrees; Ctrl+D duplicates at 0 offset with fresh ids. Shortcuts only
  fire when the canvas has focus — never while typing in a field.
- **Inspector.** X/Y (parent-relative) and W/H are live inputs: type a
  value, Enter or blur commits. Multi-select shows "–".

## What works in M2 — styling, flex, tokens, text editing

Everything from M1, plus:

- **Full style model, rendered and editable.** Fills: solid (hex + alpha),
  gradients (Linear/Radial/Conic, angle, 2–4 stops) and token-bound.
  Outline (full perimeter) and Border (one side or all, spec default Top)
  are separate sections, as in the spec. Shadow and Inner shadow are lists
  (multiple allowed; new shadows start at the spec defaults 0/2/3/0 @ 20%).
  Filters: all 8 layer filters and the same 8 backdrop filters as sliders
  — only non-default values reach the CSS. Blend mode offers the 17 CSS
  modes; opacity is a slider + field; radius is a single field, a
  per-corner expansion, or a radius-token binding. Rotation is a numeric
  field (the renderer rotates the element).
- **Flex.** "Add flex" on a frame defaults to **column**, switches the
  frame's W/H to Fit, and seeds padding from the first child's old X/Y
  (spec details); "Remove flex" restores the pre-flex size. The flex panel
  has direction, Reverse, Wrap, ONE Gap field, Padding H/V and a 3×3
  alignment grid. Child sizing follows the spec, including the rule that
  **Fill does not share**: the first Fill child takes the remaining
  main-axis space, later Fill children collapse to 0 (`lib/flex.js`,
  unit-tested). A flex child gets disabled X/Y, an "Absolute position"
  checkbox that takes it out of flow, and no drag-move or resize handles.
  The sample document ships a flex row whose gap is bound to a token.
- **Tokens (Theme tab).** Create/edit/delete for all 11 types, grouped in
  fixed type order; a token holds a literal value or **aliases** another
  token of the same type (chains resolve). "Use starter theme" appends our
  own set (two 11-step colour ramps, radius/spacing/container scales, font
  sizes/weights/stacks, leading/tracking/opacity). Bindings: fill colour,
  gap, padding H/V, radius and W/H sizing (spacing/container tokens) show
  a chip; **detach restores the resolved literal**, and **deleting an
  in-use token silently auto-detaches every use** (spec behaviour,
  unit-tested). Editing a token value updates all bound nodes live.
- **Text editing.** Double-click a text node: an untransformed textarea
  overlays its screen rect (font scaled by zoom); Enter makes a newline,
  Escape or click-away commits. The Text inspector section sets size,
  line height, weight, letter spacing and alignment.

## What works in M3 — workflow (MVP complete)

Everything from M1 + M2, plus:

- **Undo/redo with coalescing.** Snapshot history (cap 100) in the store:
  every discrete mutation — inspector commits, token CRUD, flex changes,
  create/delete/duplicate, text-edit commits, page add/rename, comments —
  pushes the pre-mutation document; drag streams (move/resize) push ONE
  entry per gesture; nudges **coalesce**: repeated arrow-key nudges of the
  same selection within 1s merge into a single undo step (the behaviour
  Phase 3 §14 observed), and Inspector slider drags coalesce the same way.
  Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, plus Undo/Redo buttons in the top bar.
  Undo restores the document only (never the viewport); the selection is
  pruned to surviving nodes; loading a file resets history. The pure
  coalescing/cap logic is unit-tested (`lib/history.js`).
- **Persistence (API-shaped).** Files persist via `lib/persistence.js`
  behind a files-API-shaped surface — localStorage in local mode
  (`canvastool:files` registry + `canvastool:file:<id>` documents),
  the Supabase `files` table when a backend is connected (see
  [Backend & auth](#backend--auth-supabase)). The editor loads the
  routed file, and autosaves **silently** — doc changes debounce 500ms,
  there is NO save indicator anywhere (spec). The three sample files
  are seeded on first run. The top-bar title is an editable input
  (history-exempt).
- **Dashboard file management.** "New file" creates and opens a blank
  file; each card/row has a ••• menu with **Rename** (inline),
  **Duplicate**, **Archive**; the Archive view lists archived files with
  **Unarchive**. There is no Delete/Trash (spec: Archive only).
- **Share popover.** Link access (Anyone with the link / Team members
  only) × permission (Can edit / Can view), persisted per file in the
  registry; Copy link writes the URL to the clipboard with a toast, and
  falls back to a selectable URL field when the clipboard is blocked.
- **Comments (basic).** Comment tool (C): click the canvas to drop a
  numbered pin and compose; threads support replies; **Resolve** shows
  the bottom-centre toast with an **Undo** button (5s) that un-resolves.
  The top-bar Comments button (with an unresolved-count badge) opens the
  thread list with the spec's **Show resolved** toggle; clicking a thread
  pans the viewport to its pin. Pins hide resolved threads unless the
  toggle is on. Comments persist and are undoable like everything else.
- **Export + Copy-as.** The Inspector gains an Export section: rasterise
  the selected node at 1×/2×/3× as PNG/JPG/WebP (via `html-to-image`;
  JPG composites onto white) and download it as `name@2x.png`. Copy-as
  buttons generate **CSS** (including a `:root` block of the file's
  tokens as CSS variables; token-bound values emit `var(--…)`),
  **Tailwind** JSX (utility + arbitrary-value classes) and a **React**
  component (inline style objects) from the pure generators in
  `lib/codegen.js`; **Copy PNG** uses ClipboardItem where available and
  otherwise downloads the PNG with an explanatory toast.

## What works in M4 — depth

Everything from M1–M3, plus:

- **Pen / path tool (P).** Clicks on the canvas drop bézier anchors;
  click+drag on a fresh anchor pulls out a symmetric handle pair (the
  anchor becomes smooth). A live preview renders the in-progress path
  with a rubber segment to the cursor. Clicking the first anchor
  (within 6 screen px) closes the path; Enter or Escape finishes it
  open; finishing commits **one** history entry, selects the node and
  returns to the Move tool. The node enters the document on the first
  click, so Layers and persistence work throughout. Geometry lives in
  `lib/path.js` (unit-tested): anchors are node-local, and the node's
  position/size are always the anchors' bounding box (renormalised
  after every change). Paths render as an `<svg>` in the node box;
  `style.stroke` (width + paint, token-bindable) draws the curve —
  deliberately scaling with zoom — and the fill paints only when the
  path is closed (gradient fills degrade to their first stop colour).
- **Anchor editing.** Double-click a path to enter anchor mode: anchor
  dots (white squares, accent border) and, for the selected anchor, its
  handle dots and lines. Drag an anchor to move it (handles ride
  along); drag a handle to reshape — smooth anchors mirror the opposite
  handle's angle and length, corner anchors don't. **Alt+click** an
  anchor toggles smooth/corner: to corner keeps the handle positions
  and just unlinks mirroring; to smooth mirrors the existing handle, or
  creates handles along the neighbours' direction at ⅓ of the
  neighbour distance. Delete/Backspace removes the selected anchor
  (deleting the last one deletes the node). Escape exits the mode.
  Every anchor drag is one history entry. The Inspector's Path section
  sets stroke width + paint and toggles Close/Open path.
- **Images.** Documents carry `assets` (id → dataURL), persisted inside
  the document JSON like everything else. All three spec entry routes
  work: (a) the Fill kind gains **Image** — Choose File / Replace plus a
  fit select (Cover / Contain / Fill), painted as a background-image;
  (b) **Place image** — toolbar "Image" button or **Ctrl+Shift+K** —
  creates an image node at the viewport centre with its natural size
  capped at 800px on the long edge; (c) **paste** an image from the
  clipboard (anywhere except while typing in a field) places it at the
  centre with a small cascade offset. Intake (`lib/images.js`)
  downscales to a 1600px long edge before encoding (PNG stays PNG,
  everything else becomes JPEG q0.85).
  > ⚠️ **Asset storage warning (local mode).** Assets are dataURLs
  > inside the document, and documents live in localStorage, whose
  > quota is ~5 MB per origin in most browsers. A handful of large
  > photos can exhaust it (saves then fail silently at the storage
  > layer). The 1600px downscale mitigates this. In configured mode,
  > uploads go to Supabase Storage instead (with dataURL fallback) —
  > see [Backend & auth](#backend--auth-supabase).
- **Guides.** Frames carry guides, edited in the Inspector's Guides
  section: **Grid** guides (a column count; renders that many equal
  translucent columns — spec default colour at 12% opacity), and
  **Vertical / Horizontal** 1px lines at a frame-local position. Rows
  edit the count/position and remove; "+ Grid / + Vertical /
  + Horizontal" add (V/H start at the frame's midpoint). **Dragging
  guides on the canvas is NOT built** — panel fields only.
- **Snapping.** Move drags snap to the edges and centres of every other
  node plus all guide lines (grid guides contribute their inner column
  boundaries), within 5 screen px; the active lines render as
  full-viewport accent lines while dragging. Pure math in `lib/snap.js`
  (unit-tested). The Zoom menu's **Snap to objects** checkbox (default
  on) is the master switch. Resize drags do not snap (move only).
- **Hide-UI modes.** With the canvas focused: **`.`** toggles the full
  UI ↔ hidden (no top bar, sidebars or toolbar — canvas only, plus a
  floating filename pill at top-left and a floating vertical toolbar
  pill at left-centre, both fully functional); **Shift+`.`** toggles
  full ↔ collapsed (left sidebar hidden, right sidebar stays, top bar
  and toolbar become the same floating pills over a full-width canvas).
  Clicking the filename pill restores the full UI.
- **Artboard navigation.** **N** / **Shift+N** cycle the selection
  through the current page's top-level frames in layer order, centring
  the view on each (fit with 64px padding, zoom capped at 200%).
- The sample document now includes an open "Wave path" and a 4-column
  grid guide on the Card frame, so both render on first load.

## What works in M5 — shader layers (WebGL island)

- **Shader nodes.** A new layer type painted by a small WebGL1 program
  (`lib/shader.js` GLSL + `components/ShaderNode.jsx`). The effect is a
  mesh gradient: four colour anchors near the corners contribute via a
  gaussian falloff, the sample field is rotated, scaled, and warped by
  3-octave value-noise (fbm) so the colour regions melt together, and a
  hash-noise grain pass finishes it. The GLSL, the four preset names and
  all preset values are original to this project.
- **Create** with the toolbar's **Shader** button (after Pen): a
  480×360 node with the default preset appears at the viewport centre,
  selected, as one history entry. From then on the node behaves like
  any other — select, move, resize, layers, frames, persistence, undo.
- **Inspector → Shader.** A preset select (Aurora Veil, Ember Drift,
  Lagoon Haze, Graphite Bloom), four colour rows, and five parameters
  as slider + number field pairs: **Scale** (0.5–3), **Rotation**
  (0–360°), **Distortion** (0–100), **Softness** (0–100), **Grain**
  (0–100). Picking a preset replaces colours + params; any manual edit
  flips the preset to "Custom". Commits go through the normal
  patch/history path.
- **Resolution.** The canvas bitmap tracks the node's on-screen size
  (layout size × settled viewport zoom × devicePixelRatio ≤ 2), capped
  at 1024px on the long edge; zoom changes are debounced ~150ms so
  wheel gestures don't thrash GL.
- **WebGL fallback.** Where WebGL is unavailable the node renders a CSS
  composite of the same four colours (radial gradients at the same
  anchor positions) — never a blank hole.
- **Export / Copy-as.** PNG/JPG/WebP export should include the shader:
  the GL context is created with `preserveDrawingBuffer: true`
  precisely so html-to-image can capture the canvas bitmap (expected
  behaviour, not live-verified in this build). Copy-as CSS / Tailwind /
  React emit a documented approximation — the four colours as
  radial-gradient washes, flagged in the CSS output by a
  `/* shader layer approximated as gradients */` comment.
- **Honest limits.** One effect family (a static mesh gradient), not a
  shader library: no animation or time uniform, no per-anchor position
  editing, no custom GLSL. The parameters move the field, not the
  anchors. WebGL rendering is unit-tested at the data level
  (uniform packing, clamping, preset integrity, GLSL source shape —
  `scripts/shader-test.mjs`, 8 checks); the on-screen result itself is
  only verifiable in a browser.

## What works in M6 — multiplayer (presence + live cursors + doc sync)

- **One transport interface, two transports** (`lib/collab.js`, wired
  by `components/Collab.jsx`). When Supabase is configured AND a
  session exists, the room is a Supabase Realtime channel
  (`file:<id>`, presence keyed by identity, doc traffic over
  broadcast). Otherwise — including today's default local mode — the
  room is a **BroadcastChannel** (`canvastool:file:<id>`), so
  collaboration works **tab-to-tab in one browser with no backend at
  all**: open the same file in two tabs and edit together. With
  neither available, collab is silently off ("Solo").
- **Presence.** Each peer publishes { identity, current page, cursor
  (canvas coords), selection }. Supabase uses its presence primitive;
  BroadcastChannel has none, so the local transport heartbeats every
  2 s, expires peers after 5 s of silence, and posts an explicit leave
  on unload. Publishing is change-driven: cursor updates are throttled
  to 50 ms and only sent on real movement.
- **Identity is per TAB, name is per BROWSER.** The id lives in
  sessionStorage ("canvastool:tab-id") — two tabs of one browser are
  two peers, with two colours. The display name persists in
  localStorage ("canvastool:guest-name", generated as Guest-XXXX) and
  is editable from the avatar popover; in configured mode the name is
  the account email's prefix. Colours come from an 8-colour palette by
  hashing the id (collab teal #12A594 included), so all clients agree.
- **Live cursors + remote selections.** Peers on your page render in
  the canvas overlay: a coloured arrow pointer with a name flag, and
  their selected nodes outlined dashed in their colour with a name
  tag. The top bar shows an avatar stack (max 5 + overflow), a status
  dot (green live / amber connecting / grey solo) and, on click, a
  room list with everyone's current page.
- **Doc sync is whole-doc last-writer-wins — deliberately.** Local doc
  changes broadcast (throttled, one per 150 ms, trailing) with a
  per-sender increasing seq; receivers ignore stale/duplicate/own seqs
  and apply via a dedicated store path that creates NO history entry,
  clears the redo stack, prunes selection, and tags the change
  "remote" so it is never echoed back (the autosave still persists
  it). Two people editing the same file at the same moment will
  overwrite each other — there is no merge. **Yjs/CRDT over the op
  stream is the production path**; LWW is the honest MVP-grade step
  that makes presence/cursors real today.
- **Not in M6.** Share-link enforcement is still future work (rooms
  are still gated by file access — owner-only RLS remotely; locally,
  anyone with the browser). Cursor chat (the `/` key from the spec)
  arrived later, in the depth-gaps batch below.
- **Verification status.** The pure helpers are unit-tested
  (`scripts/collab-test.mjs`, 8 checks: palette determinism, presence
  reduce/prune boundaries, cursor throttle, seq guard). The
  **BroadcastChannel transport is the live-testable one** — try it in
  two tabs. The **Supabase transport is code-reviewed only** until a
  real Supabase project is connected (same status as the rest of the
  configured mode); likely friction points are Realtime authorisation
  settings on the project.

## What works in M7 — version history

- **Model.** A version is `{ id, name, auto, createdAt, authorName,
  snapshot }` where `snapshot` is a deep copy of the whole document.
  Versions live **beside the document, never inside it** — a snapshot
  containing the versions array would nest versions inside versions.
  Storage per backend: locally, the file's localStorage record is now
  `{ doc, versions }` (pre-M7 records stored the bare doc and still
  read fine — they migrate on the next save); in Supabase mode, the
  `files` row has a dedicated **`versions` jsonb column**.
  Duplicating a file on the dashboard copies its history too.
- **Manual versions.** The top-bar History button (clock-rotate icon,
  with a count badge) opens the panel: "Save current version" takes
  an optional name (blank → "Unnamed version"). Rows show the title,
  relative time (absolute on hover), author, and page/node counts.
- **Automatic versions.** While you edit, an autosave version is taken
  whenever the newest version is at least **15 minutes** old (the
  first edit of a file with no versions establishes the baseline). It
  rides the same doc-change subscription as the silent autosave, is
  skipped for remotely-applied docs, and — being file-level state —
  never creates a doc change, an undo step, or a collab broadcast.
- **Cap + prune order.** At most **30 versions** per file. Over the
  cap, the oldest **auto** versions are dropped first; named versions
  are dropped last (only when no autos remain, oldest overall go).
- **Preview is read-only.** Previewing renders the snapshot on the
  canvas under a banner ("Previewing version '…' · <date>") with
  [Restore this version] and [Back to current]. Editing is off at
  every level: canvas gestures (pan/zoom still work), keyboard
  shortcuts (Escape exits), the sidebars/toolbar/inspector go inert,
  the file title and undo/redo disable, comment pins and remote-peer
  overlays hide.
- **Restore semantics.** Restoring (1) appends a safety auto version
  of the current document titled **"Before restore"**, then (2)
  applies the snapshot as a **normal history commit** — the restore
  is itself undoable with Ctrl+Z (toast: "Restored version '…' — Undo
  to revert") and broadcasts to collaborators as an ordinary local
  edit. It deliberately does not use the no-history remote-apply path.
- **Rename / delete.** Manual versions rename inline in the panel;
  delete asks for an inline confirmation (no modal). Deleting the
  version you're previewing exits the preview.
- **Quota note (honest limit).** Every version is a full document
  copy, so versions multiply storage: ~30 versions ≈ 30× the file
  size. In local mode, documents carry images as dataURLs, so a
  photo-heavy file can approach the ~5 MB localStorage quota with far
  fewer than 30 versions — when the quota is hit, saves fail to the
  console like other autosave failures. Supabase mode has no such
  practical limit (jsonb in Postgres), but the same multiplication
  applies to row size.
- **Supabase migration note.** Fresh projects get the `versions`
  column from `supabase/schema.sql` directly. **Existing projects**
  (created before M7) add it by re-running the schema file — it
  includes an idempotent
  `alter table public.files add column if not exists versions jsonb not null default '[]'::jsonb;`
  Existing rows get an empty history; nothing else changes.
- **Verification status.** The pure helpers are unit-tested
  (`scripts/versions-test.mjs`, 6 checks: snapshot deep-copy isolation
  + no nesting, prune order and cap, the 15-minute boundary at exactly
  the interval and 1 ms under, summaries, title fallbacks). The
  Supabase column path is code-reviewed only, like the rest of
  configured mode; local mode is fully live-testable.

## What works — depth gaps batch (post-M7)

Four gaps that earlier milestones deliberately left open, now closed:

- **Flex drag-reorder (canvas + Layers).** Dragging a sole-selected
  in-flow flex child on the canvas is a reorder drag: a translucent
  ghost follows the pointer, a 2px selection-blue insertion line
  spans the parent's cross axis at the target slot, and the drop
  reorders the children array as ONE history entry (dropping back
  onto the original slot commits nothing; Esc cancels;
  absolutely-positioned children keep the normal move drag). The
  slot comes from `insertionIndex` in `lib/flex.js` — the count of
  the other siblings whose main-axis midpoint is before the pointer —
  computed over measured rects in VISUAL order, which is what makes
  `reverse` work; **wrapped rows use the main-axis projection only**
  (documented simplification: the row a sibling sits in is ignored).
  Layers rows drag the same way within their parent (pointer drag
  past a 4px threshold, accent drop line, one commit via
  `store.reorderChild`): flow order for flex children, z-order for
  freeform children and page roots. Cross-parent drags are not
  supported — the slot is computed over same-parent rows only, so a
  drop anywhere else simply lands within the dragged row's own
  parent.
- **Guide canvas-dragging.** A frame's line guides (v/h; the grid
  guide stays panel-only) have a 6-screen-px hit strip on the canvas
  that wins over node drags and the marquee. Hovering shows the
  resize cursor (ew/ns) and a highlight; dragging updates the
  position live through TRANSIENT store state (`store.guideDrag` —
  the doc does not change mid-drag), and releasing commits ONE
  history entry through `patchNode`, the same path the Guides panel
  uses. Double-clicking a guide deletes it (one commit); Esc
  mid-drag cancels. Positions clamp to the frame's box.
- **OKLCH colour editor.** The Inspector's colour rows gained a
  Hex / RGB / HSL / OKLCH mode switch backed by `lib/color.js`
  (import-free conversions: sRGB → linear → OKLab → OKLCH with
  Björn Ottosson's matrices, and back). OKLCH mode edits L (0–1,
  3 decimals), C (0–0.40) and H (0–360) and shows the current
  `oklch(…)` string; out-of-gamut values clamp in linear sRGB, so
  they always land on a valid hex. **The document model is
  unchanged** — colours are still stored as hex + a separate alpha;
  the modes are a conversion view over the stored value (stored
  `oklch()` literals, e.g. from tokens, decompose too).
- **Cursor chat (`/`).** Pressing `/` with the canvas focused opens
  a small composer anchored at your cursor (viewport centre if the
  pointer hasn't been over the canvas). Enter broadcasts
  `{ kind: "cursor-chat" }` over the active collab transport AND
  raises the text as an ephemeral `chat` field in your presence, so
  peers see a white bubble at your cursor for 4 s either way;
  receivers merge both sources and the render pass prunes bubbles on
  expiry. Text is sanitised (newlines stripped, max 140 chars).
  Esc cancels; with no live session (`Solo`), `/` shows a toast
  explaining that cursor chat needs one — open the file in a second
  tab. Nothing about chat is persisted.

## Platform batch — MCP agent API

An AI agent can read and edit canvas-tool documents through a **Model
Context Protocol server** (`mcp/server.mjs`): a hand-rolled, zero-
dependency implementation of MCP over stdio (newline-delimited
JSON-RPC 2.0 — `initialize` / `ping` / `tools/list` / `tools/call`,
protocol version 2024-11-05). No npm packages, nothing to install;
any MCP client spawns it with `node`. Full setup, client config and
tool reference: **[mcp/README.md](mcp/README.md)**.

The server edits the tool's own document format as JSON files in a
workspace directory (`CANVAS_TOOL_DIR`, or `./canvastool-files`):
one `<fileId>.json` per file, each the full doc JSON. Seven tools:
`list_files`, `read_file`, `create_file`, `list_nodes`, `add_node`
(partial node spec through a factory mirroring the app's own —
frames are the only containers, x/y are canvas coords stored
parent-relative, `fill` is hex), `update_node` (shallow patch of
known keys) and `delete_node` (with descendants). Writes are atomic
(tmp + rename); tool failures return `isError` results, never a
crash; malformed protocol lines are ignored.

**The bridge is the dashboard**: each file's ••• menu has **Export
JSON** (download the doc JSON an agent can read) and the header has
**Import JSON** (a validated doc JSON — `lib/model.js` `isValidDoc` /
`normalizeDoc` — becomes a NEW file; imports never overwrite). So
the round trip today is: export → agent edits the file → import.

**Honest limit:** this is a file bridge, not live in-app editing.
Paper-style agents manipulating the document in your open editor
need the hosted backend in the loop. With Supabase configured, the
same seven tools can later be pointed at the `files` table (the
row's `doc` jsonb) and M6 sync would carry agent edits into open
editors — documented in mcp/README.md; not built. End-to-end test:
`scripts/mcp-test.mjs` spawns the real server against a temp dir and
drives the whole round trip (24 checks).

## Platform batch — AI Create image / SVG (procedural)

The toolbar's **Create SVG** and **Create image** buttons open a
prompt panel (prompt + size select + live palette preview). Both are
powered by `lib/ai.js`, an original **procedural composition
engine**: an FNV-1a hash of the prompt seeds a mulberry32 PRNG,
keywords route the prompt to a palette (sunset / ocean / forest /
desert / night / city / flower + default) and a motif family
(mountain ridges with a sun/moon disc, ocean waves, flower petals,
geometric grid, soft blobs, plus a gradient-sky fallback for empty
prompts). Generation is **deterministic** — same prompt + size →
byte-identical SVG — and runs **entirely in the browser**.

- **Create SVG** inserts the generated SVG as an image node
  (`data:image/svg+xml;utf8` asset) at the page centre, one history
  commit, named from the prompt.
- **Create image** renders the SAME composition to a raster PNG
  in-browser (SVG → Image via blob URL → canvas, downscale-capped at
  1600px like M4 image intake) and inserts it the same way; if
  rasterisation is unavailable it falls back to inserting the SVG.
  The motif logic exists in exactly one place — the SVG generator.

**Honest labelling, on purpose:** the panel itself says "Procedural
generation — runs locally, no external AI model." No prompt leaves
the machine; there is no AI model behind these buttons today. The
future provider hook is documentation-only: a deployment would set
an `AI_IMAGE_API_URL` environment variable and the panel would POST
`{ prompt, width, height }` to it and insert the returned image URL
as the asset instead — that network call is deliberately NOT
implemented. On the Free plan, generations are capped per day (see
Plans); the panel shows the remaining count and, at the cap, the
upgrade prompt. Tests: `scripts/ai-test.mjs` (46 checks — hash/PRNG
determinism, all palette routings, SVG determinism / structure /
size).

## Platform batch — Plans & billing UI (demo)

`lib/plans.js` defines this product's own two plans — **Free**
($0; 5 files, 10 versions per file, 5 AI generations/day) and
**Pro** ($15/mo monthly, or $12/mo billed yearly; unlimited files
and AI generations, 30 versions per file) — plus the pure helpers
`planOf` (unknown ids fall back to Free), `effectiveVersionCap` and
`withinLimit`. The current plan is **local demo state**: a
localStorage value (`canvastool:plan`) in both modes, restored on
load by the dashboard and the editor store.

Where the limits actually bite (soft, visible enforcement):

- **Dashboard "New file"** at the Free file cap → toast + the
  Upgrade dialog opens instead of creating a file.
- **Version history** pruning uses `effectiveVersionCap(planId)` —
  the store passes it to `pruneVersions` at all three call-sites,
  so Free keeps 10 versions and Pro keeps 30 (the M7 default).
- **AI Create** counts generations per day (`canvastool:ai-usage`);
  at the Free cap the panel shows the upgrade prompt instead of
  generating.

The **Upgrade dialog** (account chip in the editor top bar, plan
badge in the dashboard sidebar, and the limit prompts) shows the
Free vs Pro comparison, a monthly/yearly toggle, and a checkout
form — which is a **demo**: it is labelled in the dialog itself,
permanently, with "Demo checkout — no payment is taken", its fields
are sent nowhere, and submitting it only flips the local plan id.
On Pro, the dialog's Manage plan flow downgrades back to Free with
an inline confirm. **Never mistake this for working billing:** a
production deployment must derive entitlement from the payment
provider's server-side webhooks, never from client-stored state —
the client value here is a UI hint, and `lib/plans.js` says so in
its header. Tests: `scripts/plans-test.mjs` (24 checks).

## MVP checklist (Phase 5 §7 in-scope → status)

| §7 item | Status |
| ------- | ------ |
| Dashboard | ✅ built (M3 file management) |
| Auth | ✅ built — Supabase Auth email-OTP, env-gated (configured mode is code-reviewed, not live-verified; local mode needs none) |
| Files: create / rename / duplicate / archive | ✅ local registry |
| Editor shell to Phase 2 metrics | ✅ |
| Pages: add / rename / switch | ✅ (switch M0, add/rename M3) |
| Tools: Move, Pan, Frame, Rectangle, Text | ✅ (Pen arrived post-MVP in M4) |
| Freeform + spec flex model | ✅ |
| Full style stack (fills, outline vs border, shadows, 16 filters, blend, radius, opacity) | ✅ |
| Tokens: all 11 types, starter theme, bind/detach, aliases | ✅ |
| Inspector for the core selection states | ✅ |
| Zoom / pan / nudge / shortcuts per Phase 3 | ✅ — including `.` hide-UI (built in M4) |
| Undo/redo with coalescing | ✅ (M3) |
| Autosave (debounced) | ✅ local stand-in for the server op batch |
| Share by link (view/edit) | ✅ settings + link copy; enforcement needs auth |
| PNG export (1×/2×) + Copy-as CSS/Tailwind | ✅ (+3×, JPG/WebP, React, Copy PNG) |
| Comments (basic threads + resolve) | ✅ |

## What is stubbed in the MVP build

- **Backend integration built; configured mode unverified.** The
  Supabase backend + auth are fully wired (see
  [Backend & auth](#backend--auth-supabase)) but no real project has
  been connected yet, so that mode is code-reviewed only. Without env
  vars the app is local-only, and in BOTH modes the share settings are
  stored but nothing enforces them — RLS is owner-only, so there is no
  working link sharing yet.
- **Comments are basic.** Single author ("You"), no @mentions, no
  reactions, no per-node anchoring UI (pins are page points). They do
  travel with the doc, so M6 doc sync carries them between peers.
- **Colours are hex + alpha in the model.** OKLCH values (e.g. from the
  sample's brand token) resolve and render, and detach to literal strings.
  The colour picker now edits Hex / RGB / HSL / OKLCH (the depth-gaps
  batch, `lib/color.js`), but the STORED value is still hex + alpha —
  OKLCH is a conversion view, so a colour picked in OKLCH mode is stored
  as its (possibly gamut-clamped) hex equivalent.
- **Flex simplifications.** Fill inside a Fit-sized flex frame sizes to
  content rather than a computed remainder (there is no remainder in a
  fit box); "Wrap in flex" for multi-selections is not built. Flex
  drag-reorder IS built (depth-gaps batch) on canvas and in Layers, with
  wrapped rows resolved by main-axis projection only. The selection
  overlay measures the rendered DOM, so flex children outline correctly,
  but the geometry module's own estimates still ignore rotation.
- **Export notes.** Raster export captures the node's own subtree
  (backdrop filters over content *behind* the node can't be captured);
  rotated nodes export unrotated (the capture resets the root transform);
  JPG/WebP go through canvas encoding, so WebP depends on the browser.
  Copy PNG depends on ClipboardItem support and falls back to a download.
- **M4 simplifications.** Guides were edited by Inspector fields only;
  since the depth-gaps batch, line guides also drag on the canvas and
  delete on double-click (the grid guide is still panel-only). Snapping
  applies to move drags only (not resize, not pen drawing). Path fills
  accept the full paint model, but gradient fills on a path render as
  their first stop's colour (SVG paint servers are not wired). Image
  assets are dataURLs in localStorage — see the quota warning in the M4
  section.
- **MCP is a file bridge, not live editing.** The agent API edits
  document JSON files on disk; changes reach the app only through a
  manual Export/Import JSON round trip on the dashboard (see the
  MCP platform section). Pointing the tools at the Supabase `files`
  table is designed-for but not built.
- **AI Create is procedural, not AI.** Generation is a seeded local
  composition engine (palettes + motifs routed by prompt keywords);
  no model is called and no prompt leaves the browser. The UI labels
  it as such. A real provider behind an `AI_IMAGE_API_URL` env var
  is documented as the future hook and deliberately not implemented.
- **Billing is a demo.** Plan state is a localStorage value the
  client asserts about itself; the checkout form sends nothing and
  takes no payment, and the dialog says so in plain text. Real
  entitlement must come from a payment provider's server-side
  webhooks — until then the plan limits are UI-level nudges, not
  enforceable caps (anyone can flip the local value).
- No rotation handles; dashboard search is visual only; file URLs are
  plain `/file/<id>` (no page/selection segments).

## Roadmap (from Phase 5 §8)

| Milestone | Contents |
| --------- | -------- |
| **M0 — Skeleton** | Next.js app, dashboard, editor shell with Phase 2 chrome + tokens |
| **M1 — Canvas core** | Viewport (pan/zoom), DOM renderer depth, Frame/Rect/Text tools, selection/move/resize/nudge, layers, pages |
| **M2 — Styling & flex** | Full inspector, colour system (hex+alpha; OKLCH deferred), effects stack, flex model, tokens end-to-end, text editing |
| **M3 — Workflow — MVP complete** | Undo/redo with coalescing, local persistence + file management, share links/roles (local), comments, PNG export, Copy-as code |
| **M4 — Depth** | Pen/path tool with anchor editing, image fills + Place image + paste (in-document dataURL assets), frame guides, drag snapping, hide-UI modes, artboard navigation |
| **Backend (this)** | Supabase integration: env-gated auth (email OTP), files table + owner-only RLS, storage bucket for image assets, dual-backend async persistence; local mode unchanged |
| M5 | Shader layers (WebGL island): one original mesh-gradient effect, 4 presets, 5 params, CSS fallback, gradient-approximation codegen ✅ |
| **M6 — Multiplayer** | Presence + live cursors + remote selections + whole-doc LWW sync over a transport abstraction: Supabase Realtime when configured, BroadcastChannel tab-to-tab locally ✅ |
| **M7 — Version history** | Named + 15-minute auto snapshots stored beside the doc (cap 30, autos prune first), History panel, read-only preview, restore with safety version + undoable commit ✅ |
| **Depth gaps (post-M7)** | Flex drag-reorder (canvas + Layers), guide canvas-dragging, OKLCH colour editor, cursor chat (`/`) ✅ |
| **Platform batch** | MCP agent API (zero-dependency stdio server, 7 tools, JSON file bridge via dashboard Export/Import JSON) ✅; AI Create image/SVG (procedural, deterministic, honestly labelled — no AI model) ✅; Plans/billing UI (own pricing, soft limit enforcement, DEMO checkout — no real payment) ✅ |
| M8+ (not built) | Multiplayer merge (Yjs/CRDT); share-link enforcement (share tokens); MCP tools pointed at the Supabase `files` table for live agent editing; a real AI image provider behind `AI_IMAGE_API_URL`; real billing (provider webhooks → server-side entitlement) |

**Everything in the Phase 5 plan (M0–M7 + depth gaps + platform
batch) is now built.** What remains is verification and production
hardening, not planned features:

- **Configured-mode live verification** — connect a real Supabase
  project (setup under "Backend & auth") and exercise auth, the
  files table, Storage uploads and Realtime sync end to end; that
  mode is code-reviewed only today.
- **Production hardening** — real payment-provider integration with
  server-side entitlement (replacing the demo plan state), share-link
  enforcement (share tokens + RLS policies beyond owner-only), a
  CRDT (Yjs) merge for multiplayer instead of whole-doc
  last-writer-wins, an `AI_IMAGE_API_URL` provider for real AI
  generation, rate limiting / abuse controls on any hosted surface,
  and backups/migrations for the files table.

## Open decisions

- **Product name** — needed before any branding work; "canvas-tool" is a placeholder.
- **TypeScript later?** — the plan recommends TS for the document/layout engine; the build follows the standing JSX preference, with JSDoc types in `lib/model.js` as the bridge.
- **Backend** — DECIDED: Supabase (auth + Postgres + Storage). The
  integration is built and env-gated; what remains is connecting a real
  project (setup in [Backend & auth](#backend--auth-supabase)) and
  verifying configured mode live.
- **Multiplayer timing** — planned for after MVP; pulling it earlier changes the sync design from day one.
