# Rhyme Lens — Test Plan

## Overview

Rhyme Lens is Verses' inline rhyme analysis engine. It detects end rhymes, internal rhymes, multisyllabic chains, slant rhymes, assonance, consonance, alliteration, repetition, cross-line echoes, and dense pockets.

This document provides synthetic test cases for QA.

---

## Test Case 1: Basic End Rhyme

```
this is testing
and now i'm resting
jesting
and now i'm resting
```

### Expected

- **testing / resting / jesting** → one end rhyme family (all share `-esting` ending)
- **"and now i'm resting"** repeated → separate repetition family
- The repeated line should have a distinct visual style (dashed outline vs. solid fill)
- Stop words ("and", "now", "i'm") should NOT be highlighted as the main rhyme

### False positives to avoid

- Do not create a single family containing all words
- Do not color the entire repeated line the same as the rhyme family
- Do not over-highlight "and" as part of any rhyme group

---

## Test Case 2: Compound / Chain Rhyme

```
paper sparks a chain reaction
late night brain relaxin
crooked little habit turns to action
half the room is lackin traction
```

### Expected

- **reaction / action / traction** → strong end rhyme family (share `-action` / `-akshun` ending)
- **relaxin** → normalized to "relaxing"; may connect via slant to the -action family or form its own group
- **chain reaction / brain relaxin** → potential multisyllabic link (compound rhyme)
- **lackin traction** → should connect to the end rhyme chain

### Density behavior

- Clean mode: shows reaction/action/traction as one strong family
- Detailed mode: adds the multi connection, possibly slant links
- Max mode: shows all secondary connections

---

## Test Case 3: Internal + Cross-Line

```
cold city, quick step, kick snare
thin air, big stare, slick glare
I bend the line till the light leaks
then climb through the rhyme in my white sneaks
```

### Expected

- **thin air / big stare / slick glare** → end rhyme family (share `-air`/`-are` sound)
- **quick / kick / slick** → alliteration or consonance (initial `k` or `ck` cluster)
- **light leaks / white sneaks** → slant/internal connection (shared vowel + similar ending)
- **line / climb / rhyme** → internal rhyme (shared `ai` vowel sound)
- **cold city** → possible alliteration (both start with `c`/`k` sound)

### False positives to avoid

- Do not create a giant assonance family eating the whole verse
- "I", "the", "in", "through" should not be highlighted

---

## Test Case 4: Multisyllabic + Mosaic

```
silver syllables sit in the center
little brittle rhythms hit in winter
I trace the bass with a patient hand
then place each phrase where the cadence lands
```

### Expected

- **center / winter** → end rhyme
- **silver syllables / little brittle** → alliteration + internal consonance
- **trace / bass / place / phrase** → internal rhyme chain (shared `-ace`/`-ase` sound)
- **patient hand / cadence lands** → multi-word end rhyme connection
- **sit / hit** → internal rhyme

---

## Test Case 5: Repetition vs. Rhyme

```
break the cycle
break the cycle
riding on a bicycle
a recital of survival
```

### Expected

- **"break the cycle"** repeated → repetition family (distinct visual from rhyme)
- **cycle / bicycle / recital / survival** → end/slant rhyme family (shared `-al`/`-le` vowel pattern)
- Repetition and rhyme should NOT look identical in the editor

---

## Test Case 6: Stop Word Filtering

```
the man in the van ran a plan
to be free and see the sea
```

### Expected

- **man / van / ran / plan** → end rhyme (strong family)
- **free / see / sea** → end rhyme (strong family)
- **"the"**, **"in"**, **"a"**, **"to"**, **"be"**, **"and"** → NOT highlighted as rhyme participants
- Both families should have DIFFERENT colors

---

## Density Mode Behavior

| Mode | Threshold | Types shown | Max families |
|------|-----------|-------------|--------------|
| Clean | High (0.65) | End, internal, multi, repetition, chain | 30 |
| Detailed | Medium (0.50) | All except dense | 60 |
| Max | Low (0.40) | Everything including assonance/consonance/dense | 120 |

---

## Manual QA Checklist

- [ ] Each family gets a visually distinct color
- [ ] Repetition uses dashed/outline style, not solid fill
- [ ] Highlights align exactly with text in the editor
- [ ] Scrolling stays synced between textarea and highlight layer
- [ ] Editor remains comfortable to type in with highlights active
- [ ] Sound Map panel shows correct family count
- [ ] Clicking a family in Sound Map isolates its highlights
- [ ] "Show all" returns to full highlighting
- [ ] Empty state shows "Write a few lines to reveal sound families."
- [ ] Capped state shows "Showing strongest matches."
- [ ] Density modes produce visibly different results
- [ ] Strong Only filter removes light-strength families
- [ ] Type filter toggles work correctly
- [ ] Performance is acceptable for ~50 lines of text

---

## Known Limitations

1. Phonetic analysis is approximation-based (no CMU dictionary lookup)
2. Compound/mosaic rhyme detection relies on last-word phonetics of spans
3. Words not in the normalization map may not be expanded correctly
4. Very long drafts (400+ words) are capped for performance
5. Some slang / non-standard spellings may not be recognized
6. Assonance in Clean mode is intentionally suppressed to reduce noise
