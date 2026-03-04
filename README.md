# MakerLab Tools

A digital inventory and discovery system for makerspace equipment. Students can browse tools, chat with an AI assistant, scan QR codes on machines, and report maintenance issues.

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your API keys

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Features

- **Browse** — Search and filter 101+ tools by category, location, and material
- **Chat** — AI assistant powered by Claude that knows every tool's specs, safety docs, and SOPs
- **Scan** — QR code scanner to quickly look up any machine
- **Report** — Submit maintenance issues with photos directly from the app

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AIRTABLE_API_KEY` | Yes | AirTable personal access token |
| `AIRTABLE_BASE_ID` | Yes | AirTable base ID |
| `ANTHROPIC_API_KEY` | Yes | Claude API key for chat |
| `GEMINI_API_KEY` | No | Gemini API key for image generation |
| `AIRTABLE_TABLE_*` | No | Override default table IDs (see `.env.example`) |

## White-Labeling for a Different Makerlab

1. Edit `src/lib/site-config.ts` — name, institution, colors, logo path
2. Update CSS variables in `src/app/globals.css` if changing brand colors
3. Replace logo files in `public/`
4. Set your own AirTable credentials and table IDs in `.env.local`
5. Run the setup scripts to populate your AirTable base (see below)

## AirTable Setup (New Deployment)

If setting up a fresh AirTable base:

```bash
cd scripts
cp .env.example .env
# Edit .env with your AirTable credentials

pip install -r requirements.txt

# 1. Create all tables
python setup_schema.py
# Copy the printed table IDs into your .env files

# 2. Populate tools, categories, locations from Excel
python populate_data.py --all

# 3. Upload tool images
python upload_images.py

# 4. Generate QR code images (optional)
python generate_qr_codes.py
```

## Testing

```bash
npm test             # Run all tests
npm run test:watch   # Watch mode
```

## Deployment

Deployed on Vercel. Push to `main` to deploy.

```bash
npm run build   # Verify production build locally
```

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **UI:** React 19, Tailwind CSS 4
- **AI:** Claude (chat), Gemini (image generation)
- **Data:** AirTable REST API
- **Testing:** Vitest, React Testing Library
- **Deploy:** Vercel
