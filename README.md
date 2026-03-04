# MakerLab Tools

A white-label digital inventory and discovery system for makerspaces and equipment labs. Designed to be adopted by any organization with a physical tool inventory.

Students and staff can browse equipment, ask an AI assistant questions about any tool, scan QR codes on machines, and report maintenance issues — all from a single web app.

## Architecture

```
                                    ┌─────────────────────────────────────────────┐
                                    │              Vercel (Hosting)               │
                                    │                                             │
┌──────────────┐                    │  ┌───────────────────────────────────────┐  │
│              │   HTTP/WebSocket   │  │         Next.js App Router            │  │
│   Browser    │◄──────────────────►│  │                                       │  │
│              │                    │  │  Pages (Server Components + ISR)       │  │
│  - React 19  │                    │  │  ┌─────┐ ┌───────┐ ┌──────┐ ┌──────┐ │  │
│  - Tailwind  │                    │  │  │  /  │ │/tools │ │/chat │ │/scan │ │  │
│  - QR scan   │                    │  │  │     │ │ /[id] │ │      │ │      │ │  │
│              │                    │  │  └─────┘ └───────┘ └──────┘ └──────┘ │  │
└──────────────┘                    │  │  ┌────────┐ ┌──────────┐             │  │
                                    │  │  │/report │ │/units/[id]│             │  │
                                    │  │  └────────┘ └──────────┘             │  │
                                    │  │                                       │  │
                                    │  │  API Routes                           │  │
                                    │  │  ┌──────────┐ ┌──────────────┐       │  │
                                    │  │  │/api/chat │ │/api/maintenance│      │  │
                                    │  │  └────┬─────┘ └──────┬───────┘       │  │
                                    │  │  ┌────┴─────┐ ┌──────┴───────┐       │  │
                                    │  │  │/api/flag │ │/api/image    │       │  │
                                    │  │  └──────────┘ └──────────────┘       │  │
                                    │  │  ┌──────────────┐ ┌─────────┐        │  │
                                    │  │  │/api/image-   │ │/api/mcp │        │  │
                                    │  │  │    search    │ │         │        │  │
                                    │  │  └──────────────┘ └─────────┘        │  │
                                    │  └───────────┬───────────┬───────────┘  │
                                    └──────────────┼───────────┼──────────────┘
                                                   │           │
                                    ┌──────────────▼──┐  ┌─────▼──────────┐
                                    │    AirTable     │  │   Claude API   │
                                    │   REST API      │  │  (Anthropic)   │
                                    │                 │  │                │
                                    │  6 tables:      │  │  - Chat with   │
                                    │  - Tools        │  │    tool context│
                                    │  - Categories   │  │  - Web search  │
                                    │  - Locations    │  │  - Doc fetching│
                                    │  - Units        │  │                │
                                    │  - Maint. Logs  │  └────────────────┘
                                    │  - Flags        │
                                    └─────────────────┘  ┌────────────────┐
                                                         │  Gemini API    │
                                                         │  (Google)      │
                                                         │                │
                                                         │  - Tool image  │
                                                         │    generation  │
                                                         └────────────────┘
```

### Data Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│ Browsing (no AI)                                                     │
│                                                                      │
│  Browser ──► Next.js Server Component ──► AirTable REST API          │
│                                               │                      │
│  Pages are statically generated with ISR      │                      │
│  (revalidate every 1 hour), so most visits    ▼                      │
│  are served from cache, not live API calls   Cache                   │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ AI Chat                                                              │
│                                                                      │
│  Browser ──► /api/chat ──► Claude API (streaming)                    │
│                   │                                                  │
│                   ├──► Tool lookup (AirTable) ◄── injected as        │
│                   ├──► Web search               tool/function calls  │
│                   └──► Doc fetching (PDFs, Google Docs)              │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ QR Code Scan                                                         │
│                                                                      │
│  Camera ──► QR decode ──► /units/qr/[code] ──► Unit detail page      │
│                                                   │                  │
│                                                   ▼                  │
│                                            Tool detail page          │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ Maintenance Reporting                                                │
│                                                                      │
│  Browser ──► /report form ──► /api/maintenance ──► AirTable          │
│                                     │               (creates record) │
│                                     └──► Photo upload (base64)       │
└──────────────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router), React 19 |
| Styling | Tailwind CSS 4, CSS variables for theming |
| AI Chat | Claude API via Vercel AI SDK |
| Image Gen | Gemini API (optional) |
| Database | AirTable REST API (6 normalized tables) |
| Testing | Vitest, React Testing Library, jsdom |
| Hosting | Vercel |

