"""EDRecommend API + static frontend.

Run:  uvicorn app:app --reload   →   http://localhost:8000

Every personal endpoint verifies the Supabase JWT from the Authorization
header and uses the user id inside it. A user id sent by the browser is
never trusted.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import config
import importer
import seed
import supabase_client as db
from recommender import Recommender, UserContext

log = logging.getLogger("edrecommend")
app = FastAPI(title="EDRecommend", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
engine = Recommender(loader=db.fetch_items)


@app.middleware("http")
async def revalidate_frontend(request: Request, call_next):
    """Make browsers re-check frontend files on every load so edits (e.g. config.js) show up immediately."""
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache"
    return response
WEIGHTS = {"content": config.W_CONTENT, "preference": config.W_PREFERENCE, "behaviour": config.W_BEHAVIOUR,
           "rating": config.W_RATING, "category": config.W_CATEGORY, "dislike": config.W_DISLIKE}


# ------------------------------------------------------------------ errors
class FriendlyError(Exception):
    def __init__(self, message: str, status: int = 400):
        self.message, self.status = message, status


@app.exception_handler(FriendlyError)
async def friendly_handler(_: Request, exc: FriendlyError):
    return JSONResponse({"error": exc.message}, status_code=exc.status)


@app.exception_handler(HTTPException)
async def http_handler(_: Request, exc: HTTPException):
    return JSONResponse({"error": str(exc.detail)}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    return JSONResponse({"error": "Some of the request data was invalid."}, status_code=422)


@app.exception_handler(db.NotConfiguredError)
async def not_configured_handler(_: Request, exc: db.NotConfiguredError):
    return JSONResponse({"error": str(exc)}, status_code=503)


@app.exception_handler(Exception)
async def fallback_handler(_: Request, exc: Exception):
    log.exception("Unhandled error")   # full detail in the server log, never in the browser
    return JSONResponse({"error": "Something went wrong on the server. Please try again."}, status_code=500)


# ------------------------------------------------------------------ auth
def current_user(authorization: str = Header(default="")) -> dict:
    """Verify the Supabase JWT and return {id, profile}."""
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise FriendlyError("Please log in first.", 401)
    user = db.user_from_token(token)
    if user is None:
        raise FriendlyError("Your session has expired. Please log in again.", 401)
    return {"id": user.id, "profile": db.get_profile(user.id)}


def admin_user(user: dict = Depends(current_user)) -> dict:
    if not user["profile"].get("is_admin"):
        raise FriendlyError("Admins only.", 403)
    return user


def user_context(user: dict) -> UserContext:
    profile = user["profile"]
    return UserContext(
        name=profile.get("name") or "",
        interests=profile.get("interests") or [],
        interactions=db.get_interactions(user["id"]),
        searches=db.get_searches(user["id"]),
    )


def popularity(days: int = 30) -> dict[int, int]:
    """Anonymous counts of recent positive interactions per item (no user ids leave this function)."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = (db.client().table("interactions").select("item_id")
            .in_("action", ["like", "save", "view"]).gte("created_at", since)
            .limit(5000).execute().data or [])
    counts: dict[int, int] = {}
    for row in rows:
        counts[row["item_id"]] = counts.get(row["item_id"], 0) + 1
    return counts


# ------------------------------------------------------------------ startup
@app.on_event("startup")
def startup() -> None:
    if not db.is_configured():
        log.warning("Supabase not configured — copy backend/.env.example to backend/.env")
        return
    try:
        inserted = seed.ensure_seeded()
        count = engine.rebuild()
        log.info("Catalog ready: %s items (%s newly seeded)", count, inserted)
    except Exception:
        log.exception("Could not load the catalog — did you run supabase/schema.sql?")


# ------------------------------------------------------------------ routes
class RecommendBody(BaseModel):
    query: str = Field(default="", max_length=300)
    category: str = Field(default="All", max_length=60)
    limit: int = Field(default=config.DEFAULT_LIMIT, ge=1, le=60)
    offset: int = Field(default=0, ge=0, le=5000)


