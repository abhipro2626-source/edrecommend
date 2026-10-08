"""EDRecommend recommendation engine.

1. Content-based: every item becomes a TF-IDF vector built from its title,
   description, tags and category. Cosine similarity measures how close two
   vectors are (1 = same direction, 0 = nothing in common).
2. Hybrid: the content score is blended with the user's personal signals
   using the transparent weights in config.py:

   final = W_CONTENT*content + W_PREFERENCE*preference + W_BEHAVIOUR*behaviour
         + W_RATING*rating + W_CATEGORY*category - W_DISLIKE*dislike

The TF-IDF matrix is cached in memory and rebuilt only when items change.
"""
from __future__ import annotations

import math
import re
import threading
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

import config


@dataclass
class UserContext:
    """Everything the engine knows about one user (already scoped to them)."""
    name: str = ""
    interests: list[str] = field(default_factory=list)
    interactions: list[dict] = field(default_factory=list)  # {item_id, action, created_at}
    searches: list[dict] = field(default_factory=list)      # {query, category, created_at}


@dataclass
class Signals:
    """User signals turned into vectors and lookups the scorer can use."""
    intent_vec: object = None      # recent searches (used when there is no query)
    pref_vec: object = None        # liked / saved items + stated interests
    behaviour_vec: object = None   # viewed / clicked items
    dislike_vec: object = None     # disliked items
    liked: list[int] = field(default_factory=list)     # most recent first
    saved: set[int] = field(default_factory=set)
    disliked: set[int] = field(default_factory=set)
    category_affinity: dict[str, float] = field(default_factory=dict)
    interest_terms: set[str] = field(default_factory=set)
    interest_labels: dict[str, str] = field(default_factory=dict)   # "ai" -> "AI"


def _decay(created_at, now: datetime) -> float:
    """Exponential time decay: recent actions count more."""
    if not created_at:
        return 1.0
    try:
        ts = pd.to_datetime(created_at, utc=True).to_pydatetime()
    except (ValueError, TypeError):
        return 1.0
    age_days = max((now - ts).total_seconds() / 86400, 0)
    return 0.5 ** (age_days / config.DECAY_HALF_LIFE_DAYS)


def _tags(value) -> list[str]:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return []
    if isinstance(value, str):
        return [t.strip() for t in re.split(r"[,|;]", value) if t.strip()]
    return [str(t).strip() for t in value if str(t).strip()]


