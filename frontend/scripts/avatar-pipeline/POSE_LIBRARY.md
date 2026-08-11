# Standard Pose Library

Canonical pose definitions for generated employee characters. There are no
reference images for these poses — the descriptions below are the source of
truth for what each pose should look like.

## Generation rule

For any pose, the employee's **approved master character** (`masters/{Name}_Master.png`)
is the visual source of truth for identity. The pose description below controls
**only**:
- body position
- arm position
- hand gesture
- leg position
- expression, when specified

Everything else — face, eye construction, hairstyle, glasses, facial hair, skin
tone, clothing, body proportions, shoes, 3D rendering style, camera treatment —
comes from the master and must not be reinterpreted per pose. The goal is that
the same existing character model is simply being repositioned, not redesigned.

**Character lock** — pose generation must never change: head shape, face, eye
shape, visible white sclera, iris/pupil construction, eyebrows, nose, mouth
design, glasses, hairstyle, facial hair, ears, skin tone, clothing/colors, shoe
design, body proportions, head-to-body ratio, arm/leg thickness, material
style, lighting style. Never make the body taller, more anatomically realistic,
or lengthen limbs to make a pose easier — work within the established squishy
chibi anatomy.

**Camera lock** — every pose must preserve the same camera treatment as the
master: elevation, downward viewing angle, perspective, framing, character
scale, floor relationship, lighting, shadow direction. The pose library should
read as one 3D character being animated in front of a fixed gameplay camera,
not a new camera chosen per pose.

**Source discipline** — generate from the employee's own master only. Never
use another employee's master as a visual reference, and never go back to the
employee's original uploaded avatar once a master exists (the upload was
already used to create the master; the master is now the canonical source for
every pose).

## The 13 poses

1. **Idle / Standing** — neutral relaxed stand, feet slightly apart, arms
   resting naturally, neutral friendly expression. This is the master pose
   and already exists.
2. **Walking A** — first walk-cycle frame: one leg forward, opposite arm
   forward, small compact stride, front foot lifted/entering contact, mostly
   upright, no exaggerated running or torso rotation. A cute casual office
   step.
3. **Walking B** — the opposite frame from Walking A: reversed leg/arm
   positions, same stride length/height/posture/scale. A and B must alternate
   cleanly as one walking cycle.
4. **Sitting Neutral** — upright-but-relaxed torso, hips as if resting on a
   seat, knees bent naturally, feet toward the floor, hands relaxed near the
   thighs/lap, neutral expression. **Character only — do not generate any
   furniture** (chair/sofa/bench); the seated character gets composited onto
   different seating objects later.
5. **Talking A** — standing, one arm slightly raised with a naturally bent
   elbow, open relaxed palm, casual "explaining something" gesture, other arm
   relaxed, slightly engaged/friendly expression. Keep it subtle.
6. **Talking B** — second conversational frame: both forearms slightly
   raised, elbows bent, hands slightly open/outward, relaxed shoulders,
   friendly expression. Alternates with Talking A. Not a dramatic speech.
7. **Shrug** — both elbows bent, forearms raised slightly outward, palms
   angled upward, shoulders subtly raised, small relaxed hands, optional very
   slight head movement, mild curious/uncertain expression. Keep cute and
   compact — don't exaggerate arms/hands.
8. **Thinking** — one elbow bent, hand gently near/touching the chin, other
   arm relaxed, head may tilt very slightly, eyes may look up/sideways subtly,
   thoughtful neutral expression. No dramatic face change — must stay
   immediately recognizable.
9. **Listening** — mostly neutral stand, arms relaxed, slightly attentive
   posture, very subtle forward attention, eyes focused toward the implied
   speaker, neutral/friendly listening expression. Intentionally very little
   movement — pairs with another character's Talking A/B.
10. **Greeting / Wave** — one arm raised beside the upper body/head, elbow
    bent naturally, open hand, palm facing outward, other arm relaxed,
    friendly expression. Keep the hand proportional to the master — do not
    enlarge it just to read more clearly as a wave.
11. **Pointing** — one arm extends slightly outward (elbow may stay slightly
    bent), hand indicates a clear direction, other arm relaxed, mostly
    upright, small engaged expression. Don't stretch the arm — maintain the
    short chibi limb proportions.
12. **Coffee / Object Hold** — one elbow bent naturally, one hand at
    chest/upper-waist height shaped to hold a small cup or similar object,
    other arm relaxed, upright and casual. Supports coffee cup, mug, phone, or
    small office item — place the requested object naturally into the
    prepared hand position.
13. **Sitting — Typing / Keyboard** — a desk-work variant of Sitting Neutral
    (#4): upright-but-relaxed torso, hips as if resting on a seat, knees bent
    naturally, feet toward the floor. Differs from #4 only in the arms/hands:
    both upper arms rest close to the sides, elbows bent ~90°, both forearms
    raised forward to desk height, hands out in front at lower-chest/waist
    height with fingers gently curled and slightly spread as if resting on /
    typing on a keyboard, wrists neutral (not drooped, not raised).
    Focused-but-friendly neutral expression, gaze forward-down toward the
    implied work surface (no upward head tilt — camera lock still applies).
    Generate in 4 directional variants — front, back, left, right — as a
    turnaround, same as the idle/walk sets. Back variant follows the standard
    no-face rule (back/crown only, identity via head covering/build/clothing;
    for a bald master keep it bald). **Character only — do not generate a
    chair, desk, keyboard, or any furniture/props** (same rule as #4); seating
    and keyboard are composited later. Character lock, camera lock, and
    source discipline (one-hop edit from that employee's own master only)
    apply exactly as for every other pose.

## Generation workflow (calibration phase)

Do not batch-generate the whole library yet. Generate **one pose per image**,
for one selected employee, from their master:

```
approved master character + standard pose definition → new pose asset
```

Save each pose separately, never overwriting the master. Review each result
before moving on to automated batch generation across the library/employees.
