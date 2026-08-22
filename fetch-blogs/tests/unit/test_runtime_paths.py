import importlib
import os
from pathlib import Path


def test_runtime_paths_sets_tmpdir_under_app_cache(monkeypatch, tmp_path):
    cache = tmp_path / "cache"
    monkeypatch.setenv("APP_CACHE_DIR", str(cache))
    monkeypatch.delenv("TMPDIR", raising=False)

    import src.core.runtime_paths as runtime_paths

    importlib.reload(runtime_paths)

    assert os.environ["TMPDIR"] == str(cache / "tmp")
    assert Path(cache / "tmp").is_dir()
