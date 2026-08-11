import logging
import httpx
from bs4 import BeautifulSoup
from newspaper import Article
import urllib.parse

logger = logging.getLogger(__name__)

def extract_article_content(url: str, html_content: str = None) -> dict:
    """
    Extracts high-quality main body text, author, and metadata from a web page.
    Utilizes newspaper3k with a BeautifulSoup fallback.
    """
    result = {
        "body_text": "",
        "body_markdown": "",
        "author": None,
        "title": "",
        "word_count": 0,
        "reading_time_min": 0.0,
        "tags": []
    }
    
    # Try newspaper3k
    try:
        article = Article(url)
        if html_content:
            article.set_html(html_content)
            article.parse()
        else:
            article.download()
            article.parse()
            
        result["title"] = article.title
        result["body_text"] = article.text
        result["author"] = ", ".join(article.authors) if article.authors else None
        result["word_count"] = len(article.text.split())
        result["reading_time_min"] = max(0.5, round(result["word_count"] / 250.0, 1)) # standard 250 WPM
        if article.tags:
            result["tags"] = list(article.tags)
            
        # Basic markdown conversion (paragraph preservation)
        result["body_markdown"] = "\n\n".join([f"{p.strip()}" for p in article.text.split('\n\n') if p.strip()])
        
        if result["body_text"]:
            return result
    except Exception as e:
        logger.warning(f"newspaper3k failed for {url}: {e}. Falling back to BeautifulSoup.")
        
    # Fallback to BeautifulSoup if newspaper3k fails
    try:
        if not html_content:
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            with httpx.Client(timeout=10.0) as client:
                res = client.get(url, headers=headers)
                html_content = res.text
                
        soup = BeautifulSoup(html_content, "html.parser")
        
        # Remove script and style elements
        for script in soup(["script", "style", "nav", "footer", "header", "aside"]):
            script.decompose()
            
        # Get title
        title = ""
        if soup.title:
            title = soup.title.string.strip()
        elif soup.h1:
            title = soup.h1.get_text().strip()
            
        # Get paragraphs
        paragraphs = [p.get_text().strip() for p in soup.find_all("p") if len(p.get_text().strip()) > 30]
        body_text = "\n\n".join(paragraphs)
        
        result["title"] = title or url
        result["body_text"] = body_text
        result["body_markdown"] = body_text
        result["word_count"] = len(body_text.split())
        result["reading_time_min"] = max(0.5, round(result["word_count"] / 250.0, 1))
        
    except Exception as ex:
        logger.error(f"BeautifulSoup fallback also failed for {url}: {ex}")
        
    return result

def get_domain(url: str) -> str:
    try:
        parsed = urllib.parse.urlparse(url)
        return parsed.netloc.replace("www.", "")
    except Exception:
        return "unknown"
