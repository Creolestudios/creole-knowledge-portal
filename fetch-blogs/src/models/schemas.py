from pydantic import BaseModel, Field
from datetime import datetime
from typing import List, Optional, Dict, Any

class UserProfile(BaseModel):
    user_id: str
    name: str
    years_of_experience: int = 0
    primary_tech_stack: List[str] = []
    secondary_tech_stack: List[str] = []
    interests: List[str] = []
    current_role: str = "Developer"
    preferred_content_depth: Optional[str] = None
    excluded_topics: List[str] = []
    preferred_sources: List[str] = []
    content_freshness_days: int = 30

    class Config:
        populate_by_name = True

class Article(BaseModel):
    id: Optional[str] = None
    url: str
    title: str
    author: Optional[str] = None
    source_domain: str
    published_at: Optional[datetime] = None
    scraped_at: datetime = Field(default_factory=datetime.utcnow)
    body_text: str
    body_markdown: Optional[str] = None
    word_count: int = 0
    reading_time_min: float = 0.0
    tags: List[str] = []
    metadata: Dict[str, Any] = {}
    embedding: Optional[List[float]] = None
    quality_score: float = 0.0
    strategy_source: str = "A"

class SourceCitation(BaseModel):
    id: int
    title: str
    url: str
    author: Optional[str] = None
    source_domain: str
    published_at: Optional[str] = None

class Section(BaseModel):
    title: str
    content: str
    sources_cited: List[int] = []
    estimated_read_minutes: float = 0.0

class DigestArticle(BaseModel):
    headline: str
    tldr: List[str]
    sections: List[Section]
    key_takeaways: List[str]
    sources: List[SourceCitation]
    further_reading: List[Dict[str, str]] = []

class DigestMetadata(BaseModel):
    articles_evaluated: int = 0
    articles_used_in_synthesis: int = 0
    llm_tokens_used: int = 0
    generation_latency_seconds: float = 0.0

class DailyDigest(BaseModel):
    digest_id: str
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    user_id: str
    strategy_used: str = "C"
    reading_time_minutes: float = 0.0
    word_count: int = 0
    article: DigestArticle
    metadata: DigestMetadata
