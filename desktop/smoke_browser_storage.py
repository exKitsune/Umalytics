"""Real-browser legacy import cases, separate from fresh UI readiness."""
import json
import time


def evaluate(debugger, expression):
    result = debugger.call('Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True})
    if result.get('exceptionDetails'):
        raise AssertionError('Browser-storage fixture script failed: ' + json.dumps(result['exceptionDetails']))
    return result.get('result', {}).get('value')


def until(check, message):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except (OSError, ValueError):
            pass  # A reload briefly replaces the page's execution context.
        time.sleep(.1)
    raise AssertionError(message)


def verify_legacy_storage(debugger, get, set_preferences, fixture):
    # A stuck legacy-storage probe must not block native preferences or editing.
    set_preferences({'theme': 'light', 'fontScale': 125, 'browserMigrationComplete': False})
    script = debugger.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'indexedDB.databases=()=>new Promise(()=>{});'})
    try:
        debugger.call('Page.reload')
        until(lambda: evaluate(debugger, "document.documentElement.dataset.theme==='light'&&document.documentElement.style.getPropertyValue('--font-scale')==='1.25'"), 'Native preferences waited on legacy browser storage')
        evaluate(debugger, "document.querySelector('button[aria-label=\"Switch to dark mode\"]').click()")
        until(lambda: get('/api/preferences')['theme'] == 'dark', 'Desktop settings stayed blocked by legacy storage')
        assert not get('/api/preferences')['browserMigrationComplete']
    finally:
        debugger.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': script['identifier']})
    ident = 'local-' + 'b' * 64
    fixture = {**fixture, 'duration': max(frame['time'] for frame in fixture['frames'])}
    entry = {'id': ident, 'title': 'Legacy import fixture', 'receivedAt': '2026-01-01T00:00:00Z', 'race': None}
    # A failed import keeps the original browser entry and does not block the UI.
    seed = """(async()=>{
      localStorage.setItem('umatrace-theme','light');localStorage.setItem('umalytics-font-scale','130');
      localStorage.setItem('umalytics-course-assignments',JSON.stringify({ID:10606}));
      localStorage.setItem('umalytics-race-tags',JSON.stringify({ID:['Legacy']}));
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('umatrace-library',1);r.onupgradeneeded=()=>r.result.createObjectStore('races',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      await new Promise((resolve,reject)=>{const tx=db.transaction('races','readwrite');tx.objectStore('races').put(ENTRY);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error)});db.close();return true;
    })()""".replace('{ID:', '{' + json.dumps(ident) + ':').replace('ENTRY', json.dumps(entry))
    evaluate(debugger, seed)
    debugger.call('Page.reload')
    until(lambda: evaluate(debugger, "Array.from(document.querySelectorAll('[role=status]')).some(e=>e.textContent.includes('Older browser data could not be imported'))"), 'Failed legacy import was not reported')
    assert not get('/api/preferences')['browserMigrationComplete']
    assert get('/api/preferences')['fontScale'] == 125
    assert evaluate(debugger, "(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('umatrace-library');q.onsuccess=()=>r(q.result)});const row=await new Promise(r=>{const q=db.transaction('races').objectStore('races').get(" + json.dumps(ident) + ");q.onsuccess=()=>r(q.result)});db.close();return row?.race===null})()"), 'The failed browser original was deleted'
    entry['race'] = fixture
    # Replace the bad entry in place, then retry from a fresh frontend instance.
    evaluate(debugger, "(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('umatrace-library');q.onsuccess=()=>r(q.result)});const tx=db.transaction('races','readwrite');tx.objectStore('races').put(" + json.dumps(entry) + ");await new Promise((r,j)=>{tx.oncomplete=r;tx.onabort=j});db.close();return true})()")
    debugger.call('Page.reload')
    until(lambda: get('/api/preferences')['browserMigrationComplete'], 'Legacy import did not finish after retry')
    preferences = get('/api/preferences')
    assert preferences['theme'] == 'light' and preferences['fontScale'] == 130
    assert preferences['courseAssignments'][ident] == 10606
    assert preferences['raceTags'][ident] == ['Legacy']
    assert get('/api/races/' + ident)['data'], 'Acknowledged legacy race was not saved'
    assert evaluate(debugger, "localStorage.getItem('umatrace-theme')===null&&localStorage.getItem('umalytics-font-scale')===null")
    remaining = evaluate(debugger, "(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('umatrace-library');q.onsuccess=()=>r(q.result)});const rows=await new Promise(r=>{const q=db.transaction('races').objectStore('races').getAll();q.onsuccess=()=>r(q.result)});db.close();return rows.length})()")
    assert remaining == 0, 'Only acknowledged browser originals may be deleted'
    return {'nativePreferencesWhileLegacyPending': 'passed', 'failedImportPreservesOriginal': 'passed', 'legacyRaceAndPreferences': 'passed', 'retryAfterFailure': 'passed'}
