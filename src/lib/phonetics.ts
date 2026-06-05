export type PronunciationSource = "override" | "lexicon" | "g2p";

export type Pronunciation = {
  phonemes: string[];
  source: PronunciationSource;
  stressIndex?: number;
};

export type TokenPhonetics = {
  normalized: string;
  pronunciations: Pronunciation[];
  perfectKey: string;
  endingKey: string;
  assonanceKey: string;
  consonanceKey: string;
  alliterationKey: string;
  familyKey: string;
  eyeKey: string;
  syllableCount: number;
  finalVowel: string;
  finalConsonants: string;
  initialConsonants: string;
  vowelSkeleton: string;
  consonantSkeleton: string;
  phonemeKey: string;
};

const VOWELS = new Set([
  "AA", "AE", "AH", "AO", "AW", "AY",
  "EH", "ER", "EY", "IH", "IY",
  "OW", "OY", "UH", "UW",
]);

const CONSONANT_FAMILIES: Record<string, string> = {
  P: "PB", B: "PB",
  T: "TD", D: "TD",
  K: "KG", G: "KG",
  F: "FV", V: "FV",
  S: "SZ", Z: "SZ",
  SH: "SHCHJ", ZH: "SHCHJ", CH: "SHCHJ", JH: "SHCHJ",
  M: "MN", N: "MN",
  L: "LR", R: "LR",
};

// ---------------------------------------------------------------------------
// Large curated override set  ← the heart of the phonetics upgrade
// ---------------------------------------------------------------------------
// Format: word → primary pronunciation (CMU-style ARPAbet with stress 0/1/2)
// Words are lower-cased normalized forms.

