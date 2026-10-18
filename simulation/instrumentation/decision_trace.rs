//! App-owned observation only. Never calls a predicate, changes state or draws RNG.
use crate::json::{self, Value};
use std::cell::RefCell;
use std::collections::BTreeMap;

pub const SCHEMA: &str = "umalytics-decisions-v1";
const LIMIT: usize = 48 * 1024 * 1024;
#[derive(Clone, Default)]
struct Context { horse: Option<usize>, time: f64, stage: String, skill: String, detail: usize }
struct Trace {
    context: Context, tick: usize, sequence: usize, bytes: usize, dropped: usize,
    events: Vec<Value>, motion: Vec<Value>, last: BTreeMap<String, (String, usize, usize)>,
}
thread_local! { static TRACE: RefCell<Option<Trace>> = const { RefCell::new(None) }; }
pub fn enabled() -> bool { TRACE.with(|s| s.borrow().is_some()) }
pub fn begin(on: bool) {
    TRACE.with(|s| *s.borrow_mut() = on.then(|| Trace { context: Context::default(), tick: 0,
        sequence: 0, bytes: 0, dropped: 0, events: Vec::new(), motion: Vec::new(), last: BTreeMap::new() }));
}
pub struct Scope(Option<Context>);
impl Drop for Scope { fn drop(&mut self) { if let Some(previous) = self.0.take() {
    TRACE.with(|s| { if let Some(t) = s.borrow_mut().as_mut() { t.context = previous; } });
} } }
pub fn runner(horse: Option<usize>, time: f64, stage: &str) -> Scope {
    TRACE.with(|s| Scope(s.borrow_mut().as_mut().map(|t| {
        let old = t.context.clone();
        // Constructors run before field_index is assigned. Keep the enclosing
        // builder's runner identity through nested skill/effect scopes.
        t.context = Context { horse: horse.or(old.horse), time, stage: stage.into(), ..Context::default() }; old
    })))
}
pub fn skill(id: &str, detail: usize, stage: &str) -> Scope {
    TRACE.with(|s| Scope(s.borrow_mut().as_mut().map(|t| {
        let old = t.context.clone(); t.context.skill = id.into(); t.context.detail = detail;
        t.context.stage = stage.into(); old
    })))
}
pub fn tick() { TRACE.with(|s| { if let Some(t) = s.borrow_mut().as_mut() { t.tick += 1; } }); }
pub fn incomplete() { TRACE.with(|s| { if let Some(t) = s.borrow_mut().as_mut() { t.dropped += 1; } }); }
pub fn windows(value: &crate::retail_initialization::Windows) -> Value {
    match value {
        crate::retail_initialization::Windows::Lottery(v) => Value::Bool(*v),
        crate::retail_initialization::Windows::Distances(rows) => json::arr(rows.iter().map(|(a,b)|
            json::arr(vec![json::num(*a as f64), json::num(*b as f64)])).collect()),
    }
}
pub fn event(kind: &str, data: impl FnOnce() -> Value) {
    if !enabled() { return; }
    let data = data();
    TRACE.with(|s| { let mut slot = s.borrow_mut(); let t = slot.as_mut().unwrap();
        t.sequence += 1;
        if t.bytes >= LIMIT { t.dropped += 1; return; }
        let c = &t.context;
        let key = format!("{:?}|{}|{}|{}|{}", c.horse, c.stage, c.skill, c.detail, kind);
        let fingerprint = json::to_string(&data);
        // Only consecutive-tick repetitions are coalesced. Failed/short-circuited
        // checks never create a sample. First/last sequence delimit the series;
        // intermediate within-tick ordering is not represented by a series.
        if let Some((previous, index, tick)) = t.last.get_mut(&key) {
            if *tick + 1 == t.tick && *previous == fingerprint {
                if let Value::Object(row) = &mut t.events[*index] {
                    let count = row["count"].as_f64().unwrap() + 1.;
                    row.insert("count".into(), json::num(count));
                    row.insert("lastTick".into(), json::num(t.tick as f64));
                    row.insert("lastTime".into(), json::num(c.time));
                    row.insert("lastSequence".into(), json::num(t.sequence as f64));
                }
                *tick = t.tick; return;
            }
        }
        t.bytes += fingerprint.len() + key.len() + 220;
        t.last.insert(key, (fingerprint, t.events.len(), t.tick));
        t.events.push(json::obj(vec![
            ("sequence", json::num(t.sequence as f64)), ("lastSequence", json::num(t.sequence as f64)),
            ("tick", json::num(t.tick as f64)), ("lastTick", json::num(t.tick as f64)),
            ("time", json::num(c.time)), ("lastTime", json::num(c.time)), ("count", json::num(1.)),
            ("horseIndex", c.horse.map_or(Value::Null, |i| json::num(i as f64))),
            ("stage", Value::String(c.stage.clone())), ("skillId", Value::String(c.skill.clone())),
            ("detail", json::num(c.detail as f64)), ("kind", Value::String(kind.into())), ("data", data),
        ]));
    });
}
pub fn gate(name: &str, passed: bool) -> bool {
    event(name, || json::obj(vec![("passed", Value::Bool(passed))])); passed
}
pub fn motion(values: &[f64]) {
    TRACE.with(|s| { if let Some(t) = s.borrow_mut().as_mut() {
        t.sequence += 1;
        if t.bytes >= LIMIT { t.dropped += 1; return; }
        t.bytes += values.len() * 20;
        let mut row = vec![json::num(t.tick as f64), json::num(t.context.time),
            t.context.horse.map_or(Value::Null, |i| json::num(i as f64))];
        row.extend(values.iter().map(|n| if n.is_finite() { json::num(*n) } else { Value::Null }));
        t.motion.push(Value::Array(row));
    } });
}
pub fn finish(perm: Option<&[usize]>) -> Option<Value> {
    TRACE.with(|s| s.borrow_mut().take().map(|mut t| {
        let remap = |value: &mut Value| {
            if let (Some(p), Some(i)) = (perm, value.as_f64()) {
                if i >= 0. { *value = json::num(p[i as usize] as f64); }
            }
        };
        for row in &mut t.events { if let Value::Object(r) = row {
            remap(r.get_mut("horseIndex").unwrap());
            if let Some(Value::Object(data)) = r.get_mut("data") {
                if let Some(Value::Array(targets)) = data.get_mut("targets") {
                    for target in targets { remap(target); }
                }
            }
        } }
        for row in &mut t.motion { if let Value::Array(r) = row { remap(&mut r[2]); remap(&mut r[15]); } }
        json::obj(vec![
            ("schema", Value::String(SCHEMA.into())), ("complete", Value::Bool(t.dropped == 0)),
            ("dropped", json::num(t.dropped as f64)), ("observations", json::num(t.sequence as f64)),
            ("events", Value::Array(t.events)), ("motion", Value::Array(t.motion)),
            ("motionColumns", Value::Array(MOTION_COLUMNS.iter().map(|x| Value::String((*x).into())).collect())),
        ])
    }))
}
pub const MOTION_COLUMNS: &[&str] = &[
    "tick", "time", "horseIndex", "dt", "position", "hp", "lane", "targetSpeed", "baseTarget",
    "sectionModifier", "paceCoefficient", "acceleration", "unclampedSelfSpeed", "blockingCap", "minimumSpeed",
    "blockerIndex", "blockerGap", "selfSpeed", "skillAdjustedSpeed", "actualSpeed", "selfClampLoss", "finalClampLoss",
    "phase", "lastSpurt", "spurtStart", "spurtSpeed", "spurtResult", "spurtCalculations", "rushing",
    "downhill", "paceMode", "forceIn", "forceInCoefficient", "laneTarget", "spotStruggle", "duel", "conservePower",
    "blockedFrontSeconds", "blockedSideSeconds", "blockedAllSeconds", "nearFrontSeconds", "nearBehindSeconds", "overtakeTargetSeconds",
];

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn constructor_events_keep_the_enclosing_runner() {
        begin(true);
        { let _r = runner(Some(2), 0., "build");
          { let _s = runner(None, 0., "effects"); gate("passive", true); }
          gate("restored", true); }
        let result = finish(None).unwrap();
        for event in result.get_array("events").unwrap() {
            assert_eq!(event.get_i64("horseIndex").unwrap(), 2);
        }
    }
    #[test] fn scope_restores_and_series_only_merges_consecutive_checks() {
        begin(true);
        { let _r = runner(Some(1), 1., "runtime"); let _s = skill("100", 0, "condition");
          assert!(!gate("a", false)); tick(); assert!(!gate("a", false)); tick(); tick(); gate("a", false); }
        let result = finish(Some(&[1,0])).unwrap();
        let events = result.get_array("events").unwrap();
        assert_eq!(events.len(), 2); assert_eq!(events[0].get_i64("count").unwrap(), 2);
        assert_eq!(events[0].get_i64("horseIndex").unwrap(), 0);
        assert!(!enabled());
        begin(false); event("disabled", || panic!("must be lazy"));
    }
}
