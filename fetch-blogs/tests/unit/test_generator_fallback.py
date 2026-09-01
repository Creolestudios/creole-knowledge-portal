import pytest
from src.models.profile import UserProfile
from src.generator.synthesizer import synthesize_digest

@pytest.mark.asyncio
async def test_synthesize_digest_fallback_on_empty_articles():
    profile = UserProfile(
        user_id="test-user",
        primary_tech_stack=["python", "fastapi"]
    )
    
    # Should not raise an exception, and should return a DailyDigest object
    digest = synthesize_digest(profile, [])
    
    # Verify the fallback content is present
    assert digest.user_id == "test-user"
    assert digest.content.headline == "Your Morning Technical Briefing"
    assert len(digest.content.sections) == 1
    assert digest.content.sections[0].title == "Today's curated reading"
    assert digest.content.sections[0].estimated_read_minutes == 1.0
