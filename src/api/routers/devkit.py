"""
DevKit integration endpoints
"""

from fastapi import APIRouter
from typing import List
from pydantic import BaseModel
import subprocess
import json
from pathlib import Path

router = APIRouter()

WORKSPACE_ROOT = Path("/home/mdigiacomi/.openclaw/workspace")
DEVKIT_PATH = WORKSPACE_ROOT / "devkit"


class Snapshot(BaseModel):
    id: str
    timestamp: str
    description: str


class ADR(BaseModel):
    number: int
    title: str
    status: str


class DetectiveResult(BaseModel):
    query: str
    commits_found: int
    suspects: List[dict]
    timeline: List[dict]
    brain_context: dict = None


@router.get("/devkit/snapshots", response_model=List[Snapshot])
async def get_snapshots():
    """Get list of Panic Button snapshots"""
    try:
        # Read Panic Button index
        import sys
        sys.path.insert(0, str(DEVKIT_PATH))
        from panic_button import PanicButton
        
        panic = PanicButton()
        snapshots = panic.list_snapshots()
        
        return [
            Snapshot(
                id=s.get("id", ""),
                timestamp=s.get("timestamp", ""),
                description=s.get("description", "")
            )
            for s in snapshots[-20:]  # Last 20
        ]
    except Exception as e:
        return []


@router.get("/devkit/adrs", response_model=List[ADR])
async def get_adrs():
    """Get list of Architecture Decision Records"""
    adrs = []
    
    # Scan docs/adr/ directories in projects
    projects = ["specterdefence", "screen-sprout-api"]
    for project in projects:
        adr_dir = WORKSPACE_ROOT / project / "docs" / "adr"
        if adr_dir.exists():
            for f in sorted(adr_dir.glob("*.md")):
                # Extract ADR number from filename
                match = f.name.split("-")[0]
                try:
                    number = int(match)
                    # Read status from file
                    content = f.read_text()
                    status = "proposed"
                    if "**Status:** ACCEPTED" in content:
                        status = "accepted"
                    elif "**Status:** DEPRECATED" in content:
                        status = "deprecated"
                    
                    adrs.append(ADR(
                        number=number,
                        title=f.name.replace(".md", "").replace("-", " ").title(),
                        status=status
                    ))
                except ValueError:
                    pass
    
    return sorted(adrs, key=lambda x: x.number)


@router.post("/devkit/detect", response_model=DetectiveResult)
async def run_detective(error_message: str):
    """Run Git Detective on an error"""
    try:
        import sys
        sys.path.insert(0, str(DEVKIT_PATH))
        from git_detective import GitDetective
        
        detective = GitDetective()
        results = detective.trace_error(error_message)
        
        return DetectiveResult(
            query=error_message,
            commits_found=len(results.get("commits", [])),
            suspects=[
                {"author": author, "commits": count}
                for author, count in results.get("suspects", [])[:5]
            ],
            timeline=results.get("timeline", [])[:5],
            brain_context=results.get("brain_context")
        )
    except Exception as e:
        return DetectiveResult(
            query=error_message,
            commits_found=0,
            suspects=[],
            timeline=[],
            brain_context={"error": str(e)}
        )


@router.get("/devkit/stats")
async def get_devkit_stats():
    """Get DevKit overall statistics"""
    try:
        panic = PanicButton()
        snapshots = panic.list_snapshots()
        
        return {
            "total_snapshots": len(snapshots),
            "last_snapshot": snapshots[-1] if snapshots else None
        }
    except:
        return {"total_snapshots": 0}