## Features

### Browse & Search
- Full-text search across tool names, descriptions, tags, and materials
- Filter by category group, room/location, and material type
- Three view modes: compact grid, large grid, and table
- Toggle between real photos and AI-generated illustrations

### Tool Detail Pages
- Specs, safety requirements, PPE, location, materials
- Image gallery with zoom
- Links to safety docs, SOPs, and training videos
- Document content fetched and displayed inline (Google Docs, PDFs)
- Unit inventory table showing individual machines and their status
- Flag button for users to report incorrect information

### AI Chat Assistant
- Conversational assistant that knows every tool in the inventory
- Retrieves live tool data via function calling (not baked into the prompt)
- Web search for questions beyond the tool catalog
- Fetches and reads linked safety docs and SOPs to answer specific questions
- Generates infographic-style images on request
- Conversation history persisted in localStorage

### QR Code Scanning
- Camera-based QR scanner for physical machine labels
- Manual code entry fallback
- Scanned codes route to the unit's detail page

### Maintenance Reporting
- Multi-step form: select tool, select unit, describe issue
- Pre-fill from QR code scan (`?unit=recXXX`)
- Photo upload (up to 5 images, base64 encoded)
- Creates a record in the Maintenance_Logs AirTable table

### MCP Server
- Built-in Model Context Protocol endpoint at `/api/mcp`
- Exposes tool listing, tool details, and unit lookup as MCP tools
- Allows external AI agents to query the inventory programmatically

## Project Structure

```
├── src/
│   ├── app/                          # Next.js pages & API routes
│   │   ├── page.tsx                  # Home — browse & search tools
│   │   ├── tools/[id]/page.tsx       # Tool detail page
│   │   ├── units/[id]/page.tsx       # Unit detail page
│   │   ├── units/qr/[code]/page.tsx  # QR code redirect
│   │   ├── chat/page.tsx             # Full-page chat interface
│   │   ├── scan/page.tsx             # QR code scanner
│   │   ├── report/page.tsx           # Maintenance report form
│   │   └── api/
│   │       ├── chat/route.ts         # Claude chat (streaming)
│   │       ├── maintenance/route.ts  # Create maintenance log
│   │       ├── flag/route.ts         # Flag incorrect data
│   │       ├── image/route.ts        # Gemini image generation
│   │       ├── image-search/route.ts # Reverse image search
│   │       └── mcp/route.ts          # MCP server endpoint
│   ├── components/                   # 19 React components
│   ├── lib/
│   │   ├── airtable.ts              # All AirTable API calls (server-only)
│   │   ├── site-config.ts           # Branding & white-label config
│   │   ├── types.ts                 # TypeScript interfaces
│   │   ├── doc-fetcher.ts           # Google Docs / PDF / HTML fetcher
│   │   ├── rate-limit.ts            # API rate limiting
│   │   ├── gemini-image.ts          # Gemini image generation
│   │   └── image-processing.ts      # Client-side image state
│   └── __tests__/                   # 91 Vitest tests
├── public/
│   └── tool-images/                 # Tool photographs
├── scripts/                         # Python data management
│   ├── setup_schema.py              # Create AirTable tables
│   ├── populate_data.py             # Excel → AirTable pipeline
│   ├── upload_images.py             # Upload images to AirTable
│   ├── generate_qr_codes.py         # Generate QR code PNGs
│   └── export_data.py               # Backup all tables to JSON
└── package.json
```

## Setup for a New Organization

### Prerequisites

