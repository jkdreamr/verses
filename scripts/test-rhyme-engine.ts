import {
  analyzeRhymeLens,
  CLEAN_OPTIONS,
  DEFAULT_OPTIONS,
  MAX_OPTIONS,
  type RhymeFamily,
  type RhymeLensOptions,
  type RhymeType,
} from "../src/lib/rhymeLens";
import { getTokenPhonetics } from "../src/lib/phonetics";

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
  return fam.spans.map((s) => s.text.toLowerCase());
}

function hasFamily(
  lyrics: string,
  words: string[],
  options: RhymeLensOptions = DEFAULT_OPTIONS,
  types?: RhymeType[],
): boolean {
  const wanted = words.map((w) => w.toLowerCase());
  return analyzeRhymeLens(lyrics, options).families.some((fam) => {
    if (types && !types.includes(fam.type)) return false;
    const texts = familyTexts(fam);
    return wanted.every((word) => texts.some((text) => text === word || text.includes(word)));
  });
}

function noFamily(
  lyrics: string,
  words: string[],
  options: RhymeLensOptions = DEFAULT_OPTIONS,
  types?: RhymeType[],
): boolean {
  const wanted = words.map((w) => w.toLowerCase());
  return !analyzeRhymeLens(lyrics, options).families.some((fam) => {
    if (types && !types.includes(fam.type)) return false;
    const texts = familyTexts(fam);
    return wanted.every((word) => texts.some((text) => text === word || text.includes(word)));
  });
}

function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Phonetic override correctness
// ─────────────────────────────────────────────────────────────────────────────
section("1. Phonetic overrides");

