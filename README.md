# EDRecommend

Discover. Learn. Explore. — a personalised recommendation app for students and teachers.
Python (FastAPI + pandas + scikit-learn) backend, HTML/CSS/JS frontend, Supabase database.

## Run it

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env            # fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
uvicorn app:app --reload        # → http://localhost:8000
```

1. Run `supabase/schema.sql` once in Supabase → SQL Editor.
2. Copy `frontend/js/config.example.js` to `frontend/js/config.js` and add the project URL + anon key.
3. Start the server. On startup every CSV in `data/` is loaded into the catalog.
4. Optional demo accounts (Rahul & Priya with history): `python seed.py --demo-users`.

## Datasets

`data/` holds one CSV per category — 135 items each:

| File | Images |
|---|---|
| movies.csv | posters (Wikipedia) |
| books.csv | covers (Open Library) |
| courses.csv | none — generated artwork |
| jobs.csv | profession photos (Wikipedia) |
| apps.csv | logos / screenshots (Wikipedia) |
| games.csv | cover art (Wikipedia) |
| technology.csv | logos / diagrams (Wikipedia) |

Columns: `title, category, description, tags, rating, image_url`. Images are stored as URLs, not
inside the database; a card whose image fails to load falls back to generated artwork.
Movies and games are rated out of 10, everything else out of 5 — the engine normalises per category.

Edit or add a CSV in `data/`, then press **Sync datasets** in the admin panel (or restart the
server). Syncing adds new rows, skips duplicates (same title + category) and fills in missing images.

## Admin panel

Open **http://localhost:8000/admin** — it is deliberately not linked in the app. Only accounts with
`is_admin = true` can use it (see the end of `supabase/schema.sql`). It contains:

- **Import dataset** — upload any CSV; common column names (`name`, `movie_title`, `overview`,
  `genres`, `vote_average`, `poster`…) are mapped automatically. Tick *save a copy to data/* to keep it
  as a dataset file.
- **Datasets** — every file in `data/`, its row/image counts, and a Sync button.
- **Users**, catalog stats, cache rebuild, duplicate removal, demo reset, image upload.

## Publish (Netlify + Render)

The website is static and goes on **Netlify**; the Python recommendation API goes on **Render**;
the database is already on **Supabase**. All three have free plans.

1. **Render (API)** — Dashboard → New → **Blueprint** → pick this repository. `render.yaml` sets
   everything up; paste your `SUPABASE_SERVICE_ROLE_KEY` when asked. Note the address it gives you
   (e.g. `https://edrecommend-api.onrender.com`).
2. If that address differs, update `RENDER_API` in `frontend/js/config.js` and push.
3. **Netlify (website)** — Add new site → Import from Git → pick this repository. `netlify.toml`
   publishes the `frontend/` folder; there is no build step.
4. **Supabase** → Authentication → URL Configuration: set **Site URL** to your Netlify address and
   add it (plus `http://localhost:8000`) to **Redirect URLs**, so confirmation emails link back
   to the right site.

The free Render plan sleeps after ~15 minutes without visitors; the first request afterwards
takes 30–50 seconds while it wakes up. CSV copies saved to `data/` by the admin importer are lost
when Render redeploys — the imported items themselves are safe in Supabase.

## Tests

```bash
cd backend && pytest -q
```