- Node.js 18+
- Python 3.8+ (for setup scripts)
- An [AirTable](https://airtable.com) account (free tier works)
- A [Claude API key](https://console.anthropic.com) (for chat)
- Optionally, a [Gemini API key](https://aistudio.google.com/apikey) (for image generation)
- A [Vercel](https://vercel.com) account (for deployment)

### Step 1: Clone and install

```bash
git clone https://github.com/philosophercode/makerlab-tools.git
cd makerlab-tools
npm install
```

### Step 2: Create your AirTable base

```bash
cd scripts
cp .env.example .env
```

Edit `scripts/.env` with your AirTable API key and base ID:

```env
AIRTABLE_API_KEY=patYourTokenHere
AIRTABLE_BASE_ID=appYourBaseIdHere
```

Create the schema (this prints the table IDs — save them):

```bash
pip install -r requirements.txt
python setup_schema.py
```

Copy the printed table IDs back into `scripts/.env`:

```env
AIRTABLE_TABLE_TOOLS=tblXXXXXXXXXXXXXXX
AIRTABLE_TABLE_CATEGORIES=tblXXXXXXXXXXXXXXX
AIRTABLE_TABLE_LOCATIONS=tblXXXXXXXXXXXXXXX
AIRTABLE_TABLE_UNITS=tblXXXXXXXXXXXXXXX
AIRTABLE_TABLE_MAINTENANCE_LOGS=tblXXXXXXXXXXXXXXX
AIRTABLE_TABLE_FLAGS=tblXXXXXXXXXXXXXXX
```

### Step 3: Populate your data

Prepare an Excel spreadsheet matching the format in `scripts/data/` (or edit the existing one), then:

```bash
python populate_data.py --all     # Clean, normalize, populate everything
python upload_images.py           # Upload tool images to AirTable
python generate_qr_codes.py       # Generate QR code PNGs (optional)
```

### Step 4: Configure the app

```bash
cd ..
cp .env.example .env.local
```

Edit `.env.local` with your credentials and the table IDs from step 2:

```env
AIRTABLE_API_KEY=patYourTokenHere
AIRTABLE_BASE_ID=appYourBaseIdHere
AIRTABLE_TABLE_TOOLS=tblXXXXXXXXXXXXXXX
AIRTABLE_TABLE_CATEGORIES=tblXXXXXXXXXXXXXXX
AIRTABLE_TABLE_LOCATIONS=tblXXXXXXXXXXXXXXX
AIRTABLE_TABLE_UNITS=tblXXXXXXXXXXXXXXX
AIRTABLE_TABLE_MAINTENANCE_LOGS=tblXXXXXXXXXXXXXXX
AIRTABLE_TABLE_FLAGS=tblXXXXXXXXXXXXXXX
ANTHROPIC_API_KEY=sk-ant-api03-YourKeyHere
GEMINI_API_KEY=AIzaYourKeyHere        # optional
```

### Step 5: Customize branding

Edit `src/lib/site-config.ts`:

```typescript
export const siteConfig = {
  name: "Your Lab Tools",
  institution: "Your University",
  tagline: "Browse and discover equipment in the Your Lab.",
  chatAssistantName: "Lab Assistant",
  audience: "students and staff who may be beginners",
  logo: "/your-logo.png",
  colors: {
    primary: "#0066CC",      // your brand color
    primaryDark: "#004C99",   // darker shade for hover states
  },
};
```

Update the CSS variables in `src/app/globals.css` to match your colors:

```css
:root {
  --primary: #0066CC;
  --primary-dark: #004C99;
}
```

Replace the logo files in `public/` with your own.

### Step 6: Verify locally

```bash
npm run dev       # Start dev server at http://localhost:3000
npm test          # Run 91 tests
npm run build     # Verify production build
```

### Step 7: Deploy to Vercel

```bash
npm i -g vercel
vercel
```

Or connect your GitHub repo to Vercel for automatic deploys on push. Add all the environment variables from `.env.local` to your Vercel project settings.

## AirTable Schema

The app uses 6 normalized tables:

| Table | Purpose | Key Fields |
|-------|---------|------------|
| **Tools** | Equipment catalog | name, description, category, location, materials, PPE, image, safety docs |
| **Categories** | Two-level taxonomy | group (e.g. "3D Printing"), subcategory (e.g. "FDM") |
| **Locations** | Physical layout | room, zone |
| **Units** | Individual machines | tool (linked), unit_label, serial_number, qr_code, status |
| **Maintenance_Logs** | Issue tracking | unit (linked), type, priority, title, description, photos, status |
| **Flags** | Data corrections | tool (linked), field, message, submitted_by |

Tools link to Categories and Locations. Units link to Tools. Maintenance_Logs link to Units.

## Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm test             # Run all tests
npm run test:watch   # Watch mode
npm run lint         # ESLint
```

## License

MIT
