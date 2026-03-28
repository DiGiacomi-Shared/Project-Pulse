"""
Database connection and models
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, Float
from datetime import datetime

from config import settings

Base = declarative_base()


class Repo(Base):
    __tablename__ = "repos"
    
    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    owner = Column(String(255), nullable=False)
    url = Column(String(512))
    last_commit_at = Column(DateTime)
    open_prs = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)


class Activity(Base):
    __tablename__ = "activities"
    
    id = Column(Integer, primary_key=True)
    repo_id = Column(Integer, nullable=False)
    type = Column(String(50))  # commit, pr, issue
    title = Column(String(512))
    author = Column(String(255))
    sha = Column(String(40))  # for commits
    created_at = Column(DateTime, default=datetime.utcnow)


class Insight(Base):
    __tablename__ = "insights"
    
    id = Column(Integer, primary_key=True)
    type = Column(String(50))  # reminder, drift, pattern, alert
    title = Column(String(512), nullable=False)
    description = Column(Text)
    severity = Column(String(20))  # info, warning, critical
    read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


# Database engine
engine = create_async_engine(
    settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://"),
    echo=settings.DEBUG
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db():
    """Initialize database tables"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    """Dependency for getting database session"""
    async with async_session() as session:
        yield session
