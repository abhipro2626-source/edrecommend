"""Supabase access for the backend.

Uses the SERVICE ROLE key, which bypasses Row Level Security, so every
helper that touches personal data takes an explicit `user_id` that the
caller obtained from a *verified* JWT — never from the request body.
"""
from __future__ import annotations

import logging
from functools import lru_cache

import config

log = logging.getLogger("edrecommend")

PAGE_SIZE = 1000


class NotConfiguredError(RuntimeError):
    """Raised when backend/.env is missing Supabase settings."""


def is_configured() -> bool:
    return bool(config.SUPABASE_URL and config.SUPABASE_SERVICE_ROLE_KEY)


@lru_cache(maxsize=1)
def client():
    """Return a shared Supabase client (created on first use)."""
    if not is_configured():
        raise NotConfiguredError(
            "Supabase is not configured. Copy backend/.env.example to backend/.env and add your keys."
        )
    from supabase import create_client

    return create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)


def _fetch_all(table: str, columns: str = "*", **eq) -> list[dict]:
    """Read every row of a table in pages of 1000 (PostgREST's limit)."""
    rows, start = [], 0
    while True:
        query = client().table(table).select(columns)
        for key, value in eq.items():
            query = query.eq(key, value)
        batch = query.range(start, start + PAGE_SIZE - 1).execute().data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            return rows
        start += PAGE_SIZE


# ---------- auth ----------
def user_from_token(token: str):
    """Verify a Supabase access token and return the user, or None.

    A rejected token (expired / invalid) returns None at once. A network or
    server hiccup talking to Supabase is retried once, so a blip doesn't log
    the user out.
    """
    from supabase_auth.errors import AuthApiError

    for attempt in range(2):
        try:
            response = client().auth.get_user(token)
            return response.user if response else None
        except NotConfiguredError:
            raise
        except AuthApiError as exc:
            if getattr(exc, "status", 0) and exc.status < 500:
                log.info("Rejected access token: %s", exc)
                return None
            log.warning("Supabase auth error (attempt %d): %s", attempt + 1, exc)
        except Exception as exc:
            log.warning("Could not verify token with Supabase (attempt %d): %r", attempt + 1, exc)
    return None


# ---------- items ----------
def fetch_items() -> list[dict]:
    return _fetch_all("items", "id,title,category,description,tags,rating,image_url,source")


def count(table: str) -> int:
    response = client().table(table).select("id", count="exact").limit(1).execute()
    return response.count or 0


def insert_items(items: list[dict]) -> tuple[int, int]:
    """Insert items, skipping ones whose (title, category) already exists.

    Returns (inserted, skipped_as_duplicate). The unique index on
    (lower(title), category) is an expression index, so we de-duplicate
    here instead of relying on PostgREST's on_conflict.
    """
    existing = {
        (row["title"].strip().lower(), row["category"])
        for row in _fetch_all("items", "title,category")
    }
    fresh, seen = [], set()
    for item in items:
        key = (item["title"].strip().lower(), item["category"])
        if key in existing or key in seen:
            continue
        seen.add(key)
        fresh.append(item)
    for start in range(0, len(fresh), 500):
        client().table("items").insert(fresh[start:start + 500]).execute()
    return len(fresh), len(items) - len(fresh)


def backfill_images(items: list[dict]) -> int:
    """Give existing items without an image the image_url from `items`. Returns rows updated."""
    wanted = {
        (item["title"].strip().lower(), item["category"]): item["image_url"]
        for item in items if item.get("image_url")
    }
    updated = 0
    for row in _fetch_all("items", "id,title,category,image_url"):
        if row.get("image_url"):
            continue
        url = wanted.get((row["title"].strip().lower(), row["category"]))
        if url:
            client().table("items").update({"image_url": url}).eq("id", row["id"]).execute()
            updated += 1
    return updated


def list_users() -> list[dict]:
    """Admin view: every profile with how many interactions it has (no emails, no passwords)."""
    profiles = _fetch_all("profiles", "id,name,username,interests,is_admin,created_at")
    counts: dict[str, int] = {}
    for row in _fetch_all("interactions", "user_id"):
        counts[row["user_id"]] = counts.get(row["user_id"], 0) + 1
    for profile in profiles:
        profile["interactions"] = counts.get(profile["id"], 0)
    return sorted(profiles, key=lambda p: p.get("created_at") or "", reverse=True)


def delete_items(ids: list[int]) -> None:
    for start in range(0, len(ids), 200):
        client().table("items").delete().in_("id", ids[start:start + 200]).execute()


def delete_items_by_source(source: str) -> None:
    client().table("items").delete().eq("source", source).execute()


# ---------- personal data (always scoped by a verified user_id) ----------
def get_profile(user_id: str) -> dict:
    rows = client().table("profiles").select("*").eq("id", user_id).limit(1).execute().data
    return rows[0] if rows else {"id": user_id, "name": "", "interests": [], "is_admin": False}


def get_interactions(user_id: str) -> list[dict]:
    return _fetch_all("interactions", "item_id,action,created_at", user_id=user_id)


def get_searches(user_id: str, limit: int = 30) -> list[dict]:
    return (
        client().table("searches").select("query,category,created_at")
        .eq("user_id", user_id).order("created_at", desc=True).limit(limit).execute().data or []
    )


def log_import(summary: dict, user_id: str) -> None:
    try:
        client().table("imports").insert({
            "filename": summary["filename"], "category": summary.get("category"),
            "rows_read": summary["rows_read"], "imported": summary["imported"],
            "skipped": summary["skipped"], "created_by": user_id,
        }).execute()
    except Exception:
        pass  # logging an import must never break the import itself


def recent_imports(limit: int = 10) -> list[dict]:
    return (
        client().table("imports").select("*").order("created_at", desc=True)
        .limit(limit).execute().data or []
    )
