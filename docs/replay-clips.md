# Race replay and local video clips

The zoomed replay follows the distance-specific course curve extracted from the
game. Its camera follows the selected runner or leader and smoothly rotates toward
a centred36m course chord. Unwrapped orientations are sampled every2m and
interpolated by course distance. Orientation depends only on course position,
so playback, arbitrary seeking and video clips agree. Projection scale is fixed
at (viewport width−100)/window; the course fills the horizontal view without
per-frame fitting or a polyline-tangent rotation jump. The adjustable
40–600 m window defaults to 50m, about 2.8 times closer than the previous 140m view,
and preserves the bends rather than flattening the race into a
distance axis. The relative elevation strip integrates the reference course's
percent grades over metre distances (`height += distance × grade / 100`),
with the start as its zero datum. Raw asset Y units remain unconverted;
reference grade elevation is distinct from visual mesh or physical venue height.
The phase label uses the known course distance. Missing geometry falls
back to an explicitly labeled distance/schematic view.

Distance ticks are anchored to exact course distances every 50m, automatically
switching to 100m in wide views. Close views label 50m ticks too; no distance-tick
selector is needed. The starting grid does not slide as the visible window grows.
Truncated track segments use flat caps; round caps appear only at an actual
race start or known finish. The parent can supply a compact minimap via the
named `minimap` slot, overlaid in the upper-right of the live canvas.
Independent marker toggles show phase changes, corner/straight boundaries,
slope changes and **777m left**. Coincident markers share one sign. Course
boundaries and grades require a known reference course, and phase/remaining
markers require a known total distance. These same settings appear in clips.

Local outfit portraits take priority over generic character heads using an
explicit card-to-costume mapping. They identify runners without setting lateral positions. Recorded
lane values increase outward, with the lowest observed value placed closest to
the drawing's estimated inner edge. Fence alignment and lane spacing remain
uncalibrated; the renderer does not claim metric lane offsets or distance loss.
Unknown lanes remain unknown rather than being replaced with a gate/index.

Each runner's skill/status rows share one compact box above or below the
portrait, with a single gate/name header. Its colored band matches the runner
portrait/telemetry color and uses dark text for contrast in either theme. Individual effect rows retain bundled
game skill icons, shared status colors and duration bars. The drawn track and lateral visual spacing are twice
the previous thickness (70–180px) without changing longitudinal course scale. Card sides
are fixed by runner identity; they never switch during playback (including within
0.75seconds). A symmetric soft layout follows the current owner anchors, so
boxes can exchange horizontal order as runners pass. Box separation yields to
owner proximity; crowded fields may overlap rather than hiding effects.
Every active skill/status retains its own icon, label and duration row. There
are no collapsed stacks or hidden-effect count chips. Long stacks form columns
inside the same group, and every row stays inside the canvas. Colored headers
are drawn after all effect rows, with portraits drawn last.

Placement targets are sampled at fixed race times and smoothed over a short
rolling window of owner-relative offsets. This avoids jumping between local
packing solutions and follows camera translation immediately. A cold seek
requires only nearby target samples, rather than solving the race from its
start. Seeking, playback and clip rendering therefore agree without depending
on the order in which frames were requested. The selected runner receives
less repulsion so its box stays closer. Portraits and the live minimap are
soft layout obstacles; clips omit the DOM-only minimap reservation.
Race result rows provide keyboard selection; the canvas describes current cards
to screen readers. Arrows seek1second, Shift-arrows5; Home/End seek endpoints.

Skill cards use shared effectiveEnd/effectiveDuration from analytics: reported
end remains unchanged, reference duration is a separate derived field, and
instant/unknown timing remains explicit. Solid bars count down resolved timing.
Known status spans stop exactly at their recorded or modeled end.
Instant, unknown and short skills remain visible for at least2.5seconds; this
is a display dwell only. Dotted edges indicate unknown timing or retained display
dwell and never imply an effect remains active. Censored recorded statuses are
shown through their observed boundary without inventing a countdown. Modeled
statuses keep their evidence/detail and a concise explanation on hover. Downhill
terrain (GRADE) is omitted; DH means actual or explicitly modeled downhill mode.
Duplicate duel-related intervals share the Dueling presentation label.

