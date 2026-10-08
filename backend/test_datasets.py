"""Checks for the shipped datasets in data/ (no Supabase needed).

    cd backend && pytest -q
"""
import pytest

import config
import seed
from recommender import Recommender, UserContext

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


@pytest.fixture(scope="module")
def full_engine():
    items = [{**row, "id": i} for i, row in enumerate(seed.demo_items(), start=1)]
    return Recommender(items=items)


def _liked(engine, title):
    item_id = int(engine.df.loc[engine.df["title"] == title, "id"].iloc[0])
    return UserContext(interactions=[{"item_id": item_id, "action": "like", "created_at": None}])


@pytest.mark.parametrize("query,category", [
    ("space movies", "Movies"), ("python course", "Courses"), ("psychology books", "Books"),
    ("data science jobs", "Jobs"), ("puzzle games", "Games"),
])
def test_search_naming_a_category_returns_that_category(full_engine, query, category):
    # A games fan (liked Red Dead Redemption 2) still gets the category they asked for.
    ctx = _liked(full_engine, "Red Dead Redemption 2")
    top = full_engine.recommend(ctx, query, limit=8)["items"]
    assert [i["category"] for i in top].count(category) >= 7, [(i["title"], i["category"]) for i in top]


def test_search_without_category_word_stays_mixed(full_engine):
    top = full_engine.recommend(UserContext(), "artificial intelligence", limit=20)["items"]
    assert len({i["category"] for i in top}) >= 3
