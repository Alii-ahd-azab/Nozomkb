# Nozom Knowledge Bank

## Goal

Build an internal knowledge platform where Nozom employees can find trusted company information, share useful experience, and later ask an AI assistant questions based on available company knowledge.

## Users

- Member: reads knowledge and contributes personal posts.
- Editor: manages and publishes official company content.
- Admin: manages access and broader platform settings.

## Initial Scope

For the first version, the platform will focus on:
- Company information and policies
- Employee posts and shared knowledge
- Search
- Basic content organization
- Later, AI-powered answers with sources

## User Stories

1. As a Member, I want to search for the procedure for requesting paid sick leave, so that I can quickly understand what I need to do when I am sick.

2. As a Member, I want to find the procedure for submitting a deliverable to my team leader, so that I can submit my work correctly before the deadline.

3. As a Member, I want to make a post about a useful trick I learned in accounting, so that my colleagues can benefit from it.

4. As an Editor, I want to update the Notice Period Policy from 3 weeks to 2 weeks, so that employees see the latest approved company policy.

5. As an Admin, I want to remove inappropriate comments, so that discussions remain professional and relevant.

6. As an Admin, I want to revoke a user's access when they leave the company, so that former employees can no longer access internal knowledge.

## Day 1 Status

Completed:
- Development environment prepared
- Next.js application created
- TypeScript and ESLint configured
- Local development server tested
- Initial About page created
- Basic responsive styling added
- Project goal, users, scope, and User Stories documented

Not implemented yet:
- Persistent data
- Authentication
- Search functionality
- Posts functionality
- Database
- AI Chat



## Day 2 Status

Completed:
- Reviewed and modified the existing About page
- Practiced basic HTML/JSX structure
- Practiced CSS styling and layout
- Used CSS variables for the Nozom color theme
- Worked with Variables and Objects in the current page
- Improved spacing, typography, responsiveness, and visual hierarchy
- Added responsive behavior for smaller screens

Day 2 output:
- About page is readable and presentable
- Page structure and styling can be explained
- Basic HTML, CSS, Variables, and Objects are understood in context



## Day 3 Status

Completed:
- Created a reusable `PostCard` component
- Created a Feed using 5 sample Posts
- Added a `Post` Type
- Created an Array of Post objects
- Used `map()` to render PostCards from the Posts array
- Passed Post data into components using Props
- Added Post tags to each card
- Added a reusable Feed section
- Added a post count function
- Practiced tracing data from the Posts array to the rendered UI

Day 3 output:
- Feed displays 5 sample Posts
- Post data can be traced from the Array to the PostCard component
- Components, Props, Types, Arrays, Objects, and `map()` can be explained



## Day 4 Status

Completed:
- Created a reusable Layout component
- Created a separate Knowledge Feed page at `/feed`
- Moved shared Post data into `data/posts.ts`
- Created dynamic Post Details routes using `/posts/[id]`
- Connected each PostCard to its corresponding details page
- Added handling for invalid Post IDs
- Added navigation between About, Knowledge Feed, and Post Details
- Added a reusable Toolbar component
- Added Nozom branding and logo to the toolbar
- Made the Nozom logo and brand link back to the About page
- Added responsive toolbar behavior
- Added a Back to Top button
- Verified all 5 sample Posts open the correct detail pages

Day 4 output:
- Navigation works
- Sample content is clear
- Each Post opens its correct details page
- Layout and Components are organized



## Day 5 Status

Completed:
- Tested navigation between About, Feed, and Post Details
- Tested all 5 Post Details routes
- Tested invalid Post IDs
- Tested the interface on mobile
- Tested empty content behavior
- Used browser DevTools during debugging
- Diagnosed and fixed sticky toolbar jump behavior

Debugging example:
- Problem: the sticky toolbar behaved inconsistently when shrinking and expanding
- Cause: the toolbar height changed during scrolling and affected layout/scroll behavior
- Fix: added a fixed-height sticky wrapper around the toolbar
- Result: the toolbar keeps its animations without causing layout jumps

Day 5 output:
- Main navigation paths were tested
- Mobile layout was checked
- One real UI bug was diagnosed and fixed



## Day 6 Status

