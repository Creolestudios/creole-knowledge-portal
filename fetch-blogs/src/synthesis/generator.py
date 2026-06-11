import logging
import json
import time
from datetime import datetime
import uuid
import google.generativeai as genai
from src.config import settings
from src.models.schemas import DailyDigest, DigestArticle, DigestMetadata, UserProfile, Article, Section, SourceCitation

logger = logging.getLogger(__name__)

if settings.GEMINI_API_KEY:
    genai.configure(api_key=settings.GEMINI_API_KEY)

def generate_daily_digest(user: UserProfile, articles: list[Article]) -> DailyDigest:
    """
    Synthesizes multiple raw scraped articles into a single highly-personalized Daily Digest blog.
    Uses Gemini LLM in JSON Mode to output structure matching our Pydantic schema.
    """
    logger.info(f"Generating personalized digest for user: {user.name} ({user.user_id})")
    start_time = time.time()
    
    # 1. Format profile and tech stack info
    user_stack = f"""
    Developer Profile:
    - Name: {user.name}
    - Role: {user.current_role}
    - Experience Level: {user.years_of_experience} years
    - Primary Stack: {', '.join(user.primary_tech_stack)}
    - Secondary Stack: {', '.join(user.secondary_tech_stack)}
    - Interests: {', '.join(user.interests)}
    - Excluded Topics: {', '.join(user.excluded_topics)}
    """.strip()
    
    # 2. Format source articles context
    articles_context = []
    source_citations = []
    for idx, art in enumerate(articles[:10]): # Top 10 articles
        articles_context.append(f"""
        [Source #{idx + 1}]
        Title: {art.title}
        URL: {art.url}
        Domain: {art.source_domain}
        Author: {art.author or 'Unknown'}
        Snippet: {art.body_text[:1200]} ...
        Tags: {', '.join(art.tags)}
        """)
        
        source_citations.append(SourceCitation(
            id=idx + 1,
            title=art.title,
            url=art.url,
            author=art.author,
            source_domain=art.source_domain,
            published_at=art.published_at.strftime("%Y-%m-%d") if art.published_at else None
        ))
        
    articles_str = "\n\n".join(articles_context)
    
    # 3. Formulate Prompt
    prompt = f"""
    You are the AI Factory Digest Synthesizer, an expert senior technology analyst.
    Your task is to synthesize the provided articles into a single high-fidelity, extremely premium "Morning Briefing" daily blog article tailored specifically for this developer.
    
    {user_stack}
    
    Trending articles evaluated for today:
    {articles_str}
    
    Output Format Requirements:
    You must output a structured JSON matching this exact schema:
    {{
      "headline": "A catchy, sophisticated headline capturing the tech trends tailored to their stack.",
      "tldr": [
        "Takeaway 1: ...",
        "Takeaway 2: ...",
        "Takeaway 3: ..."
      ],
      "sections": [
        {{
          "title": "Section Title 1",
          "content": "Deep dive discussion in beautiful Markdown. Preserving code snippets where appropriate. Avoid referencing 'Source #1' literally; integrate concepts naturally and list citations in the sources_cited field.",
          "sources_cited": [1, 3],
          "estimated_read_minutes": 4.5
        }}
      ],
      "key_takeaways": [
        "Actionable step 1...",
        "Actionable step 2..."
      ],
      "further_reading": [
        {{
          "title": "Interesting article title",
          "url": "https://..."
        }}
      ]
    }}
    
    Make the markdown content rich, comprehensive, and professional. 
    Target overall word count around 1500 to 2500 words. Write 3-4 sections.
    """
    
    # Define models to try
    models_to_try = [
        "gemini-2.5-flash",
        "gemini-1.5-flash",
        "gemini-2.0-flash",
        "gemini-1.5-pro"
    ]
    
    json_response = None
    tokens_used = 0
    
    for model_name in models_to_try:
        try:
            logger.info(f"Synthesizing with model {model_name}...")
            model = genai.GenerativeModel(model_name)
            response = model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"}
            )
            
            if response and response.text:
                json_response = json.loads(response.text)
                # Try to count tokens if metadata is available
                try:
                    tokens_used = model.count_tokens(prompt).total_tokens
                except Exception:
                    tokens_used = len(prompt.split()) * 2 # estimation
                break
        except Exception as e:
            logger.warning(f"Failed to generate digest using model {model_name}: {e}")
            
    if not json_response:
        # Emergency Fallback if Gemini fails entirely
        logger.error("All Gemini synthesis models failed. Constructing emergency backup digest.")
        json_response = {
            "headline": "Your Morning Technical Briefing",
            "tldr": ["Daily tech curation pipeline completed successfully."],
            "sections": [
                {
                    "title": "Welcome to your Custom Tech Briefing",
                    "content": "We successfully fetched and cataloged your trending tech news, but the AI synthesis experienced transient high demand. Please try regenerating shortly to review your deep-dive articles.",
                    "sources_cited": [1],
                    "estimated_read_minutes": 2.0
                }
            ],
            "key_takeaways": ["Check back shortly for synthesized technical breakdowns."],
            "further_reading": []
        }
        
    # 4. Map JSON to Pydantic Model
    sections_list = []
    total_reading_time = 0.0
    for sec in json_response.get("sections", []):
        sec_obj = Section(
            title=sec.get("title", "Untitled Section"),
            content=sec.get("content", ""),
            sources_cited=sec.get("sources_cited", []),
            estimated_read_minutes=float(sec.get("estimated_read_minutes", 1.0))
        )
        sections_list.append(sec_obj)
        total_reading_time += sec_obj.estimated_read_minutes
        
    digest_article = DigestArticle(
        headline=json_response.get("headline", "Morning Briefing"),
        tldr=json_response.get("tldr", []),
        sections=sections_list,
        key_takeaways=json_response.get("key_takeaways", []),
        sources=source_citations,
        further_reading=json_response.get("further_reading", [])
    )
    
    latency = time.time() - start_time
    
    # Calculate word count
    all_content_text = " ".join([s.content for s in sections_list])
    word_count = len(all_content_text.split())
    
    digest_metadata = DigestMetadata(
        articles_evaluated=len(articles),
        articles_used_in_synthesis=len(source_citations),
        llm_tokens_used=tokens_used,
        generation_latency_seconds=round(latency, 2)
    )
    
    digest = DailyDigest(
        digest_id=str(uuid.uuid4()),
        user_id=user.user_id,
        strategy_used="C",
        reading_time_minutes=round(total_reading_time or max(1.0, word_count / 250.0), 1),
        word_count=word_count,
        article=digest_article,
        metadata=digest_metadata
    )
    
    return digest
