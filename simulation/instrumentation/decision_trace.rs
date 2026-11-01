//! Observation only: no predicates, mechanics changes or random draws.
use crate::json::{self, Value};
use std::cell::RefCell;
use std::collections::HashMap;
pub const SCHEMA: &str = "umalytics-decisions-v2";
const LEGACY: &str = "umalytics-decisions-v1";
const LIMIT: usize = 48 * 1024 * 1024;
const CORE: [usize; 23] = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 32,
];
const STATES: [usize; 9] = [23, 28, 29, 30, 31, 34, 35, 40, 41];
#[derive(Clone, Copy, Default)]
struct Context {
    horse: Option<usize>,
    time: f64,
    stage: usize,
    skill: usize,
    detail: usize,
}
#[derive(Clone, Copy, Hash, PartialEq, Eq)]
struct Key {
    horse: Option<usize>,
    stage: usize,
    skill: usize,
    detail: usize,
    kind: usize,
}
enum Data {
    Gate(bool),
    Object(Value),
}
struct Event {
    key: Key,
    seq: usize,
    last_seq: usize,
    tick: usize,
    last_tick: usize,
    time: f64,
    last_time: f64,
    count: usize,
    data: Data,
}
struct Trace {
    context: Context,
    tick: usize,
    sequence: usize,
    bytes: usize,
    dropped: usize,
    diagnostic: bool,
    strings: Vec<String>,
    names: HashMap<String, usize>,
    events: Vec<Event>,
    last: HashMap<Key, usize>,
    motion: Vec<[f64; 23]>,
    full_motion: Vec<[f64; 43]>,
    states: Vec<[f64; 12]>,
    last_state: HashMap<usize, [f64; 9]>,
}
fn equivalent(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a == b,
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equivalent(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, a)| b.get(k).is_some_and(|b| equivalent(a, b)))
        }
        _ => a.bitwise_eq(b),
    }
}
fn size(v: &Value) -> usize {
    match v {
        Value::String(s) => s.len() + 2,
        Value::Array(a) => 2 + a.iter().map(size).sum::<usize>(),
        Value::Object(o) => 2 + o.iter().map(|(k, v)| k.len() + 4 + size(v)).sum::<usize>(),
        _ => 24,
    }
}
impl Trace {
    fn intern(&mut self, s: &str) -> usize {
        if let Some(&i) = self.names.get(s) {
            return i;
        }
        let i = self.strings.len();
        self.strings.push(s.into());
        self.names.insert(s.into(), i);
        i
    }
    fn record(&mut self, kind: &str, data: Data) {
        self.sequence += 1;
        if self.bytes >= LIMIT {
            self.dropped += 1;
            return;
        }
        let kind = self.intern(kind);
        let c = self.context;
        let key = Key {
            horse: c.horse,
            stage: c.stage,
            skill: c.skill,
            detail: c.detail,
            kind,
        };
        if let Some(&i) = self.last.get(&key) {
            let e = &mut self.events[i];
            let same = match (&e.data, &data) {
                (Data::Gate(a), Data::Gate(b)) => a == b,
                (Data::Object(a), Data::Object(b)) => equivalent(a, b),
                _ => false,
            };
            if e.last_tick + 1 == self.tick && same {
                e.last_tick = self.tick;
                e.last_time = c.time;
                e.last_seq = self.sequence;
                e.count += 1;
                return;
            }
        }
        self.bytes += 192
            + match &data {
                Data::Gate(_) => 1,
                Data::Object(v) => size(v),
            };
        self.last.insert(key, self.events.len());
        self.events.push(Event {
            key,
            seq: self.sequence,
            last_seq: self.sequence,
            tick: self.tick,
            last_tick: self.tick,
            time: c.time,
            last_time: c.time,
            count: 1,
            data,
        });
    }
}
thread_local! {static TRACE:RefCell<Option<Trace>>=const{RefCell::new(None)};}
pub fn enabled() -> bool {
    TRACE.with(|s| s.borrow().is_some())
}
/// Legacy diagnostic entry point. Normal workers explicitly select compact mode.
pub fn begin(on: bool) {
    begin_mode(on, true)
}
pub fn begin_mode(on: bool, diagnostic: bool) {
    TRACE.with(|s| {
        *s.borrow_mut() = on.then(|| Trace {
            context: Context::default(),
            tick: 0,
            sequence: 0,
            bytes: 0,
            dropped: 0,
            diagnostic,
            strings: vec![String::new()],
            names: HashMap::from([(String::new(), 0)]),
            events: Vec::new(),
            last: HashMap::new(),
            motion: Vec::new(),
            full_motion: Vec::new(),
            states: Vec::new(),
            last_state: HashMap::new(),
        })
    });
}
pub struct Scope(Option<Context>);
impl Drop for Scope {
    fn drop(&mut self) {
        if let Some(c) = self.0.take() {
            TRACE.with(|s| {
                if let Some(t) = s.borrow_mut().as_mut() {
                    t.context = c
                }
            })
        }
    }
}
pub fn runner(horse: Option<usize>, time: f64, stage: &str) -> Scope {
    TRACE.with(|s| {
        Scope(s.borrow_mut().as_mut().map(|t| {
            let old = t.context;
            let stage = t.intern(stage);
            t.context = Context {
                horse: horse.or(old.horse),
                time,
                stage,
                ..Context::default()
            };
            old
        }))
    })
}
pub fn skill(id: &str, detail: usize, stage: &str) -> Scope {
    TRACE.with(|s| {
        Scope(s.borrow_mut().as_mut().map(|t| {
            let old = t.context;
            t.context.skill = t.intern(id);
            t.context.stage = t.intern(stage);
            t.context.detail = detail;
            old
        }))
    })
}
pub fn tick() {
    TRACE.with(|s| {
        if let Some(t) = s.borrow_mut().as_mut() {
            t.tick += 1
        }
    })
}
pub fn incomplete() {
    TRACE.with(|s| {
        if let Some(t) = s.borrow_mut().as_mut() {
            t.dropped += 1
        }
    })
}
pub fn windows(v: &crate::retail_initialization::Windows) -> Value {
    match v {
        crate::retail_initialization::Windows::Lottery(v) => Value::Bool(*v),
        crate::retail_initialization::Windows::Distances(rows) => json::arr(
            rows.iter()
                .map(|(a, b)| json::arr(vec![json::num(*a as f64), json::num(*b as f64)]))
                .collect(),
        ),
    }
}
pub fn event(kind: &str, data: impl FnOnce() -> Value) {
    // Specific rolls/windows remain; unused general RNG history is diagnostic-only.
    if !TRACE.with(|s| {
        s.borrow()
            .as_ref()
            .is_some_and(|t| t.diagnostic || kind != "rng-draw")
    }) {
        return;
    }
    let data = data();
    TRACE.with(|s| {
        if let Some(t) = s.borrow_mut().as_mut() {
            t.record(kind, Data::Object(data))
        }
    });
}
pub fn gate(name: &str, passed: bool) -> bool {
    // Hot path: numeric context and boolean comparison, no JSON/string allocations.
    TRACE.with(|s| {
        if let Some(t) = s.borrow_mut().as_mut() {
            t.record(name, Data::Gate(passed))
        }
    });
    passed
}
pub fn motion(values: &[f64]) {
    TRACE.with(|s| {
        if let Some(t) = s.borrow_mut().as_mut() {
            t.sequence += 1;
            if t.bytes >= LIMIT || values.len() != 40 {
                t.dropped += 1;
                return;
            }
            let mut row = [0.; 43];
            row[0] = t.tick as f64;
            row[1] = t.context.time;
            row[2] = t.context.horse.map_or(f64::NAN, |i| i as f64);
            row[3..].copy_from_slice(values);
            if t.diagnostic {
                t.bytes += 43 * 8;
                t.full_motion.push(row);
                return;
            }
            t.bytes += 23 * 8;
            t.motion.push(std::array::from_fn(|i| row[CORE[i]]));
            let state = std::array::from_fn(|i| {
                if i >= 7 {
                    (row[STATES[i]] > 0.) as u8 as f64
                } else {
                    row[STATES[i]]
                }
            });
            let horse = t.context.horse.unwrap_or(usize::MAX);
            if t.last_state.get(&horse) != Some(&state) {
                let mut entry = [0.; 12];
                entry[..3].copy_from_slice(&row[..3]);
                entry[3..].copy_from_slice(&state);
                t.states.push(entry);
                t.last_state.insert(horse, state);
                t.bytes += 12 * 8
            }
        }
    });
}
fn nums(v: impl IntoIterator<Item = f64>) -> Value {
    json::arr(v.into_iter().map(json::num).collect())
}
fn remap(i: f64, perm: Option<&[usize]>) -> f64 {
    if i < 0. {
        return i;
    }
    perm.and_then(|p| p.get(i as usize))
        .map_or(i, |v| *v as f64)
}
fn base64(bytes: &[u8]) -> String {
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let a = c[0] as usize;
        let b = *c.get(1).unwrap_or(&0) as usize;
        let d = *c.get(2).unwrap_or(&0) as usize;
        out.push(A[a >> 2] as char);
        out.push(A[((a & 3) << 4) | (b >> 4)] as char);
        out.push(if c.len() > 1 {
            A[((b & 15) << 2) | (d >> 6)] as char
        } else {
            '='
        });
        out.push(if c.len() > 2 { A[d & 63] as char } else { '=' })
    }
    out
}
pub fn finish(perm: Option<&[usize]>) -> Option<Value> {
    TRACE.with(|s| {
        s.borrow_mut().take().map(|mut t| {
            let mut events = Vec::with_capacity(t.events.len());
            for e in t.events {
                let mut data = match e.data {
                    Data::Gate(v) => json::obj(vec![("passed", Value::Bool(v))]),
                    Data::Object(v) => v,
                };
                if let Value::Object(d) = &mut data {
                    if let Some(Value::Array(targets)) = d.get_mut("targets") {
                        for v in targets {
                            if let Some(i) = v.as_f64() {
                                *v = json::num(remap(i, perm))
                            }
                        }
                    }
                }
                let horse = e
                    .key
                    .horse
                    .map_or(Value::Null, |i| json::num(remap(i as f64, perm)));
                let c = [
                    e.seq as f64,
                    e.last_seq as f64,
                    e.tick as f64,
                    e.last_tick as f64,
                    e.time,
                    e.last_time,
                    e.count as f64,
                ];
                events.push(if t.diagnostic {
                    json::obj(vec![
                        ("sequence", json::num(c[0])),
                        ("lastSequence", json::num(c[1])),
                        ("tick", json::num(c[2])),
                        ("lastTick", json::num(c[3])),
                        ("time", json::num(c[4])),
                        ("lastTime", json::num(c[5])),
                        ("count", json::num(c[6])),
                        ("horseIndex", horse),
                        ("stage", Value::String(t.strings[e.key.stage].clone())),
                        ("skillId", Value::String(t.strings[e.key.skill].clone())),
                        ("detail", json::num(e.key.detail as f64)),
                        ("kind", Value::String(t.strings[e.key.kind].clone())),
                        ("data", data),
                    ])
                } else {
                    let mut r = c.into_iter().map(json::num).collect::<Vec<_>>();
                    r.extend([
                        horse,
                        json::num(e.key.stage as f64),
                        json::num(e.key.skill as f64),
                        json::num(e.key.detail as f64),
                        json::num(e.key.kind as f64),
                        data,
                    ]);
                    Value::Array(r)
                });
            }
            let mut result = vec![
                (
                    "schema",
                    Value::String(if t.diagnostic { LEGACY } else { SCHEMA }.into()),
                ),
                ("complete", Value::Bool(t.dropped == 0)),
                ("dropped", json::num(t.dropped as f64)),
                ("observations", json::num(t.sequence as f64)),
                ("events", Value::Array(events)),
            ];
            if t.diagnostic {
                for r in &mut t.full_motion {
                    r[2] = remap(r[2], perm);
                    r[15] = remap(r[15], perm)
                }
                result.push((
                    "motion",
                    json::arr(t.full_motion.into_iter().map(nums).collect()),
                ));
                result.push((
                    "motionColumns",
                    json::arr(
                        MOTION_COLUMNS
                            .iter()
                            .map(|s| Value::String((*s).into()))
                            .collect(),
                    ),
                ));
            } else {
                let mut bytes = Vec::with_capacity(t.motion.len() * 23 * 8);
                for r in &mut t.motion {
                    r[2] = remap(r[2], perm);
                    r[15] = remap(r[15], perm);
                    for v in r {
                        bytes.extend(v.to_le_bytes())
                    }
                }
                for r in &mut t.states {
                    r[2] = remap(r[2], perm)
                }
                result.extend([
                    (
                        "strings",
                        json::arr(t.strings.into_iter().map(Value::String).collect()),
                    ),
                    ("motionCount", json::num(t.motion.len() as f64)),
                    ("motionEncoding", Value::String("f64le-base64".into())),
                    ("motionIndices", nums(CORE.map(|i| i as f64))),
                    ("motionData", Value::String(base64(&bytes))),
                    ("stateIndices", nums(STATES.map(|i| i as f64))),
                    (
                        "states",
                        json::arr(t.states.into_iter().map(nums).collect()),
                    ),
                ]);
            }
            json::obj(result)
        })
    })
}
pub const MOTION_COLUMNS: &[&str] = &[
    "tick",
    "time",
    "horseIndex",
    "dt",
    "position",
    "hp",
    "lane",
    "targetSpeed",
    "baseTarget",
    "sectionModifier",
    "paceCoefficient",
    "acceleration",
    "unclampedSelfSpeed",
    "blockingCap",
    "minimumSpeed",
    "blockerIndex",
    "blockerGap",
    "selfSpeed",
    "skillAdjustedSpeed",
    "actualSpeed",
    "selfClampLoss",
    "finalClampLoss",
    "phase",
    "lastSpurt",
    "spurtStart",
    "spurtSpeed",
    "spurtResult",
    "spurtCalculations",
    "rushing",
    "downhill",
    "paceMode",
    "forceIn",
    "forceInCoefficient",
    "laneTarget",
    "spotStruggle",
    "duel",
    "conservePower",
    "blockedFrontSeconds",
    "blockedSideSeconds",
    "blockedAllSeconds",
    "nearFrontSeconds",
    "nearBehindSeconds",
    "overtakeTargetSeconds",
];
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scopes_and_skipped_ticks() {
        begin(true);
        {
            let _r = runner(Some(2), 0., "build");
            {
                let _s = runner(None, 0., "effects");
                gate("a", false);
            }
            tick();
            gate("a", false);
            tick();
            tick();
            gate("a", false);
        }
        let r = finish(None).unwrap();
        assert_eq!(r.get_array("events").unwrap().len(), 3);
        for e in r.get_array("events").unwrap() {
            assert_eq!(e.get_i64("horseIndex").unwrap(), 2)
        }
        begin(false);
        event("off", || panic!("must stay lazy"));
    }
    #[test]
    fn coalesces_gates() {
        begin(true);
        gate("a", false);
        tick();
        gate("a", false);
        tick();
        tick();
        gate("a", false);
        let r = finish(None).unwrap();
        let e = r.get_array("events").unwrap();
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].get_i64("count").unwrap(), 2);
    }
    #[test]
    fn transitions_and_lazy_rng() {
        begin_mode(true, false);
        event("rng-draw", || panic!("must stay lazy"));
        {
            let _r = runner(Some(0), 0., "motion");
            let v = [0.; 40];
            motion(&v);
            tick();
            motion(&v);
            let mut v = v;
            v[26] = 1.;
            tick();
            motion(&v);
        }
        let r = finish(None).unwrap();
        assert_eq!(r.get_array("states").unwrap().len(), 2);
        assert_eq!(r.get_i64("motionCount").unwrap(), 3);
    }
    #[test]
    fn signed_zero() {
        begin(true);
        event("zero", || json::obj(vec![("v", json::num(-0.))]));
        tick();
        event("zero", || json::obj(vec![("v", json::num(0.))]));
        assert_eq!(finish(None).unwrap().get_array("events").unwrap().len(), 1);
    }
    #[test]
    fn base64_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
    }
}
