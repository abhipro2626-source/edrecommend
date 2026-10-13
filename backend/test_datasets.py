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


def _ctx(engine, *pairs):
    rows = []
    for title, action in pairs:
        item_id = int(engine.df.loc[engine.df["title"] == title, "id"].iloc[0])
        rows.append({"item_id": item_id, "action": action, "created_at": None})
    return UserContext(name="Rahul", interactions=rows)


def test_home_rows_follow_the_brief_order(full_engine):
    ctx = _ctx(full_engine, ("Interstellar", "love"), ("Python Crash Course", "like"),
               ("Cosmos", "save"), ("The Martian", "view"))
    home = full_engine.home(ctx, {})
    ids = [r["id"] for r in home["rows"]]
    assert ids[:5] == ["top", "because-0", "because-1", "top10", "universe"]
    assert {"continue", "mylist"} <= set(ids)
    assert 1 <= len(home["hero"]) <= 3 and all(h["image_url"] for h in home["hero"])
    top10 = next(r for r in home["rows"] if r["id"] == "top10")
    assert [i["rank"] for i in top10["items"]] == list(range(1, 11))
    universe = next(r for r in home["rows"] if r["id"] == "universe")
    assert "Movies" not in {i["category"] for i in universe["items"]}      # anchor was a movie
    assert len({i["category"] for i in universe["items"]}) >= 3


def test_love_counts_more_than_like(full_engine):
    loved = full_engine.build_signals(_ctx(full_engine, ("Interstellar", "love")))
    liked = full_engine.build_signals(_ctx(full_engine, ("Interstellar", "like")))
    assert loved.liked == liked.liked and loved.loved and not liked.loved
    item = full_engine.home(_ctx(full_engine, ("Interstellar", "love")), {})["rows"][0]["items"][0]
    assert "loved" in item and "liked" in item


def test_category_page(full_engine):
    page = full_engine.category_page(_ctx(full_engine, ("Interstellar", "like")), "movies", {})
    assert page["category"] == "Movies" and page["tags"]
    assert all(i["category"] == "Movies" for r in page["rows"] for i in r["items"])
    assert [r["id"] for r in page["rows"]][:3] == ["picks", "because", "top-rated"]
    assert full_engine.category_page(UserContext(), "nope", {})["category"] is None