const OVERRIDES: Record<string, string[]> = {

  // ── AY / long-I family ────────────────────────────────────────────────────
  hi: ["HH", "AY1"],
  bye: ["B", "AY1"],
  my: ["M", "AY1"],
  why: ["W", "AY1"],
  cry: ["K", "R", "AY1"],
  fly: ["F", "L", "AY1"],
  sky: ["S", "K", "AY1"],
  eye: ["AY1"],
  i: ["AY1"],
  die: ["D", "AY1"],
  lie: ["L", "AY1"],
  pie: ["P", "AY1"],
  tie: ["T", "AY1"],
  high: ["HH", "AY1"],
  night: ["N", "AY1", "T"],
  knight: ["N", "AY1", "T"],
  right: ["R", "AY1", "T"],
  write: ["R", "AY1", "T"],
  light: ["L", "AY1", "T"],
  fight: ["F", "AY1", "T"],
  sight: ["S", "AY1", "T"],
  might: ["M", "AY1", "T"],
  tight: ["T", "AY1", "T"],
  white: ["W", "AY1", "T"],
  bright: ["B", "R", "AY1", "T"],
  height: ["HH", "AY1", "T"],
  bite: ["B", "AY1", "T"],
  kite: ["K", "AY1", "T"],
  quite: ["K", "W", "AY1", "T"],
  line: ["L", "AY1", "N"],
  lines: ["L", "AY1", "N", "Z"],
  time: ["T", "AY1", "M"],
  mine: ["M", "AY1", "N"],
  mind: ["M", "AY1", "N", "D"],
  spine: ["S", "P", "AY1", "N"],
  fine: ["F", "AY1", "N"],
  wine: ["W", "AY1", "N"],
  vine: ["V", "AY1", "N"],
  shine: ["SH", "AY1", "N"],
  sign: ["S", "AY1", "N"],
  kind: ["K", "AY1", "N", "D"],
  find: ["F", "AY1", "N", "D"],
  blind: ["B", "L", "AY1", "N", "D"],
  grind: ["G", "R", "AY1", "N", "D"],
  slide: ["S", "L", "AY1", "D"],
  ride: ["R", "AY1", "D"],
  hide: ["HH", "AY1", "D"],
  pride: ["P", "R", "AY1", "D"],
  side: ["S", "AY1", "D"],
  wide: ["W", "AY1", "D"],
  guide: ["G", "AY1", "D"],
  rise: ["R", "AY1", "Z"],
  prize: ["P", "R", "AY1", "Z"],
  wise: ["W", "AY1", "Z"],
  size: ["S", "AY1", "Z"],
  lies: ["L", "AY1", "Z"],
  skies: ["S", "K", "AY1", "Z"],
  ties: ["T", "AY1", "Z"],
  tries: ["T", "R", "AY1", "Z"],
  fire: ["F", "AY1", "R"],
  hire: ["HH", "AY1", "R"],
  wire: ["W", "AY1", "R"],
  desire: ["D", "IH0", "Z", "AY1", "R"],
  inspire: ["IH0", "N", "S", "P", "AY1", "R"],
  higher: ["HH", "AY1", "R"],
  dryer: ["D", "R", "AY1", "R"],
  flyer: ["F", "L", "AY1", "R"],
  alive: ["AH0", "L", "AY1", "V"],
  drive: ["D", "R", "AY1", "V"],
  five: ["F", "AY1", "V"],
  thrive: ["TH", "R", "AY1", "V"],
  strive: ["S", "T", "R", "AY1", "V"],
  vibe: ["V", "AY1", "B"],
  tribe: ["T", "R", "AY1", "B"],
  type: ["T", "AY1", "P"],
  life: ["L", "AY1", "F"],
  strife: ["S", "T", "R", "AY1", "F"],
  knife: ["N", "AY1", "F"],
  wife: ["W", "AY1", "F"],
  like: ["L", "AY1", "K"],
  strike: ["S", "T", "R", "AY1", "K"],
  spike: ["S", "P", "AY1", "K"],
  hike: ["HH", "AY1", "K"],
  bike: ["B", "AY1", "K"],
  mic: ["M", "AY1", "K"],
  mike: ["M", "AY1", "K"],
  psych: ["S", "AY1", "K"],
  ice: ["AY1", "S"],
  price: ["P", "R", "AY1", "S"],
  nice: ["N", "AY1", "S"],
  dice: ["D", "AY1", "S"],
  rice: ["R", "AY1", "S"],
  twice: ["T", "W", "AY1", "S"],
  slice: ["S", "L", "AY1", "S"],
  spice: ["S", "P", "AY1", "S"],
  device: ["D", "IH0", "V", "AY1", "S"],

  // ── OW / long-O family ────────────────────────────────────────────────────
  oh: ["OW1"],
  yo: ["Y", "OW1"],
  no: ["N", "OW1"],
  go: ["G", "OW1"],
  so: ["S", "OW1"],
  show: ["SH", "OW1"],
  flow: ["F", "L", "OW1"],
  glow: ["G", "L", "OW1"],
  blow: ["B", "L", "OW1"],
  snow: ["S", "N", "OW1"],
  grow: ["G", "R", "OW1"],
  throw: ["TH", "R", "OW1"],
  though: ["DH", "OW1"],
  dough: ["D", "OW1"],
  owe: ["OW1"],
  low: ["L", "OW1"],
  slow: ["S", "L", "OW1"],
  know: ["N", "OW1"],
  row: ["R", "OW1"],          // row a boat
  sow: ["S", "OW1"],          // sow seeds
  tow: ["T", "OW1"],
  bow: ["B", "OW1"],          // bow and arrow / take a bow
  foe: ["F", "OW1"],
  toe: ["T", "OW1"],
  woe: ["W", "OW1"],
  doe: ["D", "OW1"],
  hoe: ["HH", "OW1"],
  joe: ["JH", "OW1"],
  mow: ["M", "OW1"],
  polo: ["P", "OW1", "L", "OW0"],
  solo: ["S", "OW1", "L", "OW0"],
  memo: ["M", "EH1", "M", "OW0"],
  cold: ["K", "OW1", "L", "D"],
  bold: ["B", "OW1", "L", "D"],
  gold: ["G", "OW1", "L", "D"],
  told: ["T", "OW1", "L", "D"],
  sold: ["S", "OW1", "L", "D"],
  hold: ["HH", "OW1", "L", "D"],
  old: ["OW1", "L", "D"],
  mold: ["M", "OW1", "L", "D"],
  road: ["R", "OW1", "D"],
  load: ["L", "OW1", "D"],
  code: ["K", "OW1", "D"],
  mode: ["M", "OW1", "D"],
  node: ["N", "OW1", "D"],
  pole: ["P", "OW1", "L"],
  role: ["R", "OW1", "L"],
  soul: ["S", "OW1", "L"],
  whole: ["HH", "OW1", "L"],
  hole: ["HH", "OW1", "L"],
  bowl: ["B", "OW1", "L"],
  goal: ["G", "OW1", "L"],
  scroll: ["S", "K", "R", "OW1", "L"],
  toll: ["T", "OW1", "L"],
  roll: ["R", "OW1", "L"],
  stroll: ["S", "T", "R", "OW1", "L"],
  home: ["HH", "OW1", "M"],
  foam: ["F", "OW1", "M"],
  roam: ["R", "OW1", "M"],
  poem: ["P", "OW1", "AH0", "M"],
  poet: ["P", "OW1", "AH0", "T"],
  bone: ["B", "OW1", "N"],
  stone: ["S", "T", "OW1", "N"],
  tone: ["T", "OW1", "N"],
  zone: ["Z", "OW1", "N"],
  phone: ["F", "OW1", "N"],
  throne: ["TH", "R", "OW1", "N"],
  groan: ["G", "R", "OW1", "N"],
  moan: ["M", "OW1", "N"],
  lone: ["L", "OW1", "N"],
  known: ["N", "OW1", "N"],
  shown: ["SH", "OW1", "N"],
  grown: ["G", "R", "OW1", "N"],
  blown: ["B", "L", "OW1", "N"],
  thrown: ["TH", "R", "OW1", "N"],
  own: ["OW1", "N"],
  cope: ["K", "OW1", "P"],
  hope: ["HH", "OW1", "P"],
  rope: ["R", "OW1", "P"],
  slope: ["S", "L", "OW1", "P"],
  smoke: ["S", "M", "OW1", "K"],
  spoke: ["S", "P", "OW1", "K"],
  woke: ["W", "OW1", "K"],
  broke: ["B", "R", "OW1", "K"],
  joke: ["JH", "OW1", "K"],
  cloak: ["K", "L", "OW1", "K"],
  close: ["K", "L", "OW1", "Z"],      // adjective/verb
  nose: ["N", "OW1", "Z"],
  rose: ["R", "OW1", "Z"],
  pose: ["P", "OW1", "Z"],
  those: ["DH", "OW1", "Z"],
  note: ["N", "OW1", "T"],
  quote: ["K", "W", "OW1", "T"],
  vote: ["V", "OW1", "T"],
  float: ["F", "L", "OW1", "T"],
  coat: ["K", "OW1", "T"],
  boat: ["B", "OW1", "T"],
  throat: ["TH", "R", "OW1", "T"],
  goat: ["G", "OW1", "T"],
  wrote: ["R", "OW1", "T"],
  drove: ["D", "R", "OW1", "V"],
  wove: ["W", "OW1", "V"],
  stove: ["S", "T", "OW1", "V"],
  cove: ["K", "OW1", "V"],
  flowing: ["F", "L", "OW1", "IH0", "NG"],
  going: ["G", "OW1", "IH0", "NG"],
  goin: ["G", "OW1", "IH0", "N"],
  glowing: ["G", "L", "OW1", "IH0", "NG"],
  knowing: ["N", "OW1", "IH0", "NG"],
  showing: ["SH", "OW1", "IH0", "NG"],
  growing: ["G", "R", "OW1", "IH0", "NG"],

  // ── AW / OW-diphthong (cow) family ───────────────────────────────────────
  cow: ["K", "AW1"],
  now: ["N", "AW1"],
  how: ["HH", "AW1"],
  wow: ["W", "AW1"],
  brow: ["B", "R", "AW1"],
  bough: ["B", "AW1"],
  allow: ["AH0", "L", "AW1"],
  around: ["AH0", "R", "AW1", "N", "D"],
  down: ["D", "AW1", "N"],
  town: ["T", "AW1", "N"],
  brown: ["B", "R", "AW1", "N"],
  crown: ["K", "R", "AW1", "N"],
  found: ["F", "AW1", "N", "D"],
  ground: ["G", "R", "AW1", "N", "D"],
  sound: ["S", "AW1", "N", "D"],
  bound: ["B", "AW1", "N", "D"],
  round: ["R", "AW1", "N", "D"],
  pound: ["P", "AW1", "N", "D"],
  proud: ["P", "R", "AW1", "D"],
  loud: ["L", "AW1", "D"],
  cloud: ["K", "L", "AW1", "D"],
  shout: ["SH", "AW1", "T"],
  out: ["AW1", "T"],
  about: ["AH0", "B", "AW1", "T"],
  mouth: ["M", "AW1", "TH"],
  south: ["S", "AW1", "TH"],
  house: ["HH", "AW1", "S"],
  mouse: ["M", "AW1", "S"],
  couch: ["K", "AW1", "CH"],
  pouch: ["P", "AW1", "CH"],
  flower: ["F", "L", "AW1", "R"],
  power: ["P", "AW1", "R"],
  tower: ["T", "AW1", "R"],
  hour: ["AW1", "R"],
  our: ["AW1", "R"],
  sour: ["S", "AW1", "R"],
  devour: ["D", "IH0", "V", "AW1", "R"],

  // ── UW / long-OO family ───────────────────────────────────────────────────
  you: ["Y", "UW1"],
  too: ["T", "UW1"],
  to: ["T", "UW1"],
  through: ["TH", "R", "UW1"],
  blue: ["B", "L", "UW1"],
  who: ["HH", "UW1"],
  do: ["D", "UW1"],
  two: ["T", "UW1"],
  true: ["T", "R", "UW1"],
  new: ["N", "UW1"],
  knew: ["N", "UW1"],
  dew: ["D", "UW1"],
  grew: ["G", "R", "UW1"],
  crew: ["K", "R", "UW1"],
  brew: ["B", "R", "UW1"],
  drew: ["D", "R", "UW1"],
  flew: ["F", "L", "UW1"],
  threw: ["TH", "R", "UW1"],
  blew: ["B", "L", "UW1"],
  clue: ["K", "L", "UW1"],
  glue: ["G", "L", "UW1"],
  shoe: ["SH", "UW1"],
  sue: ["S", "UW1"],
  rue: ["R", "UW1"],
  cue: ["K", "YUW1"],
  queue: ["K", "YUW1"],
  hue: ["HH", "YUW1"],
  view: ["V", "YUW1"],
  few: ["F", "YUW1"],
  dude: ["D", "UW1", "D"],
  rude: ["R", "UW1", "D"],
  mood: ["M", "UW1", "D"],
  food: ["F", "UW1", "D"],
  good: ["G", "UH1", "D"],       // ← UH not UW
  wood: ["W", "UH1", "D"],
  should: ["SH", "UH1", "D"],
  could: ["K", "UH1", "D"],
  would: ["W", "UH1", "D"],
  stood: ["S", "T", "UH1", "D"],
  hood: ["HH", "UH1", "D"],
  look: ["L", "UH1", "K"],
  book: ["B", "UH1", "K"],
  cook: ["K", "UH1", "K"],
  hook: ["HH", "UH1", "K"],
  took: ["T", "UH1", "K"],
  shook: ["SH", "UH1", "K"],
  put: ["P", "UH1", "T"],
  full: ["F", "UH1", "L"],
  pull: ["P", "UH1", "L"],
  bull: ["B", "UH1", "L"],
  push: ["P", "UH1", "SH"],
  bush: ["B", "UH1", "SH"],
  cool: ["K", "UW1", "L"],
  fool: ["F", "UW1", "L"],
  pool: ["P", "UW1", "L"],
  tool: ["T", "UW1", "L"],
  rule: ["R", "UW1", "L"],
  school: ["S", "K", "UW1", "L"],
  room: ["R", "UW1", "M"],
  boom: ["B", "UW1", "M"],
  doom: ["D", "UW1", "M"],
  bloom: ["B", "L", "UW1", "M"],
  zoom: ["Z", "UW1", "M"],
  moon: ["M", "UW1", "N"],
  soon: ["S", "UW1", "N"],
  tune: ["T", "UW1", "N"],
  dune: ["D", "UW1", "N"],
  spoon: ["S", "P", "UW1", "N"],
  noon: ["N", "UW1", "N"],
  boon: ["B", "UW1", "N"],
  loon: ["L", "UW1", "N"],
  loop: ["L", "UW1", "P"],
  hoop: ["HH", "UW1", "P"],
  troop: ["T", "R", "UW1", "P"],
  swoop: ["S", "W", "UW1", "P"],
  stoop: ["S", "T", "UW1", "P"],
  root: ["R", "UW1", "T"],
  boot: ["B", "UW1", "T"],
  loot: ["L", "UW1", "T"],
  scoot: ["S", "K", "UW1", "T"],
  suit: ["S", "UW1", "T"],
  fruit: ["F", "R", "UW1", "T"],
  shoot: ["SH", "UW1", "T"],
  cute: ["K", "YUW1", "T"],
  mute: ["M", "YUW1", "T"],
  use: ["Y", "UW1", "Z"],        // verb
  bruise: ["B", "R", "UW1", "Z"],
  cruise: ["K", "R", "UW1", "Z"],
  lose: ["L", "UW1", "Z"],
  choose: ["CH", "UW1", "Z"],
  move: ["M", "UW1", "V"],
  prove: ["P", "R", "UW1", "V"],
  groove: ["G", "R", "UW1", "V"],
  smooth: ["S", "M", "UW1", "DH"],
  tooth: ["T", "UW1", "TH"],
  truth: ["T", "R", "UW1", "TH"],
  youth: ["Y", "UW1", "TH"],

  // ── UH (short-OO: blood/flood, and AH-like) ───────────────────────────────
  blood: ["B", "L", "AH1", "D"],
  flood: ["F", "L", "AH1", "D"],
  love: ["L", "AH1", "V"],
  shove: ["SH", "AH1", "V"],
  above: ["AH0", "B", "AH1", "V"],
  glove: ["G", "L", "AH1", "V"],
  dove: ["D", "AH1", "V"],     // bird (rhymes with love)
  enough: ["IH0", "N", "AH1", "F"],
  rough: ["R", "AH1", "F"],
  tough: ["T", "AH1", "F"],
  stuff: ["S", "T", "AH1", "F"],
  bluff: ["B", "L", "AH1", "F"],
  gruff: ["G", "R", "AH1", "F"],
  huff: ["HH", "AH1", "F"],
  puff: ["P", "AH1", "F"],
  scuff: ["S", "K", "AH1", "F"],
  snuff: ["S", "N", "AH1", "F"],
  fluff: ["F", "L", "AH1", "F"],
  buff: ["B", "AH1", "F"],
  cuff: ["K", "AH1", "F"],
  duff: ["D", "AH1", "F"],
  muff: ["M", "AH1", "F"],
  rug: ["R", "AH1", "G"],
  drug: ["D", "R", "AH1", "G"],
  bug: ["B", "AH1", "G"],
  mug: ["M", "AH1", "G"],
  hug: ["HH", "AH1", "G"],
  plug: ["P", "L", "AH1", "G"],
  slug: ["S", "L", "AH1", "G"],
  shrug: ["SH", "R", "AH1", "G"],
  snug: ["S", "N", "AH1", "G"],
  thug: ["TH", "AH1", "G"],
  tug: ["T", "AH1", "G"],
  dug: ["D", "AH1", "G"],
  jug: ["JH", "AH1", "G"],
  lug: ["L", "AH1", "G"],
  run: ["R", "AH1", "N"],
  fun: ["F", "AH1", "N"],
  sun: ["S", "AH1", "N"],
  son: ["S", "AH1", "N"],
  gun: ["G", "AH1", "N"],
  done: ["D", "AH1", "N"],
  none: ["N", "AH1", "N"],
  nun: ["N", "AH1", "N"],
  won: ["W", "AH1", "N"],
  one: ["W", "AH1", "N"],
  ton: ["T", "AH1", "N"],
  bun: ["B", "AH1", "N"],
  stun: ["S", "T", "AH1", "N"],
  spun: ["S", "P", "AH1", "N"],
  cup: ["K", "AH1", "P"],
  pup: ["P", "AH1", "P"],
  sup: ["S", "AH1", "P"],
  up: ["AH1", "P"],
  cut: ["K", "AH1", "T"],
  gut: ["G", "AH1", "T"],
  but: ["B", "AH1", "T"],
  hut: ["HH", "AH1", "T"],
  nut: ["N", "AH1", "T"],
  shut: ["SH", "AH1", "T"],
  strut: ["S", "T", "R", "AH1", "T"],
  rut: ["R", "AH1", "T"],
  mutt: ["M", "AH1", "T"],
  butt: ["B", "AH1", "T"],

  // ── AO / aw family (cough/off/thought) ───────────────────────────────────
  cough: ["K", "AO1", "F"],
  off: ["AO1", "F"],
  thought: ["TH", "AO1", "T"],
  bought: ["B", "AO1", "T"],
  fought: ["F", "AO1", "T"],
  caught: ["K", "AO1", "T"],
  taught: ["T", "AO1", "T"],
  naught: ["N", "AO1", "T"],
  ought: ["AO1", "T"],
  taut: ["T", "AO1", "T"],
  law: ["L", "AO1"],
  raw: ["R", "AO1"],
  saw: ["S", "AO1"],
  draw: ["D", "R", "AO1"],
  jaw: ["JH", "AO1"],
  flaw: ["F", "L", "AO1"],
  paw: ["P", "AO1"],
  claw: ["K", "L", "AO1"],
  thaw: ["TH", "AO1"],
  awe: ["AO1"],
  ball: ["B", "AO1", "L"],
  call: ["K", "AO1", "L"],
  fall: ["F", "AO1", "L"],
  hall: ["HH", "AO1", "L"],
  tall: ["T", "AO1", "L"],
  wall: ["W", "AO1", "L"],
  all: ["AO1", "L"],
  small: ["S", "M", "AO1", "L"],
  stall: ["S", "T", "AO1", "L"],
  crawl: ["K", "R", "AO1", "L"],
  haul: ["HH", "AO1", "L"],
  bawl: ["B", "AO1", "L"],
  spawn: ["S", "P", "AO1", "N"],
  dawn: ["D", "AO1", "N"],
  drawn: ["D", "R", "AO1", "N"],
  gone: ["G", "AO1", "N"],
  song: ["S", "AO1", "NG"],
  long: ["L", "AO1", "NG"],
  wrong: ["R", "AO1", "NG"],
  strong: ["S", "T", "R", "AO1", "NG"],
  belong: ["B", "IH0", "L", "AO1", "NG"],
  along: ["AH0", "L", "AO1", "NG"],
  dog: ["D", "AO1", "G"],
  log: ["L", "AO1", "G"],
  fog: ["F", "AO1", "G"],
  hog: ["HH", "AO1", "G"],
  bog: ["B", "AO1", "G"],
  cog: ["K", "AO1", "G"],
  frog: ["F", "R", "AO1", "G"],
  lost: ["L", "AO1", "S", "T"],
  cost: ["K", "AO1", "S", "T"],
  frost: ["F", "R", "AO1", "S", "T"],
  toss: ["T", "AO1", "S"],
  boss: ["B", "AO1", "S"],
  loss: ["L", "AO1", "S"],
  cross: ["K", "R", "AO1", "S"],
  moss: ["M", "AO1", "S"],
  floss: ["F", "L", "AO1", "S"],
  gloss: ["G", "L", "AO1", "S"],

  // ── IY / long-E family ────────────────────────────────────────────────────
  me: ["M", "IY1"],
  see: ["S", "IY1"],
  sea: ["S", "IY1"],
  be: ["B", "IY1"],
  free: ["F", "R", "IY1"],
  we: ["W", "IY1"],
  he: ["HH", "IY1"],
  she: ["SH", "IY1"],
  tree: ["T", "R", "IY1"],
  three: ["TH", "R", "IY1"],
  knee: ["N", "IY1"],
  flee: ["F", "L", "IY1"],
  spree: ["S", "P", "R", "IY1"],
  degree: ["D", "IH0", "G", "R", "IY1"],
  agree: ["AH0", "G", "R", "IY1"],
  key: ["K", "IY1"],
  tea: ["T", "IY1"],
  pea: ["P", "IY1"],
  plea: ["P", "L", "IY1"],
  flea: ["F", "L", "IY1"],
  real: ["R", "IY1", "L"],
  feel: ["F", "IY1", "L"],
  heal: ["HH", "IY1", "L"],
  deal: ["D", "IY1", "L"],
  steal: ["S", "T", "IY1", "L"],
  wheel: ["W", "IY1", "L"],
  peel: ["P", "IY1", "L"],
  kneel: ["N", "IY1", "L"],
  zeal: ["Z", "IY1", "L"],
  lean: ["L", "IY1", "N"],
  clean: ["K", "L", "IY1", "N"],
  mean: ["M", "IY1", "N"],
  scene: ["S", "IY1", "N"],
  green: ["G", "R", "IY1", "N"],
  screen: ["S", "K", "R", "IY1", "N"],
  dream: ["D", "R", "IY1", "M"],
  stream: ["S", "T", "R", "IY1", "M"],
  team: ["T", "IY1", "M"],
  beam: ["B", "IY1", "M"],
  cream: ["K", "R", "IY1", "M"],
  scheme: ["S", "K", "IY1", "M"],
  seem: ["S", "IY1", "M"],
  seam: ["S", "IY1", "M"],
  heat: ["HH", "IY1", "T"],
  beat: ["B", "IY1", "T"],
  meat: ["M", "IY1", "T"],
  meet: ["M", "IY1", "T"],
  street: ["S", "T", "R", "IY1", "T"],
  feet: ["F", "IY1", "T"],
  seat: ["S", "IY1", "T"],
  treat: ["T", "R", "IY1", "T"],
  sweet: ["S", "W", "IY1", "T"],
  complete: ["K", "AH0", "M", "P", "L", "IY1", "T"],
  defeat: ["D", "IH0", "F", "IY1", "T"],
  delete: ["D", "IH0", "L", "IY1", "T"],
  repeat: ["R", "IH0", "P", "IY1", "T"],
  speak: ["S", "P", "IY1", "K"],
  weak: ["W", "IY1", "K"],
  peak: ["P", "IY1", "K"],
  freak: ["F", "R", "IY1", "K"],
  geek: ["G", "IY1", "K"],
  seek: ["S", "IY1", "K"],
  week: ["W", "IY1", "K"],
  creek: ["K", "R", "IY1", "K"],
  cheek: ["CH", "IY1", "K"],
  sleek: ["S", "L", "IY1", "K"],
  deep: ["D", "IY1", "P"],
  keep: ["K", "IY1", "P"],
  sleep: ["S", "L", "IY1", "P"],
  creep: ["K", "R", "IY1", "P"],
  weep: ["W", "IY1", "P"],
  sweep: ["S", "W", "IY1", "P"],

  // ── EH / short-E vowel (bread/dead/red/said) ─────────────────────────────
  bread: ["B", "R", "EH1", "D"],
  dead: ["D", "EH1", "D"],
  said: ["S", "EH1", "D"],
  red: ["R", "EH1", "D"],
  head: ["HH", "EH1", "D"],
  bed: ["B", "EH1", "D"],
  fed: ["F", "EH1", "D"],
  led: ["L", "EH1", "D"],
  shed: ["SH", "EH1", "D"],
  spread: ["S", "P", "R", "EH1", "D"],
  thread: ["TH", "R", "EH1", "D"],
  instead: ["IH0", "N", "S", "T", "EH1", "D"],
  dread: ["D", "R", "EH1", "D"],
  tread: ["T", "R", "EH1", "D"],

  // ── EY / long-A family ────────────────────────────────────────────────────
  great: ["G", "R", "EY1", "T"],
  late: ["L", "EY1", "T"],
  eight: ["EY1", "T"],
  ate: ["EY1", "T"],
  wait: ["W", "EY1", "T"],
  gate: ["G", "EY1", "T"],
  fate: ["F", "EY1", "T"],
  hate: ["HH", "EY1", "T"],
  plate: ["P", "L", "EY1", "T"],
  state: ["S", "T", "EY1", "T"],
  rate: ["R", "EY1", "T"],
  skate: ["S", "K", "EY1", "T"],
  straight: ["S", "T", "R", "EY1", "T"],
  weight: ["W", "EY1", "T"],
  bait: ["B", "EY1", "T"],
  trait: ["T", "R", "EY1", "T"],
  made: ["M", "EY1", "D"],
  maid: ["M", "EY1", "D"],
  fade: ["F", "EY1", "D"],
  blade: ["B", "L", "EY1", "D"],
  grade: ["G", "R", "EY1", "D"],
  shade: ["SH", "EY1", "D"],
  trade: ["T", "R", "EY1", "D"],
  wade: ["W", "EY1", "D"],
  aid: ["EY1", "D"],
  paid: ["P", "EY1", "D"],
  laid: ["L", "EY1", "D"],
  name: ["N", "EY1", "M"],
  same: ["S", "EY1", "M"],
  flame: ["F", "L", "EY1", "M"],
  game: ["G", "EY1", "M"],
  frame: ["F", "R", "EY1", "M"],
  fame: ["F", "EY1", "M"],
  claim: ["K", "L", "EY1", "M"],
  place: ["P", "L", "EY1", "S"],
  space: ["S", "P", "EY1", "S"],
  race: ["R", "EY1", "S"],
  face: ["F", "EY1", "S"],
  chase: ["CH", "EY1", "S"],
  base: ["B", "EY1", "S"],
  case: ["K", "EY1", "S"],
  grace: ["G", "R", "EY1", "S"],
  trace: ["T", "R", "EY1", "S"],
  chain: ["CH", "EY1", "N"],
  brain: ["B", "R", "EY1", "N"],
  rain: ["R", "EY1", "N"],
  pain: ["P", "EY1", "N"],
  gain: ["G", "EY1", "N"],
  plain: ["P", "L", "EY1", "N"],
  train: ["T", "R", "EY1", "N"],
  strain: ["S", "T", "R", "EY1", "N"],
  main: ["M", "EY1", "N"],
  vain: ["V", "EY1", "N"],
  reign: ["R", "EY1", "N"],
  lane: ["L", "EY1", "N"],
  sane: ["S", "EY1", "N"],
  insane: ["IH0", "N", "S", "EY1", "N"],
  clay: ["K", "L", "EY1"],
  play: ["P", "L", "EY1"],
  say: ["S", "EY1"],
  stay: ["S", "T", "EY1"],
  way: ["W", "EY1"],
  day: ["D", "EY1"],
  pay: ["P", "EY1"],
  pray: ["P", "R", "EY1"],
  sway: ["S", "W", "EY1"],
  gray: ["G", "R", "EY1"],
  lay: ["L", "EY1"],
  ray: ["R", "EY1"],
  may: ["M", "EY1"],
  bay: ["B", "EY1"],
  they: ["DH", "EY1"],
  hey: ["HH", "EY1"],
  obey: ["OW0", "B", "EY1"],

  // ── EH-R / care family ────────────────────────────────────────────────────
  care: ["K", "EH1", "R"],
  bare: ["B", "EH1", "R"],
  bear: ["B", "EH1", "R"],
  there: ["DH", "EH1", "R"],
  their: ["DH", "EH1", "R"],
  "they're": ["DH", "EH1", "R"],
  air: ["EH1", "R"],
  hair: ["HH", "EH1", "R"],
  fair: ["F", "EH1", "R"],
  pair: ["P", "EH1", "R"],
  pear: ["P", "EH1", "R"],
  wear: ["W", "EH1", "R"],
  where: ["W", "EH1", "R"],
  dare: ["D", "EH1", "R"],
  share: ["SH", "EH1", "R"],
  spare: ["S", "P", "EH1", "R"],
  square: ["S", "K", "W", "EH1", "R"],
  rare: ["R", "EH1", "R"],
  scare: ["S", "K", "EH1", "R"],
  stare: ["S", "T", "EH1", "R"],
  prayer: ["P", "R", "EH1", "R"],
  swear: ["S", "W", "EH1", "R"],
  here: ["HH", "IH1", "R"],    // different vowel — IH not EH
  hear: ["HH", "IH1", "R"],
  near: ["N", "IH1", "R"],
  fear: ["F", "IH1", "R"],
  clear: ["K", "L", "IH1", "R"],
  year: ["Y", "IH1", "R"],
  ear: ["IH1", "R"],
  tear: ["T", "IH1", "R"],     // noun (tear in eye)
  dear: ["D", "IH1", "R"],
  cheer: ["CH", "IH1", "R"],
  appear: ["AH0", "P", "IH1", "R"],

  // ── AA-R / heart family ───────────────────────────────────────────────────
  heart: ["HH", "AA1", "R", "T"],
  start: ["S", "T", "AA1", "R", "T"],
  part: ["P", "AA1", "R", "T"],
  art: ["AA1", "R", "T"],
  cart: ["K", "AA1", "R", "T"],
  chart: ["CH", "AA1", "R", "T"],
  smart: ["S", "M", "AA1", "R", "T"],
  dark: ["D", "AA1", "R", "K"],
  park: ["P", "AA1", "R", "K"],
  mark: ["M", "AA1", "R", "K"],
  spark: ["S", "P", "AA1", "R", "K"],
  bar: ["B", "AA1", "R"],
  car: ["K", "AA1", "R"],
  far: ["F", "AA1", "R"],
  star: ["S", "T", "AA1", "R"],
  scar: ["S", "K", "AA1", "R"],
  jar: ["JH", "AA1", "R"],
  guard: ["G", "AA1", "R", "D"],
  hard: ["HH", "AA1", "R", "D"],
  yard: ["Y", "AA1", "R", "D"],
  shard: ["SH", "AA1", "R", "D"],
  farm: ["F", "AA1", "R", "M"],
  harm: ["HH", "AA1", "R", "M"],
  charm: ["CH", "AA1", "R", "M"],
  arm: ["AA1", "R", "M"],
  march: ["M", "AA1", "R", "CH"],
  arch: ["AA1", "R", "CH"],
  sharp: ["SH", "AA1", "R", "P"],
  harp: ["HH", "AA1", "R", "P"],

  // ── AO-R / born family ────────────────────────────────────────────────────
  born: ["B", "AO1", "R", "N"],
  worn: ["W", "AO1", "R", "N"],
  torn: ["T", "AO1", "R", "N"],
  horn: ["HH", "AO1", "R", "N"],
  corn: ["K", "AO1", "R", "N"],
  score: ["S", "K", "AO1", "R"],
  more: ["M", "AO1", "R"],
  core: ["K", "AO1", "R"],
  door: ["D", "AO1", "R"],
  floor: ["F", "L", "AO1", "R"],
  four: ["F", "AO1", "R"],
  for: ["F", "AO1", "R"],
  shore: ["SH", "AO1", "R"],
  store: ["S", "T", "AO1", "R"],
  war: ["W", "AO1", "R"],
  soar: ["S", "AO1", "R"],
  roar: ["R", "AO1", "R"],
  bore: ["B", "AO1", "R"],
  lore: ["L", "AO1", "R"],
  pore: ["P", "AO1", "R"],
  sword: ["S", "AO1", "R", "D"],
  lord: ["L", "AO1", "R", "D"],
  cord: ["K", "AO1", "R", "D"],
  word: ["W", "ER1", "D"],      // ER not AOR
  world: ["W", "ER1", "L", "D"],

  // ── ER / fur family ──────────────────────────────────────────────────────
  fur: ["F", "ER1"],
  her: ["HH", "ER1"],
  were: ["W", "ER1"],
  blur: ["B", "L", "ER1"],
  stir: ["S", "T", "ER1"],
  bird: ["B", "ER1", "D"],
  heard: ["HH", "ER1", "D"],
  burn: ["B", "ER1", "N"],
  turn: ["T", "ER1", "N"],
  learn: ["L", "ER1", "N"],
  earn: ["ER1", "N"],
  return: ["R", "IH0", "T", "ER1", "N"],
  hurt: ["HH", "ER1", "T"],
  shirt: ["SH", "ER1", "T"],
  skirt: ["S", "K", "ER1", "T"],
  dirt: ["D", "ER1", "T"],
  first: ["F", "ER1", "S", "T"],
  burst: ["B", "ER1", "S", "T"],
  thirst: ["TH", "ER1", "S", "T"],
  curse: ["K", "ER1", "S"],
  verse: ["V", "ER1", "S"],
  nurse: ["N", "ER1", "S"],

  // ── Homophones ────────────────────────────────────────────────────────────

  // ── Lyric slang / contracted spellings ───────────────────────────────────
  tho: ["DH", "OW1"],
  thru: ["TH", "R", "UW1"],
  nite: ["N", "AY1", "T"],
  luv: ["L", "AH1", "V"],
  cuz: ["K", "AH1", "Z"],
  bout: ["B", "AW1", "T"],
  ya: ["Y", "AH0"],
  "y'all": ["Y", "AO1", "L"],
  em: ["EH1", "M"],
  gonna: ["G", "AH1", "N", "AH0"],
  wanna: ["W", "AH1", "N", "AH0"],
  tryna: ["T", "R", "AY1", "N", "AH0"],
  finna: ["F", "IH1", "N", "AH0"],
  imma: ["IH1", "M", "AH0"],
  ima: ["IH1", "M", "AH0"],
  lemme: ["L", "EH1", "M", "IY0"],
  gimme: ["G", "IH1", "M", "IY0"],
  "ain't": ["EY1", "N", "T"],
  "coulda": ["K", "UH1", "D", "AH0"],
  "woulda": ["W", "UH1", "D", "AH0"],
  "shoulda": ["SH", "UH1", "D", "AH0"],
  "kinda": ["K", "AY1", "N", "D", "AH0"],
  "sorta": ["S", "AO1", "R", "T", "AH0"],
  cause: ["K", "AO1", "Z"],  // 'cause = because
  cus: ["K", "AH1", "Z"],

  // ── Dropped-g endings ─────────────────────────────────────────────────────
  runnin: ["R", "AH1", "N", "IH0", "N"],
  comin: ["K", "AH1", "M", "IH0", "N"],
  walkin: ["W", "AO1", "K", "IH0", "N"],
  talkin: ["T", "AO1", "K", "IH0", "N"],
  makin: ["M", "EY1", "K", "IH0", "N"],
  takin: ["T", "EY1", "K", "IH0", "N"],
  breakin: ["B", "R", "EY1", "K", "IH0", "N"],
  shakin: ["SH", "EY1", "K", "IH0", "N"],
  relaxin: ["R", "IH0", "L", "AE1", "K", "S", "IH0", "N"],
  relaxing: ["R", "IH0", "L", "AE1", "K", "S", "IH0", "NG"],
  lackin: ["L", "AE1", "K", "IH0", "N"],
  lacking: ["L", "AE1", "K", "IH0", "NG"],
  crackin: ["K", "R", "AE1", "K", "IH0", "N"],
  stackin: ["S", "T", "AE1", "K", "IH0", "N"],
  packin: ["P", "AE1", "K", "IH0", "N"],
  trackin: ["T", "R", "AE1", "K", "IH0", "N"],
  attackin: ["AH0", "T", "AE1", "K", "IH0", "N"],
  climbin: ["K", "L", "AY1", "M", "IH0", "N"],
  chillin: ["CH", "IH1", "L", "IH0", "N"],
  spillin: ["S", "P", "IH1", "L", "IH0", "N"],
  killin: ["K", "IH1", "L", "IH0", "N"],
  fillin: ["F", "IH1", "L", "IH0", "N"],
  willin: ["W", "IH1", "L", "IH0", "N"],
  feelin: ["F", "IY1", "L", "IH0", "N"],
  dealin: ["D", "IY1", "L", "IH0", "N"],
  healin: ["HH", "IY1", "L", "IH0", "N"],
  stealin: ["S", "T", "IY1", "L", "IH0", "N"],
  revealin: ["R", "IH0", "V", "IY1", "L", "IH0", "N"],
  windin: ["W", "AY1", "N", "D", "IH0", "N"],
  findin: ["F", "AY1", "N", "D", "IH0", "N"],
  grindin: ["G", "R", "AY1", "N", "D", "IH0", "N"],
  ridin: ["R", "AY1", "D", "IH0", "N"],
  hidin: ["HH", "AY1", "D", "IH0", "N"],
  slidin: ["S", "L", "AY1", "D", "IH0", "N"],
  flowin: ["F", "L", "OW1", "IH0", "N"],
  showin: ["SH", "OW1", "IH0", "N"],
  growin: ["G", "R", "OW1", "IH0", "N"],
  knowin: ["N", "OW1", "IH0", "N"],

  // ── Multi-syllabic test entries ───────────────────────────────────────────
  testing: ["T", "EH1", "S", "T", "IH0", "NG"],
  resting: ["R", "EH1", "S", "T", "IH0", "NG"],
  jesting: ["JH", "EH1", "S", "T", "IH0", "NG"],
  action: ["AE1", "K", "SH", "AH0", "N"],
  traction: ["T", "R", "AE1", "K", "SH", "AH0", "N"],
  fraction: ["F", "R", "AE1", "K", "SH", "AH0", "N"],
  reaction: ["R", "IY0", "AE1", "K", "SH", "AH0", "N"],
  attraction: ["AH0", "T", "R", "AE1", "K", "SH", "AH0", "N"],
  distraction: ["D", "IH0", "S", "T", "R", "AE1", "K", "SH", "AH0", "N"],
  motion: ["M", "OW1", "SH", "AH0", "N"],
  ocean: ["OW1", "SH", "AH0", "N"],
  notion: ["N", "OW1", "SH", "AH0", "N"],
  potion: ["P", "OW1", "SH", "AH0", "N"],
  devotion: ["D", "IH0", "V", "OW1", "SH", "AH0", "N"],
  emotion: ["IH0", "M", "OW1", "SH", "AH0", "N"],

  // ── Mixed overrides ──────────────────────────────────────────────────────
  hand: ["HH", "AE1", "N", "D"],
  land: ["L", "AE1", "N", "D"],
  band: ["B", "AE1", "N", "D"],
  stand: ["S", "T", "AE1", "N", "D"],
  sand: ["S", "AE1", "N", "D"],
  grand: ["G", "R", "AE1", "N", "D"],
  planned: ["P", "L", "AE1", "N", "D"],
  man: ["M", "AE1", "N"],
  can: ["K", "AE1", "N"],
  plan: ["P", "L", "AE1", "N"],
  ran: ["R", "AE1", "N"],
  van: ["V", "AE1", "N"],
  scan: ["S", "K", "AE1", "N"],
  span: ["S", "P", "AE1", "N"],
  clan: ["K", "L", "AE1", "N"],
  fan: ["F", "AE1", "N"],
  back: ["B", "AE1", "K"],
  black: ["B", "L", "AE1", "K"],
  track: ["T", "R", "AE1", "K"],
  crack: ["K", "R", "AE1", "K"],
  stack: ["S", "T", "AE1", "K"],
  pack: ["P", "AE1", "K"],
  lack: ["L", "AE1", "K"],
  fact: ["F", "AE1", "K", "T"],
  act: ["AE1", "K", "T"],
  rap: ["R", "AE1", "P"],
  snap: ["S", "N", "AE1", "P"],
  trap: ["T", "R", "AE1", "P"],
  map: ["M", "AE1", "P"],
  clap: ["K", "L", "AE1", "P"],
  slap: ["S", "L", "AE1", "P"],
  cap: ["K", "AE1", "P"],
  lap: ["L", "AE1", "P"],
  nap: ["N", "AE1", "P"],
  tap: ["T", "AE1", "P"],
  wrap: ["R", "AE1", "P"],
  zap: ["Z", "AE1", "P"],
  brick: ["B", "R", "IH1", "K"],
  block: ["B", "L", "AA1", "K"],
  clock: ["K", "L", "AA1", "K"],
  knock: ["N", "AA1", "K"],
  lock: ["L", "AA1", "K"],
  rock: ["R", "AA1", "K"],
  sock: ["S", "AA1", "K"],
  stock: ["S", "T", "AA1", "K"],
  shop: ["SH", "AA1", "P"],
  drop: ["D", "R", "AA1", "P"],
  top: ["T", "AA1", "P"],
  stop: ["S", "T", "AA1", "P"],
  pop: ["P", "AA1", "P"],
  hop: ["HH", "AA1", "P"],
  prop: ["P", "R", "AA1", "P"],
  spot: ["S", "P", "AA1", "T"],
  hot: ["HH", "AA1", "T"],
  not: ["N", "AA1", "T"],
  got: ["G", "AA1", "T"],
  lot: ["L", "AA1", "T"],
  dot: ["D", "AA1", "T"],
  shot: ["SH", "AA1", "T"],
  knot: ["N", "AA1", "T"],
  body: ["B", "AA1", "D", "IY0"],
  party: ["P", "AA1", "R", "T", "IY0"],
};

