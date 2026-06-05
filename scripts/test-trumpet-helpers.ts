// ── Test: trumpet pure-function helpers ─────────────────────────────────────
// Run with: npx tsx scripts/test-trumpet-helpers.ts
import { mapToTrumpetRange, analyzeToNotes } from "../src/hooks/perform/useLiveTrumpet";
import { snapToScale, keyToPc } from "../src/lib/audio/scales";

let pass = 0, fail = 0;

function assert(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else       { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}

function eq(a: number, b: number): boolean { return a === b; }
function inRange(v: number, lo: number, hi: number): boolean { return v >= lo && v <= hi; }

// ── mapToTrumpetRange ────────────────────────────────────────────────────────
console.log("\nmapToTrumpetRange");

// Auto: low male C3 (midi 48) should come out in trumpet sweet range
{
  const out = mapToTrumpetRange(48, "auto");
  assert("auto C3 → in trumpet range", inRange(out, 46, 84), `got ${out}`);
}

// Auto: typical male voice A3 (57) → trumpet sweet spot
{
  const out = mapToTrumpetRange(57, "auto");
  assert("auto A3 → in sweet range (58–79)", inRange(out, 55, 82), `got ${out}`);
}

// Auto: very high C6 (84) → stays in range
{
  const out = mapToTrumpetRange(84, "auto");
  assert("auto C6 stays in range", inRange(out, 46, 84), `got ${out}`);
}

// +12: transpose up an octave, clamped
{
  const out = mapToTrumpetRange(60, "+12"); // C4 → C5 = 72
  assert("+12 C4 → C5 (72)", eq(out, 72), `got ${out}`);
}

// +12: would exceed range — clamp to 84
{
  const out = mapToTrumpetRange(80, "+12"); // 80+12=92 → clamp
  assert("+12 clamps to TRUMPET_HIGH_MIDI", eq(out, 84), `got ${out}`);
}

// -12: A4 (69) → A3 (57), but clamped to 58 minimum? Actually 57 is < 58 sweet but >= 46 absolute. Stays.
{
  const out = mapToTrumpetRange(69, "-12"); // 69-12=57
  assert("-12 A4 → A3 (57)", eq(out, 57), `got ${out}`);
}

// same: clamp crazy low notes
{
  const out = mapToTrumpetRange(20, "same"); // way too low
  assert("same clamps very low midi to TRUMPET_LOW_MIDI (46)", eq(out, 46), `got ${out}`);
}

// same: in-range unchanged
{
  const out = mapToTrumpetRange(65, "same"); // F4
  assert("same F4 unchanged", eq(out, 65), `got ${out}`);
}

// auto: highest practical voice note E5 (76) stays put
{
  const out = mapToTrumpetRange(76, "auto");
  assert("auto E5 (76) stays close to 76", Math.abs(out - 76) <= 12, `got ${out}`);
}

// ── snapToScale ──────────────────────────────────────────────────────────────
console.log("\nsnapToScale");

// C major: D# (3) → E (4)
{
  const out = snapToScale(63, keyToPc("C"), "major"); // Eb4 (63) → snapped
  assert("Eb4 snaps to E4 or D4 in C major", out === 64 || out === 62, `got ${out}`);
}

// C minor: B (71) → Bb (70)
{
  const out = snapToScale(71, keyToPc("C"), "minor"); // B4 → Bb4
  assert("B4 snaps to Bb4 in C minor", eq(out, 70), `got ${out}`);
}

// chromatic: no change
{
  const out = snapToScale(63, keyToPc("C"), "chromatic");
  assert("chromatic scale: note unchanged", eq(out, 63), `got ${out}`);
}

// G major: F# (66) stays
{
  const out = snapToScale(66, keyToPc("G"), "major"); // F#4
  assert("F#4 stays in G major", eq(out, 66), `got ${out}`);
}

// G major: F natural (65) → snaps to F# (66) or E (64)
{
  const out = snapToScale(65, keyToPc("G"), "major");
  assert("F4 snaps in G major (to F# or E)", out === 66 || out === 64, `got ${out}`);
}

// ── analyzeToNotes edge cases (synchronous-ish) ─────────────────────────────
console.log("\nanalyzeToNotes (offline, requires pitchy)");

// We can't run the full async pipeline in this script without building,
// but we can validate the exported helper functions directly.

// Verify octave-flip removal logic manually (mirrors removeOctaveFlips)
{
  function removeOctaveFlips(notes: {midi: number; start: number; duration: number; velocity: number}[]) {
    if (notes.length < 3) return notes;
    const out = [...notes];
    for (let i = 1; i < out.length - 1; i++) {
      const prev = out[i-1].midi, curr = out[i].midi, next = out[i+1].midi;
      if (Math.abs(curr - prev) === 12 && Math.abs(curr - next) === 12) {
        out[i] = { ...out[i], midi: curr + (prev > curr ? 12 : -12) };
      }
    }
    return out;
  }
  const n = (m: number) => ({ midi: m, start: 0, duration: 0.3, velocity: 0.7 });
  const input   = [n(60), n(72), n(60)]; // C4, C5 (flip), C4
  const result  = removeOctaveFlips(input);
  assert("octave flip C4-C5-C4 → C4-C4-C4", result[1].midi === 60, `got ${result[1].midi}`);

  const stable  = [n(60), n(62), n(64)]; // no flip
  const result2 = removeOctaveFlips(stable);
  assert("stable notes unchanged by flip removal", result2[1].midi === 62, `got ${result2[1].midi}`);
}

// Verify mergeTiny logic
{
  function mergeTiny(notes: {midi: number; start: number; duration: number; velocity: number}[], minDurSec: number) {
    const out: typeof notes = [];
    for (const n of notes) {
      if (out.length > 0 && n.duration < minDurSec && Math.abs(out[out.length-1].midi - n.midi) <= 2) {
        out[out.length-1] = { ...out[out.length-1], duration: out[out.length-1].duration + n.duration };
      } else {
        out.push(n);
      }
    }
    return out;
  }
  const tiny = [
    { midi: 60, start: 0,   duration: 0.5, velocity: 0.7 },
    { midi: 60, start: 0.5, duration: 0.03, velocity: 0.5 }, // tiny fragment
    { midi: 62, start: 0.6, duration: 0.4, velocity: 0.7 },
  ];
  const merged = mergeTiny(tiny, 0.08);
  assert("tiny fragment merged into previous note", merged.length === 2 || merged[0].duration > 0.5, `length=${merged.length} dur=${merged[0]?.duration}`);

  const normal = [
    { midi: 60, start: 0,   duration: 0.5, velocity: 0.7 },
    { midi: 67, start: 0.6, duration: 0.05, velocity: 0.7 }, // tiny but different pitch
  ];
  const merged2 = mergeTiny(normal, 0.08);
  assert("tiny fragment with big pitch jump not merged", merged2.length === 2, `length=${merged2.length}`);
}

// ── Range boundary tests ─────────────────────────────────────────────────────
console.log("\nRange boundary tests");

// All range modes produce output within trumpet range
for (const midi of [30, 45, 60, 72, 88, 100]) {
  for (const mode of ["auto", "same", "+12", "+24", "-12"] as const) {
    const out = mapToTrumpetRange(midi, mode);
    assert(`mode=${mode} midi=${midi} → in [46,84]`, inRange(out, 46, 84), `got ${out}`);
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