@app.get("/api/health")
def health():
    if not db.is_configured():
        return {"status": "setup", "items": 0, "categories": [],
                "message": "Supabase keys missing in backend/.env"}
    try:
        engine.ensure_loaded()
    except Exception:
        return {"status": "degraded", "items": 0, "categories": [],
                "message": "Can't read the items table — run supabase/schema.sql."}
    counts = engine.df["category"].value_counts().to_dict() if len(engine.df) else {}
    return {"status": "ok", "items": len(engine.df), "categories": engine.categories,
            "category_counts": {c: int(counts.get(c, 0)) for c in engine.categories}, "weights": WEIGHTS}


@app.post("/api/recommend")
def recommend(body: RecommendBody, user: dict = Depends(current_user)):
    query = body.query.strip()
    result = engine.recommend(user_context(user), query, body.category, body.limit, body.offset)
    return {"query": query, "category": body.category, **result}


@app.get("/api/made-for-you")
def made_for_you(user: dict = Depends(current_user)):
    return {"rows": engine.made_for_you(user_context(user), popularity())}


@app.get("/api/similar/{item_id}")
def similar(item_id: int, user: dict = Depends(current_user)):
    return {"items": engine.similar(item_id, user_context(user))}


@app.get("/api/items")
def items_by_id(ids: str, user: dict = Depends(current_user)):
    """Full cards (with match % and reasons) for specific ids — used by My Likes / My Saved."""
    wanted = [int(i) for i in ids.split(",") if i.strip().isdigit()][:200]
    ctx = user_context(user)
    signals = engine.build_signals(ctx)
    result = engine.recommend(ctx, limit=len(engine.df) or 1, signals=signals)["items"]
    by_id = {i["id"]: i for i in result}
    return {"items": [by_id[i] for i in wanted if i in by_id]}


@app.get("/api/item/{item_id}")
def item_detail(item_id: int, user: dict = Depends(current_user)):
    ctx = user_context(user)
    signals = engine.build_signals(ctx)
    ranked = engine.recommend(ctx, limit=len(engine.df) or 1, signals=signals)["items"]
    for item in ranked:
        if item["id"] == item_id:
            return item
    if item_id in signals.disliked and item_id in engine.id_to_idx:
        raise FriendlyError("You've hidden this item.", 404)
    raise FriendlyError("That item no longer exists.", 404)


@app.get("/api/profile/taste")
def taste(user: dict = Depends(current_user)):
    ctx = user_context(user)
    counts = {"like": 0, "save": 0, "dislike": 0, "view": 0}
    for row in ctx.interactions:
        if row["action"] in counts:
            counts[row["action"]] += 1
    return {**engine.taste(ctx), "stats": {**counts, "searches": len(db.get_searches(user["id"], 1000))}}


def safe_dataset_name(filename: str, category: str | None) -> str:
    """data/<name>.csv — derived from the category (or file name), never a path from the browser."""
    stem = category or re.sub(r"\.csv$", "", filename or "", flags=re.I)
    stem = re.sub(r"[^a-z0-9]+", "_", stem.lower()).strip("_")[:60] or "imported"
    return f"{stem}.csv"