// ---------------------------------------------------------------------------
// MULTI-PRONUNCIATION support
// Some words have context-dependent readings; list alternates here
// ---------------------------------------------------------------------------

const ALTERNATES: Record<string, string[][]> = {
  // "read" — present (IY) vs past (EH)
  read: [["R", "IY1", "D"], ["R", "EH1", "D"]],
  // "lead" — verb (IY) vs noun metal (EH)
  lead: [["L", "IY1", "D"], ["L", "EH1", "D"]],
  // "live" — verb (IH) vs adjective (AY)
  live: [["L", "IH1", "V"], ["L", "AY1", "V"]],
  // "tear" — verb (EH-R) vs noun eye (IH-R)
  tear: [["T", "EH1", "R"], ["T", "IH1", "R"]],
  // "wind" — noun (IH) vs verb (AY)
  wind: [["W", "IH1", "N", "D"], ["W", "AY1", "N", "D"]],
  // "bow" — weapon/front (OW) vs bend (AW)
  bow: [["B", "OW1"], ["B", "AW1"]],
  // "row" — line (OW) vs fight (AW)
  row: [["R", "OW1"], ["R", "AW1"]],
  // "close" — adjective near (OW-S) vs verb shut (OW-Z)
  close: [["K", "L", "OW1", "S"], ["K", "L", "OW1", "Z"]],
  // "does" — verb (AH) vs (UW for "doe's" rarely)
  does: [["D", "AH1", "Z"]],
  // "dove" — bird (AH = rhymes w/love) vs past of dive (OW)
  dove: [["D", "AH1", "V"], ["D", "OW1", "V"]],
  // "use" — noun (S) vs verb (Z)
  use: [["Y", "UW1", "S"], ["Y", "UW1", "Z"]],
  // "bass" — fish (AE) vs music (EY)
  bass: [["B", "AE1", "S"], ["B", "EY1", "S"]],
  // "present" — noun/adj (EH) vs verb (EH, but stress shift)
  present: [["P", "R", "EH1", "Z", "AH0", "N", "T"], ["P", "R", "IH0", "Z", "EH1", "N", "T"]],
  // "object" — noun vs verb stress
  object: [["AA1", "B", "JH", "IH0", "K", "T"], ["AH0", "B", "JH", "EH1", "K", "T"]],
};

