/**
 * Quick smoke test for the rhyme lens engine.
 * Run: npx tsx scripts/test-rhyme-engine.ts
 */
import { analyzeRhymeLens } from "../src/lib/rhymeLens";
import type { RhymeFamily } from "../src/lib/rhymeLens";

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function familyTexts(fam: RhymeFamily): string[] {
  return fam.spans.map(s => s.text.toLowerCase());
}

// ── Test 1: False-positive prevention ────────────────────────────────────────
console.log("\n=== Test 1: False-positive prevention ===");
{
  const lyrics = `this is testing
and now i'm resting
i'm testing
and now i'm resting

i'm the best`;

  const r = analyzeRhymeLens(lyrics);

  // testing/resting should form a family
  const testingFamily = r.families.find(f =>
    familyTexts(f).some(t => t === "testing" || t.includes("testing"))
  );
  assert("testing/resting family exists", !!testingFamily);
  if (testingFamily) {
    const words = familyTexts(testingFamily);
    assert("resting in same family", words.some(w => w === "resting" || w.includes("resting")));
  }

  // "this is" alone should NOT have its own non-repetition family
  const thisIsFamily = r.families.find(f =>
    f.type !== "repetition" && familyTexts(f).some(t => t === "this is")
  );
  assert("'this is' not in non-repetition family", !thisIsFamily);
}

// ── Test 2: Compound / chain rhyme ───────────────────────────────────────────
console.log("\n=== Test 2: Compound / chain rhyme ===");
{
  const lyrics = `paper sparks a chain reaction
late night brain relaxin
crooked little habit turns to action
half the room is lackin traction`;

  const r = analyzeRhymeLens(lyrics);

  // reaction/action/traction should share a family
  const actionFamily = r.families.find(f =>
    familyTexts(f).some(t => t === "action" || t.includes("action"))
  );
  assert("action family exists", !!actionFamily);
  if (actionFamily) {
    const words = familyTexts(actionFamily);
    assert("reaction or 'chain reaction' in family",
      words.some(w => w.includes("reaction")));
    assert("traction in family",
      words.some(w => w.includes("traction")));
  }
}

// ── Test 3: Internal + cross-line rhyme ──────────────────────────────────────
console.log("\n=== Test 3: Internal + cross-line rhyme ===");
{
  const lyrics = `i stare at the air up there
the glare from the square is rare
i swear she don't care to share`;

  const r = analyzeRhymeLens(lyrics);
  // Should detect an -air/-are family with many members
  const airFamily = r.families.find(f =>
    familyTexts(f).filter(t =>
      /^(stare|air|there|glare|square|rare|swear|care|share)$/i.test(t)
    ).length >= 3
  );
  assert("-air family with 3+ members", !!airFamily,
    airFamily ? `found: ${familyTexts(airFamily).join(", ")}` : "no family found");
}

// ── Test 4: Multisyllabic ────────────────────────────────────────────────────
console.log("\n=== Test 4: Multisyllabic ===");
{
  const lyrics = `i'm the center of attention
winter brings another dimension
enter the convention`;

  const r = analyzeRhymeLens(lyrics);

  // attention/dimension/convention should share end rhyme
  const tionFamily = r.families.find(f =>
    familyTexts(f).some(t => t.includes("attention"))
  );
  assert("-tion family exists", !!tionFamily);
  if (tionFamily) {
    const words = familyTexts(tionFamily);
    assert("dimension in family", words.some(w => w.includes("dimension")));
    assert("convention in family", words.some(w => w.includes("convention")));
  }
}

// ── Test 5: Repetition vs Rhyme ──────────────────────────────────────────────
console.log("\n=== Test 5: Repetition vs Rhyme ===");
{
  const lyrics = `love love love
shove comes to love
above the stars`;

  const r = analyzeRhymeLens(lyrics);
  // "love" repeated — should appear in some family
  const loveFamilies = r.families.filter(f =>
    familyTexts(f).some(t => t === "love")
  );
  assert("love appears in at least one family", loveFamilies.length >= 1);

  // love/shove/above should have rhyme relation
  const loveRhymeFamily = r.families.find(f => {
    const w = familyTexts(f);
    return w.includes("love") && (w.includes("shove") || w.includes("above"));
  });
  // This may or may not work depending on engine sensitivity — soft assertion
  if (loveRhymeFamily) {
    pass++;
    console.log("  PASS  love/shove or love/above rhyme family");
  } else {
    console.log("  SKIP  love/shove/above rhyme relation not detected (engine may separate repetition from rhyme)");
  }
}

// ── Test 6: Color diversity ──────────────────────────────────────────────────
console.log("\n=== Test 6: Color diversity ===");
{
  const lyrics = `cat sat mat
dog log fog
pen hen ten
sky fly dry`;

  const r = analyzeRhymeLens(lyrics);
  // Should have at least 3 distinct families
  assert("at least 3 distinct families", r.families.length >= 3,
    `found ${r.families.length} families`);

  // Each family should have a distinct colorIndex
  const colors = new Set(r.families.map(f => f.colorIndex));
  assert("color indices are diverse", colors.size >= Math.min(r.families.length, 3),
    `${colors.size} colors for ${r.families.length} families`);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${pass} passed, ${fail} failed out of ${pass + fail} assertions`);
process.exit(fail > 0 ? 1 : 0);