class Recommender:
    """Holds the cached catalog + TF-IDF matrix and produces recommendations."""

    def __init__(self, loader=None, items: list[dict] | None = None):
        self._loader = loader
        self._lock = threading.Lock()
        self.df = pd.DataFrame()
        self.matrix = None
        self.vectorizer = None
        self.id_to_idx: dict[int, int] = {}
        if items is not None:
            self.rebuild(items)

    # ------------------------------------------------------------------ cache
    def ensure_loaded(self) -> None:
        if self.matrix is None and self._loader is not None:
            self.rebuild()

    def rebuild(self, items: list[dict] | None = None) -> int:
        """(Re)build the item DataFrame and TF-IDF matrix. Returns item count."""
        with self._lock:
            if items is None:
                items = self._loader() if self._loader else []
            df = pd.DataFrame(items, columns=["id", "title", "category", "description",
                                              "tags", "rating", "image_url", "source"])
            if df.empty:
                self.df, self.matrix, self.vectorizer, self.id_to_idx = df, None, None, {}
                return 0
            df["tags"] = df["tags"].apply(_tags)
            df["description"] = df["description"].fillna("")
            df["rating"] = pd.to_numeric(df["rating"], errors="coerce")
            df["norm_rating"] = self._normalise_ratings(df)
            docs = (df["title"] + " " + df["title"] + " " + df["description"] + " "
                    + df["tags"].str.join(" ") + " " + df["tags"].str.join(" ") + " " + df["category"])
            vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2),
                                         min_df=1, sublinear_tf=True)
            self.matrix = vectorizer.fit_transform(docs)
            self.vectorizer = vectorizer
            self.df = df.reset_index(drop=True)
            self.id_to_idx = {int(i): n for n, i in enumerate(self.df["id"])}
            return len(self.df)

    @staticmethod
    def _normalise_ratings(df: pd.DataFrame) -> pd.Series:
        """Scale ratings to 0..1 *within each category* (a 9/10 movie ≈ a 4.5/5 course)."""
        def scale(group: pd.Series) -> pd.Series:
            valid = group.dropna()
            if valid.empty:
                return pd.Series(0.5, index=group.index)
            top = valid.max()
            # Divide by the category's scale (5 or 10) so "4.9/5" is near 1.
            ceiling = 10.0 if top > 5 else 5.0
            return (group / ceiling).clip(0, 1).fillna(valid.median() / ceiling)
        return df.groupby("category")["rating"].transform(scale).fillna(0.5)

    @property
    def categories(self) -> list[str]:
        self.ensure_loaded()
        found = sorted(self.df["category"].unique()) if not self.df.empty else []
        ordered = [c for c in config.DEFAULT_CATEGORIES if c in found]
        return ordered + [c for c in found if c not in ordered]

    # ---------------------------------------------------------------- signals
    def _weighted_vec(self, weights: dict[int, float]):
        rows, vals = [], []
        for item_id, w in weights.items():
            if item_id in self.id_to_idx and w > 0:
                rows.append(self.id_to_idx[item_id])
                vals.append(w)
        if not rows:
            return None
        vec = sparse.csr_matrix(np.asarray(vals)) @ self.matrix[rows]
        return vec / max(sum(vals), 1e-9)

    def _text_vec(self, text: str):
        text = (text or "").strip()
        if not text:
            return None
        vec = self.vectorizer.transform([text])
        return vec if vec.nnz else None

    def build_signals(self, ctx: UserContext) -> Signals:
        """Turn raw interactions into profile vectors (with time decay)."""
        now = datetime.now(timezone.utc)
        pref, behaviour, dislike = defaultdict(float), defaultdict(float), defaultdict(float)
        cat_aff = defaultdict(float)
        state: dict[tuple[int, str], str] = {}
        liked_order = []
        for row in sorted(ctx.interactions, key=lambda r: str(r.get("created_at") or ""), reverse=True):
            item_id, action = int(row["item_id"]), row["action"]
            if item_id not in self.id_to_idx:
                continue
            w = config.ACTION_WEIGHTS.get(action, 0) * _decay(row.get("created_at"), now)
            if action in ("like", "save"):
                pref[item_id] += w
                if action == "like" and item_id not in liked_order:
                    liked_order.append(item_id)
            elif action in ("view", "click"):
                behaviour[item_id] += w
            elif action == "dislike":
                dislike[item_id] += -w
            category = self.df.at[self.id_to_idx[item_id], "category"]
            cat_aff[category] += w
            state[(item_id, action)] = action

        signals = Signals(
            liked=liked_order,
            saved={i for (i, a) in state if a == "save"},
            disliked={i for (i, a) in state if a == "dislike"},
        )
        # Stated interests count like a strong "like" written as text.
        interests_text = " ".join(ctx.interests)
        interest_vec = self._text_vec(interests_text)
        liked_vec = self._weighted_vec(pref)
        parts = [v for v in (liked_vec, interest_vec) if v is not None]
        signals.pref_vec = sum(parts[1:], parts[0]) / len(parts) if parts else None
        signals.behaviour_vec = self._weighted_vec(behaviour)
        signals.dislike_vec = self._weighted_vec(dislike)
        signals.intent_vec = self._text_vec(" ".join(s["query"] for s in ctx.searches[:5]))
        words = re.findall(r"[a-zA-Z+#]{2,}", interests_text)
        signals.interest_terms = {t.lower() for t in words}
        signals.interest_labels = {t.lower(): t for t in words}

        # Interests that name a category ("Games", "books") also lift that category.
        for category in self.categories:
            stem = category.lower().rstrip("s")
            if any(len(t) >= 4 and (t.startswith(stem[:4]) or stem in t) for t in signals.interest_terms):
                cat_aff[category] += 1.0
        top = max([v for v in cat_aff.values() if v > 0], default=0)
        signals.category_affinity = {c: max(v, 0) / top for c, v in cat_aff.items()} if top else {}
        return signals

    # ---------------------------------------------------------------- scoring
    def _similarity(self, vec) -> np.ndarray:
        if vec is None:
            return np.zeros(len(self.df))
        return cosine_similarity(vec, self.matrix).ravel()

    def query_categories(self, query: str) -> set[str]:
        """Categories a search names, e.g. "space movies" → {"Movies"}."""
        words = set(re.findall(r"[a-z]+", query.lower()))
        found = set()
        for category in self.categories:
            names = config.CATEGORY_WORDS.get(category, []) + [category.lower(), category.lower().rstrip("s")]
            if words & set(names):
                found.add(category)
        return found

    def score(self, ctx: UserContext, query: str = "", signals: Signals | None = None) -> pd.DataFrame:
        """Return a DataFrame with each score component and the final score."""
        signals = signals or self.build_signals(ctx)
        query_vec = self._text_vec(query)
        content = self._similarity(query_vec if query.strip() else signals.intent_vec)
        # A search that names a category ("space movies") should mostly return that category,
        # even when the user's history leans elsewhere.
        asked = self.query_categories(query) if query.strip() else set()
        category_bonus = config.W_QUERY_CATEGORY * self.df["category"].isin(asked).to_numpy() if asked else 0
        parts = pd.DataFrame({
            "content": config.W_CONTENT * content + category_bonus,
            "preference": config.W_PREFERENCE * self._similarity(signals.pref_vec),
            "behaviour": config.W_BEHAVIOUR * self._similarity(signals.behaviour_vec),
            "rating": config.W_RATING * self.df["norm_rating"].to_numpy(),
            "category": config.W_CATEGORY * self.df["category"].map(signals.category_affinity).fillna(0).to_numpy(),
            "penalty": -config.W_DISLIKE * self._similarity(signals.dislike_vec),
        })
        parts["raw_content"] = content
        parts["final"] = parts[["content", "preference", "behaviour", "rating", "category", "penalty"]].sum(axis=1)
        return parts

    @staticmethod
    def _match_percent(final: np.ndarray, top: float) -> np.ndarray:
        """Map scores to a friendly 0–100: part absolute strength, part rank vs the best."""
        absolute = 1 - np.exp(-4.0 * np.clip(final, 0, None))
        relative = np.clip(final, 0, None) / top if top > 0 else np.zeros_like(final)
        return np.clip(np.round(100 * (0.55 * absolute + 0.45 * relative)), 1, 99).astype(int)

    # ---------------------------------------------------------------- reasons
    def _matched_terms(self, idx: int, vec, limit: int = 3) -> list[str]:
        if vec is None:
            return []
        item_row = self.matrix[idx]
        shared = set(item_row.indices) & set(vec.indices)
        if not shared:
            return []
        names = self.vectorizer.get_feature_names_out()
        tag_text = " ".join(self.df.at[idx, "tags"]).lower()
        # Prefer words that are actual tags ("python") over incidental title words ("hands").
        ranked = sorted(shared, key=lambda j: (names[j] in tag_text, item_row[0, j]), reverse=True)
        terms = []
        for j in ranked:
            term = names[j]
            if " " in term or any(term in t or t in term for t in terms):
                continue
            terms.append(term)
            if len(terms) == limit:
                break
        return terms

    def _because_liked(self, idx: int, signals: Signals) -> str | None:
        anchors = [i for i in signals.liked[:20] + list(signals.saved) if i in self.id_to_idx]
        if not anchors:
            return None
        anchor_idx = [self.id_to_idx[i] for i in anchors]
        sims = cosine_similarity(self.matrix[idx], self.matrix[anchor_idx]).ravel()
        best = int(np.argmax(sims))
        if sims[best] < 0.08 or anchor_idx[best] == idx:
            return None
        return f"Because you liked {self.df.at[anchor_idx[best], 'title']}"

    def _reasons(self, idx: int, row: pd.Series, query_vec, signals: Signals) -> list[str]:
        reasons = []
        if query_vec is not None:
            terms = self._matched_terms(idx, query_vec)
            if terms:
                reasons.append("Matches: " + ", ".join(terms))
        because = self._because_liked(idx, signals)
        if because:
            reasons.append(because)
        if len(reasons) < 2 and signals.interest_terms:
            tags = {t.lower() for t in self.df.at[idx, "tags"]}
            hits = [i for i in signals.interest_terms if any(i == t or i in t.split() for t in tags)]
            if hits:
                reasons.append(f"Fits your interest in {signals.interest_labels.get(hits[0], hits[0])}")
        if len(reasons) < 2 and self.df.at[idx, "norm_rating"] >= 0.86:
            reasons.append(f"Highly rated in {self.df.at[idx, 'category']}")
        if len(reasons) < 2 and row["category"] > config.W_CATEGORY * 0.7:
            reasons.append(f"You often explore {self.df.at[idx, 'category']}")
        return reasons[:2] or ["Popular pick to explore"]

    def _to_item(self, idx: int, row: pd.Series, match: int, query_vec, signals: Signals,
                 reasons: list[str] | None = None) -> dict:
        item = self.df.iloc[idx]
        return {
            "id": int(item["id"]),
            "title": item["title"],
            "category": item["category"],
            "description": item["description"],
            "tags": list(item["tags"]),
            "rating": None if pd.isna(item["rating"]) else float(item["rating"]),
            "image_url": item["image_url"] if isinstance(item["image_url"], str) and item["image_url"] else None,
            "match_percent": int(match),
            "reasons": reasons or self._reasons(idx, row, query_vec, signals),
            "breakdown": {k: round(float(row[k]), 4) for k in
                          ("content", "preference", "behaviour", "rating", "category", "penalty")},
            "liked": int(item["id"]) in signals.liked,
            "saved": int(item["id"]) in signals.saved,
        }

    # ---------------------------------------------------------------- public
    def recommend(self, ctx: UserContext, query: str = "", category: str = "All",
                  limit: int = config.DEFAULT_LIMIT, offset: int = 0,
                  discover: bool = False, diverse: bool = False,
                  signals: Signals | None = None, exclude: set[int] | None = None) -> dict:
        """Ranked items for a query (or for the user's profile when query is empty)."""
        self.ensure_loaded()
        if self.df.empty:
            return {"items": [], "total": 0}
        signals = signals or self.build_signals(ctx)
        scores = self.score(ctx, query, signals)
        mask = ~self.df["id"].isin(signals.disliked | (exclude or set()))   # never show dislikes
        if category and category != "All":
            mask &= self.df["category"].str.lower() == category.lower()
        if query.strip():
            mask &= scores["raw_content"] > 0.01   # a search must actually match
        final = scores["final"].copy()
        if discover:   # push things the user already liked/saved further down
            seen = self.df["id"].isin(set(signals.liked) | signals.saved)
            final[seen] *= 0.4
        candidates = final[mask].sort_values(ascending=False)
        if diverse:
            candidates = self._diversify(candidates, limit + offset)
        total = len(candidates)
        page = candidates.iloc[offset:offset + limit]
        top = float(candidates.iloc[0]) if total else 0.0
        matches = self._match_percent(page.to_numpy(), top)
        query_vec = self._text_vec(query) if query.strip() else signals.intent_vec
        items = [self._to_item(idx, scores.loc[idx], m, query_vec, signals)
                 for idx, m in zip(page.index, matches)]
        return {"items": items, "total": total}

    def _diversify(self, ranked: pd.Series, size: int) -> pd.Series:
        """Greedy re-rank for variety.

        Each extra item from an already-picked category is discounted (×0.85
        per repeat), and no category may exceed MAX_CATEGORY_SHARE of the top
        `size`. The rest keep their original order after the picked ones.
        """
        cap = max(1, math.ceil(size * config.MAX_CATEGORY_SHARE))
        pool = list(ranked.head(size * 4).index)
        counts, picked = Counter(), []
        while pool and len(picked) < size:
            best = max((i for i in pool if counts[self.df.at[i, "category"]] < cap),
                       key=lambda i: ranked[i] * 0.85 ** counts[self.df.at[i, "category"]],
                       default=None)
            if best is None:
                break
            pool.remove(best)
            picked.append(best)
            counts[self.df.at[best, "category"]] += 1
        rest = [i for i in ranked.index if i not in set(picked)]
        return ranked.loc[picked + rest]

    def similar(self, item_id: int, ctx: UserContext, limit: int = 12,
                signals: Signals | None = None) -> list[dict]:
        """'More like this': items closest to one item, nudged by the user's taste."""
        self.ensure_loaded()
        if item_id not in self.id_to_idx:
            return []
        signals = signals or self.build_signals(ctx)
        idx = self.id_to_idx[item_id]
        sim = cosine_similarity(self.matrix[idx], self.matrix).ravel()
        scores = self.score(ctx, "", signals)
        scores["content"] = config.W_CONTENT * sim
        scores["final"] = scores[["content", "preference", "behaviour", "rating", "category", "penalty"]].sum(axis=1)
        mask = (~self.df["id"].isin(signals.disliked | {item_id})) & (sim > 0.02)
        ranked = scores["final"][mask].sort_values(ascending=False).head(limit)
        if ranked.empty:
            return []
        matches = self._match_percent(ranked.to_numpy(), float(ranked.iloc[0]))
        title = self.df.at[idx, "title"]
        out = []
        for j, m in zip(ranked.index, matches):
            terms = self._matched_terms(j, self.matrix[idx], 2)
            reasons = [f"Similar to {title}"] + (["Shares: " + ", ".join(terms)] if terms else [])
            out.append(self._to_item(j, scores.loc[j], m, None, signals, reasons))
        return out

    def made_for_you(self, ctx: UserContext, popularity: dict[int, int] | None = None) -> list[dict]:
        """Personalised rows for the home screen."""
        self.ensure_loaded()
        if self.df.empty:
            return []
        signals = self.build_signals(ctx)
        name = ctx.name or "you"
        rows = [{
            "id": "top", "title": f"Top Picks for {name}",
            "items": self.recommend(ctx, limit=16, discover=True, diverse=True, signals=signals)["items"],
        }]

        if signals.liked:
            anchor = signals.liked[0]
            title = self.df.at[self.id_to_idx[anchor], "title"]
            items = [i for i in self.similar(anchor, ctx, 12, signals) if not i["liked"]]
            for i in items:
                i["reasons"] = [f"Because you liked {title}"] + i["reasons"][1:]
            if items:
                rows.append({"id": "because", "title": f"Because you liked {title}", "items": items})

        favourite = max(signals.category_affinity, key=signals.category_affinity.get) \
            if signals.category_affinity else None
        if favourite:
            trending = self.recommend(ctx, category=favourite, limit=40, signals=signals)["items"]
            pop = popularity or {}
            top_pop = max(pop.values(), default=0) or 1
            trending.sort(key=lambda i: 0.5 * pop.get(i["id"], 0) / top_pop + 0.5 * i["match_percent"] / 100,
                          reverse=True)
            if trending:
                rows.append({"id": "trending", "title": f"Trending in {favourite}", "items": trending[:12]})

        explored = {c for c, v in signals.category_affinity.items() if v > 0}
        fresh_df = self.df[~self.df["category"].isin(explored) & ~self.df["id"].isin(signals.disliked)]
        if not fresh_df.empty:
            scores = self.score(ctx, "", signals)
            fresh = (0.6 * fresh_df["norm_rating"] + scores.loc[fresh_df.index, "final"]).sort_values(ascending=False)
            fresh = self._diversify(fresh, 12).head(12)
            matches = self._match_percent(scores.loc[fresh.index, "final"].to_numpy(),
                                          float(scores["final"].max()))
            items = [self._to_item(j, scores.loc[j], m, None, signals,
                                   [f"Something new in {self.df.at[j, 'category']}",
                                    f"Rated {self.df.at[j, 'rating']:g}" if pd.notna(self.df.at[j, 'rating']) else "Fresh pick"])
                     for j, m in zip(fresh.index, matches)]
            rows.append({"id": "new", "title": "Something new", "items": items})
        return [r for r in rows if r["items"]]

    def taste(self, ctx: UserContext) -> dict:
        """Category affinity (for the radar chart) and weighted top tags."""
        self.ensure_loaded()
        signals = self.build_signals(ctx)
        tag_weights: Counter = Counter()
        now = datetime.now(timezone.utc)
        for row in ctx.interactions:
            idx = self.id_to_idx.get(int(row["item_id"]))
            w = config.ACTION_WEIGHTS.get(row["action"], 0)
            if idx is None or w <= 0:
                continue
            for tag in self.df.at[idx, "tags"]:
                tag_weights[tag.lower()] += w * _decay(row.get("created_at"), now)
        for interest in ctx.interests:
            tag_weights[interest.lower()] += 1.0
        top = tag_weights.most_common(16)
        peak = top[0][1] if top else 1
        return {
            "categories": [{"name": c, "value": round(signals.category_affinity.get(c, 0) * 100)}
                           for c in self.categories],
            "tags": [{"tag": t, "weight": round(w / peak, 2)} for t, w in top],
        }

    def duplicate_ids(self) -> list[int]:
        """Ids of items whose (normalised title, category) already appeared earlier."""
        self.ensure_loaded()
        if self.df.empty:
            return []
        key = self.df["title"].str.strip().str.lower().str.replace(r"\s+", " ", regex=True) + "|" + self.df["category"]
        return [int(i) for i in self.df.loc[key.duplicated(), "id"]]
