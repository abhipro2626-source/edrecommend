"""CSV → normalised EDRecommend items, using pandas.

Accepts messy real-world CSVs: column names are normalised and common
synonyms (movie_title, genres, vote_average, poster…) are mapped onto the
item schema. Every skipped row is counted with a human-readable reason.
"""
from __future__ import annotations

import io
import re
from collections import Counter

import pandas as pd

SYNONYMS = {
    "title": ["title", "name", "movie_title", "book_title", "course_name", "course_title",
              "job_title", "app_name", "game_name", "product_name"],
    "description": ["description", "summary", "overview", "plot", "about", "details", "synopsis"],
    "tags": ["tags", "genre", "genres", "keywords", "skills", "topics", "subjects"],
    "category": ["category", "type"],
    "rating": ["rating", "score", "vote_average", "stars", "average_rating", "avg_rating"],
    "image_url": ["image", "image_url", "poster", "poster_url", "thumbnail", "cover", "cover_url"],
}


class ImportError_(ValueError):
    """A friendly, user-facing import problem."""


def _normalise_column(name: str) -> str:
    return re.sub(r"\s+", "_", str(name).strip().lower())


def read_csv(raw: bytes) -> pd.DataFrame:
    """Read bytes as CSV, trying UTF-8 first and latin-1 as a fallback."""
    if not raw or not raw.strip():
        raise ImportError_("This file is empty.")
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            return pd.read_csv(io.BytesIO(raw), encoding=encoding, dtype=str,
                               keep_default_na=False, on_bad_lines="skip")
        except UnicodeDecodeError:
            continue
        except (pd.errors.ParserError, pd.errors.EmptyDataError) as exc:
            raise ImportError_("This doesn't look like a valid CSV file.") from exc
    raise ImportError_("Couldn't read this file's text encoding.")


def map_columns(df: pd.DataFrame) -> dict[str, str]:
    """Return {schema_field: csv_column} for every field we could find."""
    columns = {_normalise_column(c): c for c in df.columns}
    mapping = {}
    for field, names in SYNONYMS.items():
        for name in names:
            if name in columns:
                mapping[field] = columns[name]
                break
    return mapping


def split_tags(value: str) -> list[str]:
    tags = [t.strip().strip("[]'\"") for t in re.split(r"[,|;]", value or "")]
    unique = []
    for tag in tags:
        if tag and tag.lower() not in (u.lower() for u in unique):
            unique.append(tag[:40])
    return unique[:15]


def parse_rating(value: str):
    try:
        rating = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return round(rating, 2) if 0 <= rating <= 100 else None


def normalise(raw: bytes, filename: str, default_category: str | None) -> tuple[list[dict], dict]:
    """Validate a CSV and return (items, summary)."""
    df = read_csv(raw)
    mapping = map_columns(df)
    if "title" not in mapping:
        raise ImportError_("This dataset is missing a title column (e.g. title, name, movie_title).")
    if "category" not in mapping and not default_category:
        raise ImportError_("This dataset has no category column — pick a category in the import dialog.")

    skipped: Counter = Counter()
    invalid_ratings = 0
    items = []
    source = f"import:{filename}"[:120]
    for _, row in df.iterrows():
        title = str(row.get(mapping["title"], "")).strip()
        if not title:
            skipped["missing title"] += 1
            continue
        category = str(row.get(mapping.get("category", ""), "")).strip() if "category" in mapping else ""
        category = (category or default_category or "").strip().title()
        if not category:
            skipped["missing category"] += 1
            continue
        rating = None
        if "rating" in mapping and str(row[mapping["rating"]]).strip():
            rating = parse_rating(row[mapping["rating"]])
            if rating is None:
                invalid_ratings += 1
        image = str(row.get(mapping.get("image_url", ""), "")).strip() if "image_url" in mapping else ""
        items.append({
            "title": title[:300],
            "category": category[:60],
            "description": str(row.get(mapping.get("description", ""), "")).strip()[:4000]
            if "description" in mapping else "",
            "tags": split_tags(row[mapping["tags"]]) if "tags" in mapping else [],
            "rating": rating,
            "image_url": image if image.startswith(("http://", "https://")) else None,
            "source": source,
        })

    summary = {
        "filename": filename,
        "category": default_category,
        "rows_read": int(len(df)),
        "valid": len(items),
        "columns": mapping,
        "invalid_ratings": invalid_ratings,
        "skip_reasons": dict(skipped),
    }
    return items, summary