const phoneticCache = new Map<string, TokenPhonetics>();

export function normalizePhoneticWord(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/^[^a-z']+/, "")
    .replace(/[^a-z']+$/, "")
    .replace(/^'+|'+$/g, "");
}

function stripStress(phoneme: string): string {
  return phoneme.replace(/[0-2]/g, "");
}

function isVowelPhoneme(phoneme: string): boolean {
  return VOWELS.has(stripStress(phoneme));
}

function hasPrimaryStress(phoneme: string): boolean {
  return /1$/.test(phoneme);
}

function phonemeFamily(phoneme: string): string {
  const p = stripStress(phoneme);
  return CONSONANT_FAMILIES[p] ?? p;
}

function stressIndexFor(phonemes: string[]): number | undefined {
  for (let i = phonemes.length - 1; i >= 0; i--) {
    if (isVowelPhoneme(phonemes[i]) && hasPrimaryStress(phonemes[i])) return i;
  }
  for (let i = phonemes.length - 1; i >= 0; i--) {
    if (isVowelPhoneme(phonemes[i])) return i;
  }
  return undefined;
}

function keyFromTail(phonemes: string[], startIndex: number | undefined): string {
  if (startIndex === undefined) return phonemes.map(stripStress).join("-");
  return phonemes.slice(startIndex).map(stripStress).join("-");
}

function finalVowelIndex(phonemes: string[]): number {
  for (let i = phonemes.length - 1; i >= 0; i--) {
    if (isVowelPhoneme(phonemes[i])) return i;
  }
  return -1;
}

function eyeKeyFor(word: string): string {
  const compact = word.replace(/[^a-z]/g, "");
  if (compact.length <= 3) return compact;
  if (compact.endsWith("e") && compact.length >= 4) return compact.slice(-3);
  const suffix = compact.match(/[aeiouy][a-z]{1,4}$/)?.[0];
  return suffix ?? compact.slice(-4);
}

// ---------------------------------------------------------------------------
// Improved g2p — handles more English spelling patterns
// ---------------------------------------------------------------------------

function g2p(raw: string): string[] {
  let word = raw.replace(/[^a-z]/g, "");
  if (!word) return [];

  // Dropped-g: "runnin" → treat as "running"
  if (word.endsWith("in") && word.length >= 5 && !word.endsWith("ain") && !word.endsWith("oin")) {
    const stem = word.slice(0, -2);
    if (/[bcdfghjklmnpqrstvwxyz]$/.test(stem)) word = `${stem}ing`;
  }

  const silentFinalE = word.length > 3 && /[^aeiou]e$/.test(word) && !/[aeiou]{2}e$/.test(word);
  const scan = silentFinalE ? word.slice(0, -1) : word;
  const out: string[] = [];

  for (let i = 0; i < scan.length;) {
    const rest = scan.slice(i);
    const next = scan[i + 1] ?? "";
    const after = scan[i + 2] ?? "";

    // Multi-char digraphs — check longest first
    if (rest.startsWith("ough")) {
      // "ough" is extremely irregular — fallback handled by overrides
      // Generic fallback: treat as AW (caught / thought pattern)
      out.push("AO1"); i += 4; continue;
    }
    if (rest.startsWith("tion")) { out.push("SH", "AH0", "N"); i += 4; continue; }
    if (rest.startsWith("sion")) { out.push("ZH", "AH0", "N"); i += 4; continue; }
    if (rest.startsWith("eigh")) { out.push("EY1"); i += 4; continue; }
    if (rest.startsWith("igh")) { out.push("AY1"); i += 3; continue; }
    if (rest.startsWith("ing")) { out.push("IH0", "NG"); i += 3; continue; }
    if (rest.startsWith("tch")) { out.push("CH"); i += 3; continue; }
    if (rest.startsWith("ch")) { out.push("CH"); i += 2; continue; }
    if (rest.startsWith("sh")) { out.push("SH"); i += 2; continue; }
    if (rest.startsWith("th")) { out.push("TH"); i += 2; continue; }
    if (rest.startsWith("ph")) { out.push("F"); i += 2; continue; }
    if (rest.startsWith("wh")) { out.push("W"); i += 2; continue; }
    if (rest.startsWith("ck")) { out.push("K"); i += 2; continue; }
    if (rest.startsWith("ng")) { out.push("NG"); i += 2; continue; }
    if (rest.startsWith("qu")) { out.push("K", "W"); i += 2; continue; }
    if (rest.startsWith("ee") || rest.startsWith("ie")) { out.push("IY1"); i += 2; continue; }
    if (rest.startsWith("ea")) {
      // ea is usually IY (beat), but can be EH (bread) — IY is more common
      out.push("IY1"); i += 2; continue;
    }
    if (rest.startsWith("oo")) { out.push("UW1"); i += 2; continue; }
    if (rest.startsWith("ue") || rest.startsWith("ew")) { out.push("UW1"); i += 2; continue; }
    if (rest.startsWith("ai") || rest.startsWith("ay")) { out.push("EY1"); i += 2; continue; }
    if (rest.startsWith("oa") || rest.startsWith("oe")) { out.push("OW1"); i += 2; continue; }
    if (rest.startsWith("oi") || rest.startsWith("oy")) { out.push("OY1"); i += 2; continue; }
    // "ow" — ambiguous: OW (show) or AW (cow). "ow" at end of word → OW; mid-word → AW
    if (rest.startsWith("ow")) {
      const isWordEnd = i + 2 >= scan.length;
      out.push(isWordEnd ? "OW1" : "AW1"); i += 2; continue;
    }
    if (rest.startsWith("ou")) { out.push("AW1"); i += 2; continue; }
    if (rest.startsWith("au") || rest.startsWith("aw")) { out.push("AO1"); i += 2; continue; }

    // Silent-e lengthening: "bake" → B EY K
    if (silentFinalE && after === "" && next && /[bcdfghjklmnpqrstvwxyz]/.test(next)) {
      if (scan[i] === "a") { out.push("EY1"); i++; continue; }
      if (scan[i] === "i") { out.push("AY1"); i++; continue; }
      if (scan[i] === "o") { out.push("OW1"); i++; continue; }
      if (scan[i] === "u") { out.push("UW1"); i++; continue; }
      if (scan[i] === "e") { out.push("IY1"); i++; continue; }
    }

    const ch = scan[i];
    switch (ch) {
      case "a": out.push("AE1"); break;
      case "e": out.push("EH1"); break;
      case "i": out.push("IH1"); break;
      case "o": out.push(i === scan.length - 1 ? "OW1" : "AA1"); break;
      case "u": out.push("AH1"); break;
      case "y": out.push(i === scan.length - 1 ? "IY1" : i === 0 ? "Y" : "IH1"); break;
      case "c": out.push(/[eiy]/.test(next) ? "S" : "K"); break;
      case "g": out.push(/[eiy]/.test(next) ? "JH" : "G"); break;
      case "j": out.push("JH"); break;
      case "x": out.push("K", "S"); break;
      case "q": out.push("K"); break;
      default:
        if (/[bcdfhklmnprstvwz]/.test(ch)) out.push(ch.toUpperCase());
    }
    i++;
  }

  return out.filter((p, idx, arr) => !(idx > 0 && p === arr[idx - 1] && !isVowelPhoneme(p)));
}

// ---------------------------------------------------------------------------
// Build TokenPhonetics from a pronunciation
// ---------------------------------------------------------------------------

function buildPhonetics(normalized: string, pronunciation: Pronunciation): TokenPhonetics {
  const phonemes = pronunciation.phonemes;
  const stripped = phonemes.map(stripStress);
  const vIdx = finalVowelIndex(phonemes);
  const finalVowel = vIdx >= 0 ? stripStress(phonemes[vIdx]) : "";
  const finalConsonants = vIdx >= 0
    ? phonemes.slice(vIdx + 1).filter((p) => !isVowelPhoneme(p)).map(stripStress).join("-")
    : stripped.filter((p) => !VOWELS.has(p)).join("-");
  const firstVowel = phonemes.findIndex(isVowelPhoneme);
  const initialConsonants = stripped
    .slice(0, firstVowel < 0 ? stripped.length : firstVowel)
    .filter((p) => !VOWELS.has(p))
    .join("-");
  const vowels = phonemes.filter(isVowelPhoneme).map(stripStress);
  const consonants = phonemes.filter((p) => !isVowelPhoneme(p)).map(stripStress);
  const stressIndex = pronunciation.stressIndex ?? stressIndexFor(phonemes);
  const perfectKey = keyFromTail(phonemes, stressIndex);
  const endingKey = [finalVowel, finalConsonants].filter(Boolean).join("-");

  // Family consonants: map each final consonant to its family group
  const familyConsonants = finalConsonants
    .split("-")
    .filter(Boolean)
    .map((c) => phonemeFamily(c))
    .join("-");
  const familyKey = [finalVowel, familyConsonants].filter(Boolean).join("-");

  // Alliteration key: initial consonant (or cluster)
  const alliterationKey = initialConsonants
    ? initialConsonants.split("-").map((c) => phonemeFamily(c)).join("-")
    : "";

  // Consonance key: final consonants mapped to families
  const consonanceKey = familyConsonants || finalConsonants;

  // Assonance key: stressed vowel
  const stressedVowel = stressIndex !== undefined ? stripStress(phonemes[stressIndex]) : finalVowel;
  const assonanceKey = stressedVowel || finalVowel;

  const syllableCount = vowels.length || 1;
  const vowelSkeleton = vowels.join("-");
  const consonantSkeleton = consonants.join("-");
  const phonemeKey = stripped.join("-");

  return {
    normalized,
    pronunciations: [pronunciation],
    perfectKey,
    endingKey,
    assonanceKey,
    consonanceKey,
    alliterationKey,
    familyKey,
    eyeKey: eyeKeyFor(normalized),
    syllableCount,
    finalVowel,
    finalConsonants,
    initialConsonants,
    vowelSkeleton,
    consonantSkeleton,
    phonemeKey,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getTokenPhonetics(raw: string): TokenPhonetics {
  const normalized = normalizePhoneticWord(raw);
  const cached = phoneticCache.get(normalized);
  if (cached) return cached;

  // 1. Explicit override (single canonical pronunciation)
  const override = OVERRIDES[normalized];
  if (override) {
    const pronunciations: Pronunciation[] = [{ phonemes: override, source: "override" }];
    // Attach alternates if available
    const alts = ALTERNATES[normalized];
    if (alts) {
      for (const alt of alts.slice(1)) {
        pronunciations.push({ phonemes: alt, source: "override" });
      }
    }
    const result = buildPhonetics(normalized, pronunciations[0]);
    result.pronunciations = pronunciations;
    phoneticCache.set(normalized, result);
    return result;
  }

  // 2. Alternates lookup (first entry is primary)
  const alts = ALTERNATES[normalized];
  if (alts && alts.length > 0) {
    const pronunciations: Pronunciation[] = alts.map((p) => ({ phonemes: p, source: "override" as PronunciationSource }));
    const result = buildPhonetics(normalized, pronunciations[0]);
    result.pronunciations = pronunciations;
    phoneticCache.set(normalized, result);
    return result;
  }

  // 3. G2P fallback
  const g2pPhonemes = g2p(normalized);
  const pronunciation: Pronunciation = {
    phonemes: g2pPhonemes.length > 0 ? g2pPhonemes : ["AH1"],
    source: "g2p",
  };
  const result = buildPhonetics(normalized, pronunciation);
  phoneticCache.set(normalized, result);
  return result;
}

// ---------------------------------------------------------------------------
// Phrase phonetics (for multi-word spans)
// ---------------------------------------------------------------------------

export function getPhrasePhonetics(words: string[]): TokenPhonetics {
  if (words.length === 0) return getTokenPhonetics("");
  if (words.length === 1) return getTokenPhonetics(words[0]);

  const cacheKey = words.join(" ");
  const cached = phoneticCache.get(cacheKey);
  if (cached) return cached;

  // Build combined phoneme sequence from individual words
  const allPhonemes: string[] = [];
  for (const w of words) {
    const tp = getTokenPhonetics(w);
    allPhonemes.push(...tp.pronunciations[0].phonemes);
  }

  const pronunciation: Pronunciation = { phonemes: allPhonemes, source: "g2p" };
  const result = buildPhonetics(cacheKey, pronunciation);
  phoneticCache.set(cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// Utility exports
// ---------------------------------------------------------------------------

export function areHomophones(a: string, b: string): boolean {
  const pa = getTokenPhonetics(a);
  const pb = getTokenPhonetics(b);
  return pa.normalized !== pb.normalized && pa.phonemeKey === pb.phonemeKey;
}

/** Returns true if any pronunciation of word a and any of word b share the same perfectKey */
export function sharesPerfectKey(a: string, b: string): boolean {
  const pa = getTokenPhonetics(a);
  const pb = getTokenPhonetics(b);
  for (const pa_p of pa.pronunciations) {
    for (const pb_p of pb.pronunciations) {
      const kaRaw = buildPhonetics(pa.normalized, pa_p).perfectKey;
      const kbRaw = buildPhonetics(pb.normalized, pb_p).perfectKey;
      if (kaRaw && kbRaw && kaRaw === kbRaw) return true;
    }
  }
  return false;
}
