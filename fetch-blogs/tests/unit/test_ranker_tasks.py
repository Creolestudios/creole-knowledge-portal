from __future__ import annotations

import pytest

from src.workers import ranker_tasks


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
def test_rank_articles_returns_article_ids_only(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_rank(article_ids: list[str], user_id: str, limit: int) -> list[str]:
        assert article_ids == ["a", "b"]
        assert user_id == "user-1"
        assert limit == 1
        return ["b"]

    monkeypatch.setattr(ranker_tasks, "_rank_articles_for_user", fake_rank)

    assert ranker_tasks.rank_articles.run(["a", "b"], "user-1", 1) == ["b"]
