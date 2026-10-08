"""Create demo CSVs and seed Supabase.

    python seed.py                 # write data/*.csv (if missing) and seed items if the table is empty
    python seed.py --demo-users    # also create the Rahul & Priya demo accounts with history

The app also calls `ensure_seeded()` on startup, so a fresh project fills itself.
"""
from __future__ import annotations

import argparse
import csv
import sys

import config
import importer
import supabase_client as db
from demo_data import CATALOG

DEMO_USERS = {
    "rahul": {
        "email": "rahul@edrecommend.demo", "name": "Rahul",
        "interests": ["Python", "AI", "Programming"],
        "like": ["Python for Everybody", "Machine Learning Specialization", "Python Crash Course",
                 "Ex Machina", "Machine Learning Engineer", "PyTorch"],
        "save": ["Hands-On Machine Learning with Scikit-Learn, Keras, and TensorFlow", "Human Resource Machine"],
        "dislike": ["Salt, Fat, Acid, Heat", "Cooking for Busy Healthy People", "Ratatouille", "Overcooked! 2"],
        "view": ["The Imitation Game", "FastAPI", "Data Scientist"],
        "search": ["python projects", "machine learning"],
    },
    "priya": {
        "email": "priya@edrecommend.demo", "name": "Priya",
        "interests": ["Movies", "Books", "Psychology"],
        "like": ["Inside Out", "Thinking, Fast and Slow", "Good Will Hunting", "Atomic Habits",
                 "Her", "The Science of Well-Being"],
        "save": ["Man's Search for Meaning", "Whiplash"],
        "dislike": ["Kubernetes", "Factorio"],
        "view": ["A Beautiful Mind", "Clinical Psychologist", "Headspace"],
        "search": ["psychology books", "feel good movies"],
    },
}


def csv_path(category: str):
    return config.DATA_DIR / f"{category.lower()}.csv"


def write_demo_csvs() -> None:
    """Recreate data/<category>.csv from the small built-in catalog if a file was deleted.

    The project ships full 135-row datasets in data/; this is only a fallback.
    """
    config.DATA_DIR.mkdir(exist_ok=True)
    for category, rows in CATALOG.items():
        path = csv_path(category)
        if path.exists():
            continue
        with path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(["title", "category", "description", "tags", "rating", "image_url"])
            for title, description, tags, rating in rows:
                writer.writerow([title, category, description, tags, rating, ""])
        print(f"  wrote {path.relative_to(config.ROOT_DIR)}")


def dataset_files() -> list:
    """Every CSV in data/, built-in categories first."""
    write_demo_csvs()
    builtin = [csv_path(c) for c in CATALOG]
    extra = sorted(p for p in config.DATA_DIR.glob("*.csv") if p not in builtin)
    return [p for p in builtin if p.exists()] + extra


def is_builtin(path) -> bool:
    return path.stem.title() in CATALOG


def read_dataset(path) -> tuple[list[dict], dict]:
    """Read one data/*.csv through the normal importer (same validation path as uploads).

    Built-in category files are tagged source="demo" so "Reset demo data" can reload them.
    """
    rows, summary = importer.normalise(path.read_bytes(), path.name, path.stem.replace("_", " ").title())
    source = "demo" if is_builtin(path) else f"dataset:{path.name}"[:120]
    for row in rows:
        row["source"] = source
    return rows, summary


def demo_items() -> list[dict]:
    items = []
    for path in dataset_files():
        if is_builtin(path):
            items.extend(read_dataset(path)[0])
    return items


def seed_demo_items() -> int:
    inserted, _ = db.insert_items(demo_items())
    return inserted


def sync_datasets() -> dict:
    """Load every data/*.csv into the catalog.

    New rows are inserted (duplicates by title+category are skipped) and
    existing items that have no image get the image URL from the CSV.
    Safe to run repeatedly — it is what runs on every startup.
    """
    files, all_items = [], []
    for path in dataset_files():
        try:
            rows, _ = read_dataset(path)
        except importer.ImportError_ as exc:
            files.append({"file": path.name, "error": str(exc)})
            continue
        files.append({"file": path.name, "rows": len(rows)})
        all_items.extend(rows)
    inserted, _ = db.insert_items(all_items)
    images = db.backfill_images(all_items)
    return {"inserted": inserted, "images_added": images, "files": files}


def ensure_seeded() -> int:
    """Startup hook: sync data/*.csv into the catalog. Returns rows inserted."""
    return sync_datasets()["inserted"]


def _find_user(email: str):
    page = 1
    while True:
        users = db.client().auth.admin.list_users(page=page, per_page=200)
        for user in users:
            if (user.email or "").lower() == email:
                return user
        if len(users) < 200:
            return None
        page += 1


def create_demo_users() -> None:
    """Create Rahul and Priya with interests and a realistic interaction history."""
    if not config.DEMO_PASSWORD or len(config.DEMO_PASSWORD) < 6:
        sys.exit("Set DEMO_PASSWORD (6+ characters) in backend/.env first.")
    items = db._fetch_all("items", "id,title")
    by_title = {row["title"]: row["id"] for row in items}
    for key, spec in DEMO_USERS.items():
        user = _find_user(spec["email"])
        if user is None:
            user = db.client().auth.admin.create_user({
                "email": spec["email"], "password": config.DEMO_PASSWORD,
                "email_confirm": True, "user_metadata": {"name": spec["name"]},
            }).user
        uid = user.id
        db.client().table("profiles").upsert({
            "id": uid, "name": spec["name"], "username": key,
            "interests": spec["interests"], "onboarded": True,
        }).execute()
        db.client().table("interactions").delete().eq("user_id", uid).execute()
        db.client().table("searches").delete().eq("user_id", uid).execute()
        rows = [{"user_id": uid, "item_id": by_title[t], "action": action}
                for action in ("view", "save", "dislike", "like")
                for t in spec[action] if t in by_title]
        if rows:
            db.client().table("interactions").insert(rows).execute()
        db.client().table("searches").insert(
            [{"user_id": uid, "query": q, "category": "All"} for q in spec["search"]]).execute()
        print(f"  demo user ready: {spec['email']} ({len(rows)} interactions)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed EDRecommend demo data.")
    parser.add_argument("--demo-users", action="store_true", help="create Rahul & Priya demo accounts")
    args = parser.parse_args()
    if not db.is_configured():
        write_demo_csvs()
        sys.exit("CSVs written. Add Supabase keys to backend/.env to seed the database.")
    print(f"Seeded {ensure_seeded()} items.")
    if args.demo_users:
        create_demo_users()


if __name__ == "__main__":
    main()
