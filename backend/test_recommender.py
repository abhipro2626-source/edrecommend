"""Tests for the recommendation engine (no Supabase needed).

    cd backend && pytest -q
"""
import pytest

from demo_data import CATALOG
from recommender import Recommender, UserContext
import importer


@pytest.fixture(scope="module")
def engine():
    items, next_id = [], 1
    for category, rows in CATALOG.items():
        for title, description, tags, rating in rows:
            items.append({"id": next_id, "title": title, "category": category, "description": description,
                          "tags": tags, "rating": rating, "image_url": None, "source": "demo"})
            next_id += 1
    return Recommender(items=items)


def id_of(engine, title):
    return int(engine.df.loc[engine.df["title"] == title, "id"].iloc[0])


def titles(result):
    return [i["title"] for i in result["items"]]


def test_python_query_ranks_python_course_above_cooking(engine):
    ranked = titles(engine.recommend(UserContext(), "python programming", limit=200))
    assert "Python for Everybody" in ranked
    cooking = [t for t in ranked if t in ("Cooking for Busy Healthy People", "Salt, Fat, Acid, Heat")]
    assert all(ranked.index("Python for Everybody") < ranked.index(t) for t in cooking)


def test_disliked_items_are_excluded(engine):
    target = id_of(engine, "Python for Everybody")
    ctx = UserContext(interactions=[{"item_id": target, "action": "dislike", "created_at": None}])
    assert "Python for Everybody" not in titles(engine.recommend(ctx, "python", limit=200))
    assert all(i["id"] != target for row in engine.made_for_you(ctx) for i in row["items"])


def test_two_users_get_different_made_for_you(engine):
    rahul = UserContext(name="Rahul", interests=["Python", "AI"], interactions=[
        {"item_id": id_of(engine, t), "action": "like", "created_at": None}
        for t in ("Python Crash Course", "Machine Learning Specialization", "Ex Machina")])
    priya = UserContext(name="Priya", interests=["Psychology", "Movies"], interactions=[
        {"item_id": id_of(engine, t), "action": "like", "created_at": None}
        for t in ("Inside Out", "Thinking, Fast and Slow", "Good Will Hunting")])
    rahul_top = [i["title"] for i in engine.made_for_you(rahul)[0]["items"][:8]]
    priya_top = [i["title"] for i in engine.made_for_you(priya)[0]["items"][:8]]
    assert rahul_top != priya_top
    assert len(set(rahul_top) & set(priya_top)) <= 2


def test_every_result_explains_itself(engine):
    for item in engine.recommend(UserContext(), "space", limit=10)["items"]:
        assert item["reasons"] and 1 <= item["match_percent"] <= 99


def test_cold_start_returns_top_rated(engine):
    items = engine.recommend(UserContext(), limit=10)["items"]
    assert len(items) == 10


def test_cross_category_ai(engine):
    categories = {i["category"] for i in engine.recommend(UserContext(), "artificial intelligence", limit=30)["items"]}
    assert len(categories) >= 4


def test_importer_maps_synonyms():
    raw = b"movie_title,overview,genres,vote_average\nAlien,Crew meets creature,Horror|Sci-Fi,8.5\n,missing,,\n"
    items, summary = importer.normalise(raw, "films.csv", "Movies")
    assert summary["rows_read"] == 2 and len(items) == 1
    assert items[0]["tags"] == ["Horror", "Sci-Fi"] and items[0]["rating"] == 8.5


def test_importer_requires_title():
    with pytest.raises(importer.ImportError_):
        importer.normalise(b"foo,bar\n1,2\n", "bad.csv", "Movies")
