# VectorSpace

A 2D visualization tool for the AI Context Engine (ACE) memory database. Displays memories as scatter plots with semantic similarity edges.

## What It Does

- **Projects** ACE memory embeddings into 2D space using PCA
- **Renders** memories as colored points (by namespace or category)
- **Shows** similarity-based edges between related memories
- **Displays** explicit relationships as dashed lines
- **Searches** memories via semantic similarity (Ollama embeddings)

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Browser   │────▶│   Frontend   │────▶│   FastAPI   │
│             │     │  (React/TS)  │     │             │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │
                                         ┌──────┴──────┐
                                         │   Postgres  │
                                         │   (ACE db)  │
                                         └──────┬──────┘
                                                │
                                         ┌──────┴──────┐
                                         │   Ollama    │
                                         │ (embeddings)│
                                         └─────────────┘
```

## Requirements

- Postgres with ACE schema (`context_engine` database)
- Ollama running (for embeddings) at `OLLAMA_URL`
- K3s cluster for deployment

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Service health check |
| GET | `/api/vectorspace/stats` | Memory counts |
| GET | `/api/vectorspace/projections` | 2D coordinates + metadata |
| GET | `/api/vectorspace/relationships` | Similarity edges |
| GET | `/api/vectorspace/explicit-relationships` | Explicit edges |
| POST | `/api/vectorspace/search?q=query` | Semantic search |
| GET | `/api/vectorspace/memory/{id}` | Full memory details |

## Environment Variables

```bash
# ACE Database (required)
ACE_PG_HOST=100.102.10.75
ACE_PG_PORT=5432
ACE_PG_DATABASE=context_engine
ACE_PG_USER=context_engine
ACE_PG_PASSWORD=ctx2024engine

# Ollama (required for search)
OLLAMA_URL=http://100.100.227.127:11434
OLLAMA_MODEL=nomic-embed-text

# CORS (optional)
CORS_ORIGINS=["*"]
```

## Local Development

```bash
cd src/api
pip install -r requirements.txt
uvicorn main:app --reload

cd src/frontend
npm install
npm run dev
```

## Deploy to K3s

```bash
cd k8s
kubectl apply -k .
```

## Access

After deployment: `https://pulse.digitaladrenalin.net`

## Tech Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Backend:** FastAPI
- **Database:** PostgreSQL (ACE schema)
- **Embeddings:** Ollama (nomic-embed-text)
- **Container:** K3s

## License

MIT
