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
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
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

section("Phonetic overrides");
assert("hi and bye share AY key", getTokenPhonetics("hi").perfectKey === getTokenPhonetics("bye").perfectKey);
assert("I is treated as AY in lyric context", getTokenPhonetics("I").perfectKey === getTokenPhonetics("sky").perfectKey);
assert("love and move are not true sound rhymes", getTokenPhonetics("love").perfectKey !== getTokenPhonetics("move").perfectKey);

section("Required Rhyme Lens cases");
assert("Hi/Bye perfect end rhyme", hasFamily("Hi\nBye", ["hi", "bye"], CLEAN_OPTIONS, ["end", "chain"]));
assert("AY family groups Hi/Bye/Cry/Sky/My/I", hasFamily("Hi\nBye\nCry\nSky\nMy\nI", ["hi", "bye", "cry", "sky", "my", "i"], CLEAN_OPTIONS, ["chain", "end"]));
assert("OO family groups You/Through/Blue", hasFamily("You\nThrough\nBlue", ["you", "through", "blue"], CLEAN_OPTIONS, ["chain", "end"]));
assert("EE family groups Me/See/Free", hasFamily("Me\nSee\nFree", ["me", "see", "free"], CLEAN_OPTIONS, ["chain", "end"]));
assert("OH family groups No/Go/Show/Flow", hasFamily("No\nGo\nShow\nFlow", ["no", "go", "show", "flow"], CLEAN_OPTIONS, ["chain", "end"]));
assert("Testing/Resting/Jesting double rhyme", hasFamily("Testing\nResting\nJesting", ["testing", "resting", "jesting"], CLEAN_OPTIONS, ["chain", "end"]));
assert("Internal write/light/night relationship", hasFamily("I write light lines in the night", ["write", "light", "night"], DEFAULT_OPTIONS, ["internal", "cross", "chain"]));
assert("Multisyllabic compound chain", hasFamily("chain reaction\nbrain relaxin\nlackin traction", ["chain reaction", "brain relaxin", "lackin traction"], DEFAULT_OPTIONS, ["multi", "compound", "mosaic"]));
assert("Slant mind/spine/line in detailed mode", hasFamily("mind\nspine\nline", ["mind", "spine", "line"], DEFAULT_OPTIONS, ["slant", "family", "chain", "end"]));
assert("Assonance time/light/sky/mine", hasFamily("time\nlight\nsky\nmine", ["time", "light", "sky", "mine"], DEFAULT_OPTIONS, ["assonance", "slant", "family"]));
assert("Consonance black/brick/block", hasFamily("black\nbrick\nblock", ["black", "brick", "block"], DEFAULT_OPTIONS, ["consonance"]));
assert("Alliteration silver/syllables/sit", hasFamily("silver syllables sit", ["silver", "syllables", "sit"], DEFAULT_OPTIONS, ["alliteration"]));
assert("Rich homophone right/write", hasFamily("right\nwrite", ["right", "write"], DEFAULT_OPTIONS, ["rich", "end", "chain"]));
assert("Eye rhyme love/move appears in detailed/max", hasFamily("love\nmove", ["love", "move"], DEFAULT_OPTIONS, ["eye"]));
assert("Eye rhyme love/move not in clean mode", noFamily("love\nmove", ["love", "move"], CLEAN_OPTIONS, ["eye", "end", "chain", "slant"]));
assert("You/blue/through dominate over internal to", hasFamily("I talk to you\npaint it blue\nwalk on through", ["you", "blue", "through"], CLEAN_OPTIONS, ["chain", "end"]));
assert("Internal 'to' does not dominate", noFamily("I talk to you\npaint it blue\nwalk on through", ["to", "you", "blue"], DEFAULT_OPTIONS, ["chain", "end", "slant", "assonance"]));

section("Stop words and repetition");
{
  const lyrics = `this is testing
and now i'm resting
i'm testing
and now i'm resting
i'm the best`;
  const result = analyzeRhymeLens(lyrics, DEFAULT_OPTIONS);
  assert("testing/resting family exists", hasFamily(lyrics, ["testing", "resting"], DEFAULT_OPTIONS, ["chain", "end", "internal"]));
  assert("repeated long phrase is separate", result.families.some((f) => f.type === "repetition" && familyTexts(f).some((t) => t.includes("and now i'm resting"))));
  for (const filler of ["this is", "and now", "i'm the", "the best"]) {
    assert(`${filler} is not a filler family`, !result.families.some((f) => f.type !== "repetition" && familyTexts(f).some((t) => t === filler)));
  }
}

section("Layering and weak lines");
{
  const lyrics = "Hi this is Josh\nHi\nBye";
  const result = analyzeRhymeLens(lyrics, DEFAULT_OPTIONS);
  assert("Hi repetition marked separately", result.families.some((f) => f.type === "repetition" && familyTexts(f).includes("hi")));
  assert("Hi/Bye rhyme still detected", hasFamily(lyrics, ["hi", "bye"], DEFAULT_OPTIONS, ["end", "chain", "slant"]));
}
{
  const lyrics = "No rhyme here\nunconnected phrase\nmoonlight glow\nnight flow";
  const result = analyzeRhymeLens(lyrics, MAX_OPTIONS);
  assert("glow/flow grouped", hasFamily(lyrics, ["glow", "flow"], MAX_OPTIONS, ["end", "chain", "internal"]));
  assert("weak lines listed gently", result.weakLines.length >= 1);
}

console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${pass} passed, ${fail} failed out of ${pass + fail} assertions`);
process.exit(fail > 0 ? 1 : 0);