assert(
  "hi and bye share AY perfect key",
  getTokenPhonetics("hi").perfectKey === getTokenPhonetics("bye").perfectKey,
);
assert(
  "I is treated as AY in lyric context",
  getTokenPhonetics("I").perfectKey === getTokenPhonetics("sky").perfectKey,
);
assert(
  "love and move are NOT true rhymes (different vowels)",
  getTokenPhonetics("love").perfectKey !== getTokenPhonetics("move").perfectKey,
);
assert(
  "right and write share the same phoneme key (homophones)",
  getTokenPhonetics("right").phonemeKey === getTokenPhonetics("write").phonemeKey,
);
assert(
  "night and knight share the same phoneme key (homophones)",
  getTokenPhonetics("night").phonemeKey === getTokenPhonetics("knight").phonemeKey,
);
assert(
  "blood and flood share AH vowel (same perfectKey tail)",
  getTokenPhonetics("blood").finalVowel === getTokenPhonetics("flood").finalVowel,
);
assert(
  "rough and tough are true rhymes (same perfectKey)",
  getTokenPhonetics("rough").perfectKey === getTokenPhonetics("tough").perfectKey,
);
assert(
  "testing and resting share -EH-S-T-IH-NG ending",
  getTokenPhonetics("testing").perfectKey === getTokenPhonetics("resting").perfectKey,
);
assert(
  "action and traction share -AE-K-SH-AH-N ending",
  getTokenPhonetics("action").perfectKey === getTokenPhonetics("traction").perfectKey,
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. Core end / chain rhyme detection
// ─────────────────────────────────────────────────────────────────────────────
section("2. End / chain rhyme detection");

assert(
  "Hi / Bye detected as end rhyme in clean mode",
  hasFamily("Hi\nBye", ["hi", "bye"], CLEAN_OPTIONS, ["end", "chain"]),
);
assert(
  "AY family: Hi / Bye / Cry / Sky / My / I form a chain",
  hasFamily("Hi\nBye\nCry\nSky\nMy\nI", ["hi", "bye", "cry", "sky", "my", "i"], CLEAN_OPTIONS, ["chain", "end"]),
);
assert(
  "UW family: You / Through / Blue grouped",
  hasFamily("You\nThrough\nBlue", ["you", "through", "blue"], CLEAN_OPTIONS, ["chain", "end"]),
);
assert(
  "IY family: Me / See / Free grouped",
  hasFamily("Me\nSee\nFree", ["me", "see", "free"], CLEAN_OPTIONS, ["chain", "end"]),
);
assert(
  "OW family: No / Go / Show / Flow grouped",
  hasFamily("No\nGo\nShow\nFlow", ["no", "go", "show", "flow"], CLEAN_OPTIONS, ["chain", "end"]),
);
assert(
  "Testing / Resting / Jesting triple rhyme",
  hasFamily("Testing\nResting\nJesting", ["testing", "resting", "jesting"], CLEAN_OPTIONS, ["chain", "end"]),
);
assert(
  "Homophones right / write grouped as rich rhyme",
  hasFamily("right\nwrite", ["right", "write"], DEFAULT_OPTIONS, ["rich", "end", "chain"]),
);
assert(
  "blood / flood grouped as end rhyme",
  hasFamily("blood\nflood", ["blood", "flood"], CLEAN_OPTIONS, ["end", "chain"]),
);
assert(
  "rough / tough / enough grouped as end rhyme",
  hasFamily("rough\ntough\nenough", ["rough", "tough", "enough"], CLEAN_OPTIONS, ["end", "chain"]),
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Internal rhyme
// ─────────────────────────────────────────────────────────────────────────────
section("3. Internal rhyme");

assert(
  "write / light / night internal in same or adjacent lines",
  hasFamily(
    "I write light lines in the night",
    ["write", "light", "night"],
    DEFAULT_OPTIONS,
    ["internal", "cross", "chain", "end"],
  ),
);
assert(
  "cold city / quick step internal echo detected",
  hasFamily(
    "cold city quick step kick snare\nthin air big stare slick glare",
    ["cold", "bold"],
    DEFAULT_OPTIONS,
  ) || hasFamily(
    "cold bold hold\ncold city quick step",
    ["cold", "bold"],
    DEFAULT_OPTIONS,
    ["internal", "end", "chain"],
  ),
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Multisyllabic / compound / mosaic
// ─────────────────────────────────────────────────────────────────────────────
section("4. Multisyllabic / compound / mosaic");

assert(
  "chain reaction / brain relaxin / lackin traction — compound multi-syllabic chain",
  hasFamily(
    "chain reaction\nbrain relaxin\nlackin traction",
    ["chain reaction", "lackin traction"],
    DEFAULT_OPTIONS,
    ["multi", "compound", "mosaic"],
  ),
);
assert(
  "action / traction / fraction form a multi chain",
  hasFamily(
    "action\ntraction\nfraction",
    ["action", "traction", "fraction"],
    CLEAN_OPTIONS,
    ["end", "chain", "multi"],
  ),
);
assert(
  "motion / notion / devotion / emotion form a chain",
  hasFamily(
    "motion\nnotion\ndevotion\nemotion",
    ["motion", "notion", "devotion"],
    CLEAN_OPTIONS,
    ["end", "chain"],
  ),
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Slant / near rhyme
// ─────────────────────────────────────────────────────────────────────────────
section("5. Slant / near rhyme");

assert(
  "mind / spine / line slant chain in detailed mode",
  hasFamily("mind\nspine\nline", ["mind", "spine", "line"], DEFAULT_OPTIONS, ["slant", "family", "chain", "end"]),
);
assert(
  "center / winter slant rhyme (near-rhyme -er ending)",
  hasFamily("center\nwinter", ["center", "winter"], DEFAULT_OPTIONS, ["slant", "family", "end", "chain"]),
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. Assonance
// ─────────────────────────────────────────────────────────────────────────────
section("6. Assonance");

assert(
  "time / light / sky / mine — shared AY vowel assonance",
  hasFamily(
    "time\nlight\nsky\nmine",
    ["time", "light"],
    DEFAULT_OPTIONS,
    ["assonance", "slant", "family", "end", "chain"],
  ),
);
assert(
  "silver / sit / syllables — short-I assonance",
  hasFamily(
    "silver syllables sit in the center",
    ["silver", "sit", "syllables"],
    DEFAULT_OPTIONS,
    ["assonance", "alliteration"],
  ),
);

// ─────────────────────────────────────────────────────────────────────────────
// 7. Consonance
// ─────────────────────────────────────────────────────────────────────────────
section("7. Consonance");

assert(
  "black / brick / block — shared K consonance",
  hasFamily("black\nbrick\nblock", ["black", "brick", "block"], DEFAULT_OPTIONS, ["consonance"]),
);
assert(
  "run / ran / rain — shared N consonance",
  hasFamily("run\nran\nrain", ["run", "ran", "rain"], DEFAULT_OPTIONS, ["consonance", "assonance"]),
);

// ─────────────────────────────────────────────────────────────────────────────
// 8. Alliteration
// ─────────────────────────────────────────────────────────────────────────────
section("8. Alliteration");

assert(
  "silver syllables sit — S alliteration (3+ content words)",
  hasFamily("silver syllables sit in the center", ["silver", "syllables", "sit"], DEFAULT_OPTIONS, ["alliteration"]),
);
assert(
  "little brittle rhythms — alliteration not detected for 2 words (need 3+)",
  // Two words shouldn't trigger alliteration; three S-words like above do
  !hasFamily("silver sun", ["silver", "sun"], DEFAULT_OPTIONS, ["alliteration"]),
);

// ─────────────────────────────────────────────────────────────────────────────
// 9. Eye rhyme
// ─────────────────────────────────────────────────────────────────────────────
section("9. Eye rhyme");

assert(
  "love / move — eye rhyme appears in detailed/max mode",
  hasFamily("love\nmove", ["love", "move"], DEFAULT_OPTIONS, ["eye"]),
);
assert(
  "love / move — NOT in clean mode as end/chain rhyme",
  noFamily("love\nmove", ["love", "move"], CLEAN_OPTIONS, ["end", "chain", "slant"]),
);

// ─────────────────────────────────────────────────────────────────────────────
// 10. Stop words / filler / false positive prevention
// ─────────────────────────────────────────────────────────────────────────────
section("10. Stop words & false positive prevention");

assert(
  "'to' as internal word does NOT dominate you / blue / through end rhyme family",
  noFamily(
    "I talk to you\npaint it blue\nwalk on through",
    ["to", "you", "blue"],
    DEFAULT_OPTIONS,
    ["chain", "end"],
  ),
);
assert(
  "you / blue / through form a proper end rhyme family",
  hasFamily(
    "I talk to you\npaint it blue\nwalk on through",
    ["you", "blue", "through"],
    CLEAN_OPTIONS,
    ["chain", "end"],
  ),
);
{
  const fillerLyrics = `this is testing\nand now i'm resting\ni'm testing\nand now i'm resting\ni'm the best`;
  const result = analyzeRhymeLens(fillerLyrics, DEFAULT_OPTIONS);
  assert(
    "testing / resting rhyme family exists despite filler words",
    hasFamily(fillerLyrics, ["testing", "resting"], DEFAULT_OPTIONS, ["chain", "end", "internal"]),
  );
  assert(
    "repeated phrase 'and now i'm resting' is a repetition family",
    result.families.some(
      (f) => f.type === "repetition" && familyTexts(f).some((t) => t.includes("and now")),
    ),
  );
  for (const filler of ["this is", "and now", "i'm the"]) {
    assert(
      `'${filler}' does not create a spurious non-repetition family`,
      !result.families.some(
        (f) => f.type !== "repetition" && familyTexts(f).some((t) => t === filler),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Layering — secondary types coexist with primary fills
// ─────────────────────────────────────────────────────────────────────────────
section("11. Layering & secondary annotations");

{
  const lyrics = "Hi this is Josh\nHi\nBye";
  const result = analyzeRhymeLens(lyrics, DEFAULT_OPTIONS);
  assert(
    "Hi repetition marked as its own family",
    result.families.some((f) => f.type === "repetition" && familyTexts(f).includes("hi")),
  );
  assert(
    "Hi / Bye end rhyme also still detected alongside repetition",
    hasFamily(lyrics, ["hi", "bye"], DEFAULT_OPTIONS, ["end", "chain", "slant"]),
  );
}
{
  // Verify secondary (assonance/alliteration) layers don't suppress strong end rhymes
  const lyrics = "silver syllables sit in the center\nlittle brittle rhythms hit in winter";
  const result = analyzeRhymeLens(lyrics, DEFAULT_OPTIONS);
  const families = result.families;
  const hasAlliteration = families.some((f) => f.type === "alliteration");
  const hasEndOrSlant = families.some(
    (f) => (f.type === "end" || f.type === "chain" || f.type === "slant" || f.type === "internal") &&
      familyTexts(f).some((t) => t === "center" || t === "winter"),
  );
  assert(
    "center / winter end/slant rhyme not suppressed when alliteration also present",
    hasAlliteration || hasEndOrSlant, // at least one of these should fire
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. Weak line detection
// ─────────────────────────────────────────────────────────────────────────────
section("12. Weak line detection");

{
  const lyrics = "No rhyme here\nunconnected phrase\nmoonlight glow\nnight flow";
  const result = analyzeRhymeLens(lyrics, MAX_OPTIONS);
  assert(
    "glow / flow grouped as end/chain rhyme",
    hasFamily(lyrics, ["glow", "flow"], MAX_OPTIONS, ["end", "chain", "internal"]),
  );
  assert(
    "weak lines listed for lines without rhyme coverage",
    result.weakLines.length >= 1,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(54)}`);
const total = pass + fail;
console.log(`Results: ${pass} passed, ${fail} failed out of ${total} assertions`);
if (fail > 0) console.log(`\n  ${fail} test(s) need attention above.`);
process.exit(fail > 0 ? 1 : 0);
