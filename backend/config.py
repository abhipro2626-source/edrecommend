"""Central settings for EDRecommend.

Every number that shapes a recommendation lives here so the engine stays
transparent: change a weight, restart, and see the effect.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
FRONTEND_DIR = ROOT_DIR / "frontend"
DATA_DIR = ROOT_DIR / "data"

load_dotenv(BASE_DIR / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "").strip()

# ---- Hybrid score weights (see recommender.py) ----
W_CONTENT = 0.45      # how well the item matches the search text
W_PREFERENCE = 0.25   # similarity to what the user liked / saved / said they like
W_BEHAVIOUR = 0.10    # views, clicks and searches (time-decayed)
W_RATING = 0.10       # item rating, normalised per category
W_CATEGORY = 0.10     # how much the user engages with this category
W_DISLIKE = 0.30      # penalty: similarity to disliked items
W_QUERY_CATEGORY = 0.25  # bonus when the search names a category ("space movies", "python course")

# Words in a search that mean "I want this category". Imported categories also match their own name.
CATEGORY_WORDS = {
    "Movies": ["movie", "movies", "film", "films", "cinema"],
    "Books": ["book", "books", "novel", "novels", "read", "reading"],
    "Courses": ["course", "courses", "class", "classes", "tutorial", "tutorials", "lecture", "lectures"],
    "Jobs": ["job", "jobs", "career", "careers", "internship", "internships"],
    "Apps": ["app", "apps", "application", "applications"],
    "Games": ["game", "games", "gaming"],
    "Technology": ["technology", "technologies", "tech", "framework", "frameworks", "library", "libraries"],
}

# ---- Interaction signal strengths for the user profile vector ----
ACTION_WEIGHTS = {"like": 1.0, "save": 0.8, "view": 0.3, "click": 0.2, "dislike": -1.0}
DECAY_HALF_LIFE_DAYS = 14   # an action loses half its weight every two weeks

# ---- Misc ----
MAX_CATEGORY_SHARE = 0.4    # diversity: max share of one category in "Top Picks"
DEFAULT_LIMIT = 24
MAX_UPLOAD_MB = 10
DEFAULT_CATEGORIES = ["Movies", "Books", "Courses", "Jobs", "Apps", "Games", "Technology"]