@app.post("/api/import")
async def import_csv(file: UploadFile = File(...), category: str = Form(default=""),
                     save_to_data: bool = Form(default=False), user: dict = Depends(admin_user)):
    if not (file.filename or "").lower().endswith(".csv"):
        raise FriendlyError("Please choose a .csv file.")
    raw = await file.read(config.MAX_UPLOAD_MB * 1024 * 1024 + 1)
    if len(raw) > config.MAX_UPLOAD_MB * 1024 * 1024:
        raise FriendlyError(f"That file is larger than {config.MAX_UPLOAD_MB} MB.")
    try:
        items, summary = importer.normalise(raw, file.filename, category.strip() or None)
    except importer.ImportError_ as exc:
        raise FriendlyError(str(exc)) from exc
    inserted, duplicates = db.insert_items(items) if items else (0, 0)
    skipped = summary["rows_read"] - inserted
    if duplicates:
        summary["skip_reasons"]["already in catalog"] = duplicates
    summary.update(imported=inserted, skipped=skipped)
    db.log_import(summary, user["id"])
    if save_to_data and items:
        # Keep a copy in data/ so the dataset is reloaded by "Sync datasets" and survives resets.
        # An existing file is never overwritten.
        target = config.DATA_DIR / safe_dataset_name(file.filename, category.strip() or None)
        if target.exists():
            target = target.with_name(f"{target.stem}_{datetime.now():%Y%m%d%H%M%S}.csv")
        config.DATA_DIR.mkdir(exist_ok=True)
        target.write_bytes(raw)
        summary["saved_as"] = f"data/{target.name}"
    if inserted:
        engine.rebuild()
    return {**summary, "categories": engine.categories}


@app.get("/api/admin/stats")
def admin_stats(_: dict = Depends(admin_user)):
    return {
        "users": db.count("profiles"), "items": db.count("items"),
        "interactions": db.count("interactions"), "searches": db.count("searches"),
        "categories": {c: int((engine.df["category"] == c).sum()) for c in engine.categories},
        "imports": db.recent_imports(),
    }


@app.get("/api/admin/users")
def admin_users(_: dict = Depends(admin_user)):
    return {"users": db.list_users()}


@app.get("/api/admin/datasets")
def admin_datasets(_: dict = Depends(admin_user)):
    """The CSV files in data/ and how many of their rows are in the catalog."""
    engine.ensure_loaded()
    in_catalog = {c: int((engine.df["category"] == c).sum()) for c in engine.categories}
    files = []
    for path in seed.dataset_files():
        entry = {"file": path.name, "size_kb": round(path.stat().st_size / 1024, 1),
                 "builtin": seed.is_builtin(path)}
        try:
            rows, summary = seed.read_dataset(path)
            categories = sorted({r["category"] for r in rows})
            entry.update(rows=len(rows), images=sum(1 for r in rows if r["image_url"]),
                         categories=categories,
                         in_catalog=sum(in_catalog.get(c, 0) for c in categories))
        except importer.ImportError_ as exc:
            entry["error"] = str(exc)
        files.append(entry)
    return {"files": files}


@app.post("/api/admin/datasets/sync")
def admin_sync_datasets(_: dict = Depends(admin_user)):
    result = seed.sync_datasets()
    engine.rebuild()
    return {**result, "categories": engine.categories,
            "message": f"Datasets synced — {result['inserted']} new item(s), {result['images_added']} image(s) added."}


@app.post("/api/admin/rebuild")
def admin_rebuild(_: dict = Depends(admin_user)):
    return {"message": f"Rebuilt the TF-IDF cache with {engine.rebuild()} items."}


@app.post("/api/admin/dedupe")
def admin_dedupe(_: dict = Depends(admin_user)):
    engine.rebuild()
    ids = engine.duplicate_ids()
    if ids:
        db.delete_items(ids)
        engine.rebuild()
    return {"message": f"Removed {len(ids)} duplicate item(s).", "removed": len(ids)}


@app.post("/api/admin/reset-demo")
def admin_reset_demo(_: dict = Depends(admin_user)):
    db.delete_items_by_source("demo")
    inserted = seed.seed_demo_items()
    engine.rebuild()
    return {"message": f"Demo data reset — {inserted} demo items loaded."}


@app.post("/api/admin/refresh")
def admin_refresh(_: dict = Depends(admin_user)):
    """Called after an admin edits an item (e.g. uploads an image) from the browser."""
    engine.rebuild()
    return {"message": "Catalog refreshed."}


@app.get("/admin", include_in_schema=False)
def admin_page():
    """The admin panel is not linked anywhere in the UI — open /admin directly."""
    return RedirectResponse("/#/admin")


# Serve the frontend last so /api routes win.
app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")
