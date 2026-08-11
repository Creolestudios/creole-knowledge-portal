import logging
from datetime import datetime
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional

from src.storage.mongodb import mongo_manager, get_db
from src.hybrid.coordinator import run_hybrid_pipeline

logger = logging.getLogger("fastapi_service.digests")

router = APIRouter(prefix="/digests", tags=["digests"])

# Request Models
class GenerateRequest(BaseModel):
    userId: str

def flat_map_digest_for_dashboard(doc: dict) -> dict:
    """
    Converts a structured Pydantic MongoDB digest document into a flat backwards-compatible 
    format expected by the existing dashboard React component (title, content, published_at, tags).
    """
    article = doc.get("article", {})
    headline = article.get("headline", "Morning Briefing")
    
    # Reconstruct comprehensive Markdown document
    markdown_parts = []
    
    # 1. Headline
    markdown_parts.append(f"# {headline}\n")
    
    # 2. TLDR
    tldr = article.get("tldr", [])
    if tldr:
        markdown_parts.append("## Daily Overview (TL;DR)\n")
        for item in tldr:
            markdown_parts.append(f"- {item}")
        markdown_parts.append("")
        
    # 3. Sections
    sections = article.get("sections", [])
    for sec in sections:
        markdown_parts.append(f"## {sec.get('title')}\n")
        markdown_parts.append(sec.get("content", ""))
        markdown_parts.append("")
        
    # 4. Actionable key takeaways
    takeaways = article.get("key_takeaways", [])
    if takeaways:
        markdown_parts.append("## Key Actionable Takeaways\n")
        for item in takeaways:
            markdown_parts.append(f"- {item}")
        markdown_parts.append("")
        
    # 5. Cited sources & further reading
    sources = article.get("sources", [])
    if sources:
        markdown_parts.append("## Sources & Citations\n")
        for src in sources:
            author_str = f" by {src.get('author')}" if src.get("author") else ""
            markdown_parts.append(f"- **[{src.get('title')}]({src.get('url')})** — Published on *{src.get('source_domain')}*{author_str}")
        markdown_parts.append("")
        
    flat_content = "\n".join(markdown_parts)
    
    # Extract tags
    flat_tags = [
        "morning-briefing",
        "mongodb",
        "synthesis"
    ]
    # Add unique tags from articles
    for src in sources:
        domain = src.get("source_domain", "")
        if domain and domain not in flat_tags:
            flat_tags.append(domain)

    # Return structure matching what Next.js client parses
    return {
        "id": doc.get("id"),
        "title": headline,
        "content": flat_content,
        "published_at": doc.get("generated_at"),
        "tags": flat_tags
    }

@router.post("/generate")
async def generate_digest(payload: GenerateRequest, flat: bool = True):
    """
    Manually triggers the web scraping and AI synthesis pipeline for a specific user.
    Returns backward-compatible flat format by default, or raw structured JSON if flat=false.
    """
    if not payload.userId:
        raise HTTPException(status_code=400, detail="userId is required")
        
    try:
        digest = await run_hybrid_pipeline(payload.userId)
        digest_dict = digest.model_dump()
        digest_dict["id"] = digest.digest_id
        
        # Serialize datetimes for JSON response
        if isinstance(digest_dict.get("generated_at"), datetime):
            digest_dict["generated_at"] = digest_dict["generated_at"].isoformat()
            
        if flat:
            flat_blog = flat_map_digest_for_dashboard(digest_dict)
            return {
                "success": True,
                "blog": flat_blog
            }
        else:
            return {
                "success": True,
                "blog": digest_dict
            }
    except Exception as e:
        logger.error(f"Digest generation failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Synthesis pipeline error: {str(e)}"
        )

@router.get("/{user_id}/latest")
async def get_latest_digest(user_id: str, flat: bool = True):
    """
    Queries MongoDB for the most recent synthesized digest for a user.
    """
    db = get_db()
    try:
        # Query MongoDB for the latest digest ordered by generation date
        cursor = db.daily_digests.find({"user_id": user_id}).sort("generated_at", -1).limit(1)
        async for doc in cursor:
            # Map MongoDB ObjectId and remove MongoDB specific details
            doc["id"] = str(doc.pop("_id", ""))
            
            # Serialize datetimes
            if isinstance(doc.get("generated_at"), datetime):
                doc["generated_at"] = doc["generated_at"].isoformat()
                
            if flat:
                flat_blog = flat_map_digest_for_dashboard(doc)
                return {
                    "success": True,
                    "blog": flat_blog
                }
            else:
                return {
                    "success": True,
                    "blog": doc
                }
            
        # If no digest exists, return success with null
        return {
            "success": True,
            "blog": None
        }
    except Exception as e:
        logger.error(f"Failed to fetch latest digest: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Database query failed: {str(e)}"
        )

@router.get("/scraped-sources")
async def get_scraped_sources(limit: int = 50):
    """
    Queries MongoDB and returns the recently scraped site URLs with metadata.
    """
    db = get_db()
    try:
        cursor = db.scraped_sources.find().sort("scraped_at", -1).limit(limit)
        sources = []
        async for doc in cursor:
            doc["id"] = str(doc.pop("_id", ""))
            if isinstance(doc.get("scraped_at"), datetime):
                doc["scraped_at"] = doc["scraped_at"].isoformat()
            sources.append(doc)
        return {
            "success": True,
            "sources": sources
        }
    except Exception as e:
        logger.error(f"Failed to fetch scraped sources from MongoDB: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Database query failed: {str(e)}"
        )

@router.post("/cron/trigger")
async def trigger_cron_manually(background_tasks: BackgroundTasks):
    """
    Manually triggers the daily briefing cron job execution in the background immediately.
    """
    from src.scheduler.jobs import trigger_daily_briefings_job
    background_tasks.add_task(trigger_daily_briefings_job)
    return {
        "success": True,
        "message": "Daily briefing generation cron job successfully triggered in the background."
    }
