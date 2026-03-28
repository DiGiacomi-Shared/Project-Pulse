"""
DevKit integration endpoints
"""

from fastapi import APIRouter
from typing import List
from pydantic import BaseModel

router = APIRouter()


class Snapshot(BaseModel):
    id: str
    timestamp: str
    description: str


class ADR(BaseModel):
    number: int
    title: str
    status: str


@router.get("/devkit/snapshots", response_model=List[Snapshot])
async def get_snapshots():
    """Get list of Panic Button snapshots"""
    # TODO: Read from Panic Button index
    return []


@router.get("/devkit/adrs", response_model=List[ADR])
async def get_adrs():
    """Get list of Architecture Decision Records"""
    # TODO: Scan docs/adr/ directories
    return []


@router.post("/devkit/detect")
async def run_detective(error_message: str):
    """Run Git Detective on an error"""
    # TODO: Execute detective command
    return {"status": "started"}
