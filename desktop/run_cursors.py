"""Stable pagination cursors survive VACUUM's implicit rowid reassignment."""


def initialize(db):
    db.execute('CREATE TABLE IF NOT EXISTS run_cursors (cursor INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT, n INTEGER, UNIQUE(job,n))')
    floor = db.execute('SELECT coalesce(max(rowid),0) FROM runs').fetchone()[0]
    db.execute("UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name='run_cursors'", (floor,))
    db.execute("INSERT INTO sqlite_sequence(name,seq) SELECT 'run_cursors',? WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='run_cursors')", (floor,))


def fill_batch(db, limit=256):
    rows = db.execute('SELECT r.rowid,r.job,r.n FROM runs r LEFT JOIN run_cursors c ON c.job=r.job AND c.n=r.n WHERE c.cursor IS NULL ORDER BY r.rowid LIMIT ?', (limit,)).fetchall()
    db.executemany('INSERT OR IGNORE INTO run_cursors(cursor,job,n) VALUES (?,?,?)', rows)
    # A downgraded application may have reused a compacted rowid. Give those
    # unmapped rows a fresh cursor instead of colliding with a saved binding.
    db.executemany('INSERT OR IGNORE INTO run_cursors(job,n) VALUES (?,?)', [(job,n) for _,job,n in rows])
    return len(rows)
