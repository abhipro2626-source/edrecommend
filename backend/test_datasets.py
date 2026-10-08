"""Checks for the shipped datasets in data/ (no Supabase needed).

    cd backend && pytest -q
"""
import pytest

import config
import seed
from recommender import Recommender

BUILTIN = config.DEFAULT_CATEGORIES


@pytest.mark.parametrize("category", BUILTIN)
def test_each_category_has_135_valid_rows(category):
    rows, summary = seed.read_dataset(seed.csv_path(category))
    assert len(rows) == 135
    assert summary["skip_reasons"] == {}
    assert summary["invalid_ratings"] == 0
    assert {r["category"] for r in rows} == {category}
    assert all(r["description"] and r["tags"] for r in rows)
    assert len({r["title"].lower() for r in rows}) == 135, "duplicate titles"


@pytest.mark.parametrize("category", [c for c in BUILTIN if c != "Courses"])
def test_categories_have_images(category):
    rows, _ = seed.read_dataset(seed.csv_path(category))
    with_image = [r for r in rows if r["image_url"]]
    assert len(with_image) >= 120, f"only {len(with_image)} images"
    assert all(r["image_url"].startswith("https://") for r in with_image)


def test_courses_have_no_images():
    rows, _ = seed.read_dataset(seed.csv_path("Courses"))
    assert not any(r["image_url"] for r in rows)


def test_demo_users_reference_real_items():
    titles = {r["title"] for r in seed.demo_items()}
    for spec in seed.DEMO_USERS.values():
        for action in ("like", "save", "dislike", "view"):
            missing = [t for t in spec[action] if t not in titles]
            assert not missing, f"{action}: {missing}"


def test_engine_on_full_catalog():
    items = [{**row, "id": i} for i, row in enumerate(seed.demo_items(), start=1)]
    engine = Recommender(items=items)
    assert len(engine.df) == 135 * len(BUILTIN)
    assert engine.categories == BUILTIN