Completed:
- Reviewed the project file structure
- Confirmed the application runs locally
- Reviewed navigation and dynamic Post routes
- Prepared a Data Flow explanation
- Prepared a small data modification for demonstration
- Reviewed the main Components and shared data structure
- Prepared for a short Week 1 demo

Day 6 output:
- Code runs locally
- Run steps are understood
- Data Flow can be explained
- Navigation can be explained
- A small modification can be made and its effect explained



## Week 2 Status

Completed:

- Added React State using `useState`
- Added interactive Add Post form
- Added form validation for empty Title, Content, and Tag
- Added predefined Tag dropdown
- Added Tag filtering
- Added title search
- Added Clear Filters button
- Added No Results empty state
- Added collapsible Add New Post / Hide Form behavior
- Added responsive styling for the new controls and form
- Kept newly added Posts in temporary React State

Temporary storage behavior:

- New Posts added through the form are stored only in React State
- They remain available while the current page session is active
- They disappear after page refresh because they are not yet stored in the database

Key concepts practiced:

- State
- `useState`
- Events
- Forms
- Validation
- Conditional rendering
- Filtering
- Search
- Temporary UI state




## Week 3 Status

Completed:

- Designed the PostgreSQL database schema
- Created tables for:
  - Departments
  - Users
  - Pages
  - Posts
  - Tags
  - Post Tags
- Added Primary Key and Foreign Key relationships
- Added many-to-many relationship between Posts and Tags
- Created database migration files
- Created Seed data
- Practiced SQL:
  - `SELECT`
  - `INSERT`
  - `UPDATE`
  - `JOIN`
- Connected Next.js to PostgreSQL using `pg`
- Added database connection using `DATABASE_URL`
- Split the Feed into Server and Client Components
- Added `getPosts()` to load Posts from PostgreSQL
- Added `getPostById()` to load individual Post details from PostgreSQL
- Moved the project from Supabase PostgreSQL to local PostgreSQL
- Verified Posts, Users, Pages, Tags, and relationships in pgAdmin
- Added a second migration for `is_published`
- Verified database-backed Posts remain after refresh

Current architecture:

- PostgreSQL stores permanent data
- Server Components read data from PostgreSQL
- Client Components handle State and user interaction
- Add Post form still uses temporary React State for now

Key concepts practiced:

- Database Schema
- Tables
- Primary Keys
- Foreign Keys
- One-to-many relationships
- Many-to-many relationships
- Migrations
- Seed data
- SQL queries
- Environment Variables
- PostgreSQL connection Pool
- Server Components
- Client Components
- Database data vs React State



## Week 4 Status

Completed:

- Added CRUD operations for Posts
- Added API Route Handlers using Next.js
- Added `GET /api/posts`
- Added `POST /api/posts`
- Added `PATCH /api/posts/[id]`
- Added `DELETE /api/posts/[id]`
- Connected Add Post form to PostgreSQL through the API
- Added server-side validation
- Added Edit Post functionality
- Added Delete Post functionality with confirmation
- Added loading, error, and empty states
- Added loading states for Create, Update, and Delete actions
- Added HTTP status handling:
  - `201 Created`
  - `400 Bad Request`
  - `404 Not Found`
- Verified API requests using the browser Network tab
- Verified server requests using terminal logs
- Verified Post deletion also removes related `post_tags` rows
- Added validation for unchanged edits
- Cleared validation errors when leaving Edit mode

Current CRUD flow:

- Create → Add Post form → `POST /api/posts` → PostgreSQL
- Read → Server Component → PostgreSQL
- Update → Edit form → `PATCH /api/posts/[id]` → PostgreSQL
- Delete → Delete button → `DELETE /api/posts/[id]` → PostgreSQL

Key concepts practiced:

- CRUD
- API
- Route Handlers
- HTTP Methods
- Requests and Responses
- JSON
- HTTP Status Codes
- Server-side Validation
- Loading States
- Error States
- Empty States
- API Debugging
- Database-backed UI


## Week 5 Status

Completed:

- Added Auth.js authentication using Credentials
- Added bcrypt password verification
- Added login and logout
- Added authenticated sessions
- Added Admin / Editor / Member roles
- Added server-side RBAC
- Added Post ownership checks
- Removed hard-coded `userId` from Post creation
- Added company-wide and department-restricted content scopes
- Added Draft / Published / Archived lifecycle
- Added Official Pages vs Community Posts
- Added server-side authorization for direct URLs and API requests
- Added role / ownership / department authorization helpers (`lib/authz.ts`)
- Added protected Official Page functionality
- Added test users for Admin, Editor and Members
- Added Week 5 acceptance test script (`npm run test:week5`)
- Verified secrets stay server-side
- Verified all required Week 5 scenarios pass

Current authentication flow:

- Login → Auth.js → PostgreSQL user lookup → bcrypt password verification → session → authenticated requests

Current authorization flow:

- Request → Authentication → Current User → Role → Ownership → Department Scope → Lifecycle → Allow / Deny → PostgreSQL

Notes:

- Database: local PostgreSQL accessed through `pg` and managed with pgAdmin
- PostgreSQL RLS is not used for application authorization
- Authorization is enforced in the Next.js server layer
- No public signup exists; accounts are provisioned internally
- Local setup: migrations `001`–`004` + `database/seed.sql` (see `.env.example` for required variables)
- Comments, Files, Bookmarks and advanced Search belong to Week 6

Key concepts practiced:

- Authentication
- Authorization
- Sessions
- Credentials
- Password hashing
- RBAC
- Ownership
- Content Scope
- Server-side authorization
- Environment Variables / Secrets
- Content lifecycle
- Official vs Community content
- 401 / 403 / 404 authorization behavior



## Week 6 Status

Completed:

- Added Comments on Community Posts and Official Pages (author edits/deletes own; Admin moderates)
- Finished Tags (tag options loaded from the database; Tag filter in Search)
- Added private Bookmarks with a `/bookmarks` page (duplicates prevented, access re-checked)
- Added a simple employee Profile (`/profile`); only specialty is editable
- Added private PDF/TXT uploads stored in `storage/private/` (outside `public/`)
- Added server-side file validation: extension + MIME allowlist, real size ≤ 10 MB, PDF signature, binary TXT check
- Added private downloads through an authorized route (files inherit the parent's access)
- Added keyword Search (`/search`) across Official Pages, Community Posts and Comments
- Added Type / Department / Tag filters and server-side pagination (20 per page)
- Added lifecycle-aware Search: only published content the user may read
- Added empty states and Arabic error messages for Week 6 features
- Added Integration tests (`npm run test:week6`) and a Playwright E2E test (`npm run test:e2e`)

Current Week 6 flow:

- Login → Post → Comment → Bookmark → File Upload → Search → Result

File flow:

- Upload → server validation → private storage → database metadata → authorized download route

Search flow:

- Query → authentication → permission/lifecycle filtering → keyword matching → filters → pagination → results

Notes:

- Comments, Files and Bookmarks have no scope/status of their own: access = parent Post/Page access (`lib/authz.ts`)
- Local setup: migration `005` + `database/seed.sql` (existing databases: `database/dev/week6_upgrade_existing_local_data.sql`)
- File processing, Chunking, Workers and Semantic Search belong to Weeks 7–8

Key concepts practiced:

- File Upload Validation
- Private Storage
- Pagination
- Keyword Search
- Integration Testing
- E2E Testing
- Content Lifecycle



## Week 7 Status

Completed:

- Added a separate TypeScript Worker (`worker/`, `npm run worker`) that runs outside `next dev`
- Added a BullMQ / Redis Queue (`nozom-file-processing`, key prefix `nozomkb`) carrying only `{ fileId, version }`
- Moved processing out of the HTTP request: upload only saves the File and queues a Job
- Added text extraction: TXT (UTF-8, windows-1256 fallback) and PDF page by page (`unpdf`, no OCR)
- Added deterministic Chunking (~1200 characters, 150 overlap, never across PDF pages)
- Stored Chunks with source metadata: File (`file_id`), page, version and position (`chunk_index`)
- Added processing statuses Pending / Processing / Ready / Failed with safe Arabic error messages
- Added automatic retries (3 attempts, exponential backoff) and a manual Retry for Failed Files
- Made processing idempotent: one transaction replaces a version's Chunks + `UNIQUE (file_id, version, chunk_index)`
- Added File replacement with versions (old Chunks stop being searchable immediately)
- Added Disable / Enable for Files (withdrawn Files leave Search and are hidden from readers)
- Extended keyword Search to permitted, current, Ready File Chunks (result shows file, parent and page)
- Added integration tests with real Redis + real Worker (`npm run test:week7`)

Data flow:

- Upload → Private Storage → PostgreSQL metadata → BullMQ → Redis → Worker → Extract → Chunk → PostgreSQL

Processing:

- Pending → Processing → Ready
- Processing → error → automatic retry → Ready, or → Failed → manual Retry

Local development:

- Terminal 1: Redis 6.2+ on `127.0.0.1:6379` (set `REDIS_URL` otherwise)
- Terminal 2: `npm run dev`
- Terminal 3: `npm run worker:dev`
- Database: migration `006_add_file_processing_and_chunks.sql`

Notes:

- PostgreSQL keeps the permanent data; Redis only holds Job/Queue state
- Chunk access always comes from the parent Post/Page (published + readable), like Comments
- Empty, scanned (image-only) and unreadable PDFs fail visibly as not indexable; OCR is out of scope
- Embeddings and Semantic Search belong to Week 8

Key concepts practiced:

- Worker
- Queue
- Job
- Redis
- BullMQ
- Extraction
- Chunking
- Metadata
- Versions
- Retries
- Idempotency
- HTTP request limits



## Week 8 Status

Completed:

- Added Embeddings with a provider abstraction (`lib/semantic/`): REAL local model `intfloat/multilingual-e5-small` (384 dims, Arabic + English, no API key) by default, optional OpenAI `text-embedding-3-small` (384 dims) when configured, and a clearly labelled TEST ONLY deterministic provider for automated tests
- Added pgvector 0.8.7 to the local PostgreSQL 18 and migration `007_add_semantic_index.sql` (`semantic_documents` with `vector(384)`, `semantic_index_status`, `content_version` on Posts/Pages/Comments)
- Added Semantic Search (Search page → Mode: Keyword / Semantic, `GET /api/search?mode=semantic`) — retrieval only, no generated answers
- Ranked by vector similarity: cosine distance (`<=>`), exact scan, most similar first
- Made Retrieval permission-aware: department / scope / Admin rules and the published lifecycle are part of the same SQL query that ranks by similarity
- Indexed published Official Pages, published Community Posts, Comments on published parents and the Chunks of active, Ready, current File versions
- Added reindexing: a separate BullMQ Queue (`nozom-semantic-indexing`) + Worker Jobs `{ sourceType, sourceId, sourceVersion }`, `npm run semantic:reindex` (idempotent bootstrap / repair)
- Added stale-index exclusion: an edit bumps the source version and deletes the old vectors in the request; archive / disable / replace / delete remove them immediately
- Every result is source-linked: type, title, parent, File version + PDF page, open-source link and authorized download link
- Added Keyword vs Semantic evaluation on 10 questions with the real model (`npm run eval:week8`, `docs/week8-retrieval-evaluation.md`)
- Added integration tests with real PostgreSQL/pgvector + Redis + Worker (`npm run test:week8`)

Architecture:

- Content → embedding provider → vector → PostgreSQL pgvector
- Query → query embedding → vector similarity → permissions / lifecycle → ranked results → source

Local development:

- Terminal 1: Redis on `127.0.0.1:6379`
- Terminal 2: `npm run dev`
- Terminal 3: `npm run worker:dev` (File processing + semantic indexing)
- Once: migration `007_add_semantic_index.sql`, then `npm run semantic:reindex`
- The local model is downloaded on first use into `.models/` (git-ignored)

Notes:

- Vectors are a cache: Search re-checks version, lifecycle and permissions at query time, so a permission change needs no re-embedding
- File processing status (Week 7) and semantic indexing status are separate
- Vectors of different models are never compared (`embedding_model` is stored per row)
- Real evaluation result (Top-5): Keyword 4/10, Semantic 9/10
- Chat / RAG answer generation belongs to Week 9

Key concepts practiced:

- Tokens
- Embeddings
- Vectors
- Vector Similarity
- pgvector
- Semantic Search
- Retrieval
- Retrieval Quality
- Reindexing
