"""JWT encode / decode helpers — PyJWT only (not python-jose)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt
from jwt.exceptions import InvalidTokenError

from src.core.config import get_auth_settings


def create_access_token(data: dict[str, str]) -> str:
    cfg = get_auth_settings()
    payload = {**data, "exp": datetime.now(UTC) + timedelta(minutes=cfg.JWT_EXP_MINUTES)}
    return jwt.encode(payload, cfg.SECRET_KEY, algorithm=cfg.JWT_ALG)


def decode_token(token: str) -> dict[str, str]:
    cfg = get_auth_settings()
    try:
        return jwt.decode(token, cfg.SECRET_KEY, algorithms=[cfg.JWT_ALG])
    except InvalidTokenError as exc:
        raise ValueError("Invalid or expired token") from exc