Incoming debuff cards use recorded target-mask selection only. They also appear
when the caster is outside the current viewport. Explicit matching team groups
use a neutral card and immunity explanation; no mask or model is described as
measured applied damage. The card retains full evidence internally, while hover
text stays short and identifies the caster by name.

The vision overlay uses the supplied mechanics reference's lane envelope:
horse lane=1/18 course width and half-width=(gap/visibleDistance×11.5+2)/36.
It follows the same visual lane projection as portraits, extrapolated without
clamping to a fence. The default longitudinal distance is 20m; resolved passive
and resolved active effect8 modifiers adjust it via the shared analytics helper.
Unresolved modifiers leave a clearly tagged base reference guide. Dashed rings
identify geometric candidates; solid links/rings identify recorded target-mask
recipients. Neither geometry nor a mask proves effect magnitude or removes team
immunity. Unknown recipients stay unknown.

The selected runner's reference guide is optional. Debuff overlays automatically
add one for self vision-distance skills and explicit All-Seeing Eyes/Sharp Gaze
and Petrifying/Intense Gaze IDs;
this does not generalize targetType 4 to every skill. Instantaneous or unknown-end
debuffs use the same2.5second visual dwell; resolved effect windows use shared
effective timing. The geometry is labeled **Reference vision**, not observed targeting.
See `docs/model-contributions.md` for mechanics evidence and model limitations.

The live canvas uses its actual CSS width and a responsive 560–680 px height,
giving the full effect stacks more vertical space.
The current telemetry readout groups Speed, HP and Gap in one place. Gap is
positive behind the leader and negative when leading, using the distance to
second place. Finished runners are clamped to the course finish, and incomplete
field positions leave the gap unknown.
Playback redraws coalesce into one pending animation frame; the parent player
cannot repeatedly cancel that frame. Its `data-replay-time` and
`data-replay-distance` attributes update only after drawing, so browser checks
can distinguish a moving canvas from a moving transport control.
`data-replay-angle` and `data-replay-scale` expose the camera used by that draw.
The whole-process replay workflow imports a race, loads the bundled game paths
and checks the actual shared canvas path commands across left/right corner
boundaries, fixed world ticks, smooth rotation and marker toggles. Representative
courses also render labels. Dedicated full-playback scenarios cover crossing
runners, changing stack heights and crowded fields at760,1280 and1920px widths:
all effects retain rows, boxes remain near owners and can swap horizontally,
card sides stay fixed, motion remains below15px per sampled animation frame,
and arbitrary seeks give identical layouts. Overlaps are measured rather than
eliminated by suppressing rows. Countdowns, received cards and one runner header
per group remain checked through the shared canvas renderer.

**Create clip** lets the user choose recorded start/end seconds and playback
rate. The browser renders this same view into a canvas and encodes a real WebM
video, with course curve, markers, labels, phase, clock and elevation. It requests
no screen capture, microphone or audio permissions. Encoding takes the selected
clip's playback time; it can be cancelled. The result has an inline preview and
a download link. Browsers without canvas WebM encoding show the limitation.
Synthetic races retain a visible SYNTHETIC label in the exported video. Portraits and bundled skill icons
load before recording, preserving offline operation and
keeping the canvas exportable. Their provenance is in `public/portraits/NOTICE.txt`.

## Component integration

```svelte
<CurveReplay
  race={analysisRace}
  {course} {reference} {selected} {time} {analysis}
  onSelect={id => selected = id}
  onSeek={seek}
/>
```

`analysis` is the shared `RaceAnalysis` from `analyzeRace`. The component owns its
camera/window/overlay and clip controls; the parent owns replay time and runner
selection. `src/replay/draw.ts` is shared by the live canvas and video encoder.
`ReplayClip.svelte` owns the encoder stream and revokes generated preview URLs
when replaced, the race changes or the component is destroyed.
