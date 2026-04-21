"""
Project Pulse - FastAPI Backend
Main application entry point
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from config import settings
from db import init_db
from routers import health, vectorspace

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    logger.info("Starting up Project Pulse API...")
    await init_db()
    yield
    logger.info("Shutting down Project Pulse API...")


app = FastAPI(
    title="Project Pulse",
    description="Workspace intelligence dashboard with ACE vector visualization",
    version="0.1.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(vectorspace.router, prefix="/api", tags=["vectorspace"])


@app.get("/")
async def root():
    return {
        "name": "Project Pulse",
        "version": "0.1.0",
        "docs": "/docs"
    }