# Interface psychology: what the evidence says, and what it means for LocalEditor

Written for the 2026 identity refresh (design lead, 12 November 2026). Short on purpose. Each claim names its source. **Verified** means the citation and the claim were checked against the abstract or the publisher's record during writing (web search, November 2026). **From memory, unverified** means I could not open a source from the sandbox. Treat those as leads, not facts.

## Limits first

- The effects below are mostly **modest** in size, measured in labs, often with students, often in one country. Colour meanings in particular are learned and differ by culture and context (Cyr, Head & Larios 2010 found colour appeal and its link to trust varied across Canadian, German and Japanese viewers; verified at abstract level).
- No hue makes a product trustworthy. **Consistency, clarity and honest behaviour** do more for trust than any colour, and the research supports that more strongly than it supports any single colour choice.
- Several popular "colour psychology" claims (red raises heart rate, orange means cheap, and so on) rest on weak evidence. They are not used here.

## Colour and brand perception

- **Hue, saturation and value shape brand personality.** Labrecque & Milne (2012), *J. Academy of Marketing Science* 40(5), 711–727, "Exciting red and competent blue". Four studies: hue maps to personality dimensions, blue to competence; saturation and value modulate those traits; colour shifts likability and familiarity. **Verified (abstract).**
- **Brightness drives pleasure, saturation drives arousal.** Valdez & Mehrabian (1994), *J. Experimental Psychology: General* 123(4), 394–409. Brighter colours rated more pleasant; more saturated colours more arousing. Blue, blue-green and green among the most pleasant hues; yellow and green-yellow among the least. **Verified (abstract).** Implication: a calm brand blue at moderate chroma reads competent without shouting; reserve high chroma for very small areas.
- **Blue and trust online.** Cyr, Head & Larios (2010), *Int. J. Human-Computer Studies* 68, 1–21. Compared blue, grey and yellow site treatments for trust, satisfaction and e-loyalty across cultures; colour appeal predicted trust, effects varied by culture. Secondary reviews say blue scored best; **I could only verify the design and the general finding, not the blue-versus-yellow result.**

## Beauty, fluency and first impressions

- **Aesthetic–usability effect.** Kurosu & Kashimura (1995), CHI companion, "Apparent usability vs. inherent usability": ratings of beauty and of how easy a layout *looked* correlated (r ≈ .59), while apparent usability was not strongly tied to inherent usability. Tractinsky, Katz & Ikar (2000), *Interacting with Computers* 13(2), 127–145, "What is beautiful is usable": perceived beauty correlated with perceived usability before and after use. **Verified (abstract and reference lists).** Caveat: correlations; later work finds boundary conditions.
- **Processing fluency.** Reber, Schwarz & Winkielman (2004), *Personality and Social Psychology Review* 8(4), 364–382: things that are easy to perceive (symmetry, figural goodness, prototypicality, contrast) feel more pleasant and more true. **Verified.**
- **First impressions in about 50 ms.** Lindgaard, Fernandes, Dudek & Brown (2006), *Behaviour & IT* 25(2), 115–126: visual-appeal ratings after 50 ms agreed with ratings after longer viewing. **Verified.** Caveat: it measured appeal, not use or trust directly.
- **Complexity and prototypicality.** Tuch, Presslaber, Stöcklin, Opwis & Bargas-Avila (2012), *IJHCS* 70(11), 794–811: low visual complexity and high prototypicality (looks like what people expect of the category) were rated most appealing, already within 17–50 ms. **Verified.**
- **Curvature.** Bar & Neta (2006), *Psychological Science* 17(8), 645–648: people preferred curved over sharp-angled versions of the same objects and patterns. **Verified.** Caveat: the effect is on liking of isolated objects; it says nothing about "rounder is always better". Very round shapes read as toy-like.

## Decisions, targets and emphasis

- **Hick–Hyman law** (Hick 1952; Hyman 1953): choice time grows with the log of the number of equally likely options. **From memory, unverified** (classic, uncontroversial).
- **Choice overload is not a law.** Scheibehenne, Greifeneder & Todd (2010), *J. Consumer Research* 37(3), 409–425: meta-analysis of 50 experiments, mean effect near zero with large variance. **Verified.** Implication: do not hide features to "reduce choice"; organise them so the next step is obvious.
- **Fitts's law** (Fitts 1954): pointing time grows with distance and shrinks with target size. Platform guidance converges on about 44–48 px touch targets (Apple HIG 44 pt; Material 48 dp; WCAG 2.2 SC 2.5.8 sets a 24 px minimum). **From memory, unverified** for the exact guidance figures.
- **Isolation (von Restorff) effect** (von Restorff 1933): an item that differs from its neighbours is noticed and remembered. **From memory, unverified.** Implication: one filled, coloured primary action per view works *because* everything else is neutral.

## Feelings at the end

- **Peak–end.** Kahneman, Fredrickson, Schreiber & Redelmeier (1993), *Psychological Science* 4(6), 401–405: remembered experience is weighted by its peak and its end, with duration neglected. **Verified (paper excerpt).** Later work shows it does not hold for every kind of experience. Implication: make the *end* of a job (download, save, clean check) feel finished and good; do not decorate the middle.

## Trust and credibility

- **Stanford Web Credibility guidelines** (Fogg 2002, from studies with over 4,500 people): make claims easy to verify, show a real organisation, make the site easy to use and useful, look professional for the purpose, avoid errors of every size. **Verified** (project summary; the official page was not reachable, so exact wording is unverified).
- **Dark patterns cost trust.** Mathur et al. (2019), *Proc. ACM HCI* 3 (CSCW): 1,818 dark-pattern instances across 11K shopping sites. Luguri & Strahilevitz (2021), *J. Legal Analysis* 13(1), 43–109: mild dark patterns raise compliance with little backlash, aggressive ones provoke backlash. **Verified (abstracts).** We use none: no confirm-shaming, no pre-ticked boxes, no fake urgency, no hidden costs, symmetric Yes/No.

## Accessibility facts that constrain the palette

- **Colour-vision deficiency**: red–green CVD in about 8% of men and 0.5% of women of Northern European ancestry, lower elsewhere (NIH Genetics Home Reference; 2025 review in *Healthcare*). **Verified.** Never signal with hue alone; success vs danger must also differ in lightness, icon and text.
- **WCAG 2.2 contrast** (normative): 4.5:1 for body text, 3:1 for large text and for UI component boundaries and focus indicators (SC 1.4.3, 1.4.11). **From memory, unverified** in this session, but these are the published figures.
- **APCA** (Myndex): a perceptual contrast model still in draft (WCAG 3 Working Draft, March 2026, not a standard). The author recommends Lc 75 minimum for body text and Lc 60 for other content text. **Verified (author's docs).** We use it only as a second check.

## Design implications (checklist)

- [ ] Brand colour in the blue family, **moderate chroma**, used in small doses: primary action, selection, focus, "on". High chroma only on small areas.
- [ ] Editor chrome in **true neutrals** (zero chroma) so people judge their own colours fairly; canvas surround selectable light / mid / dark.
- [ ] **One** filled primary action per view; everything else neutral (isolation effect, Hick).
- [ ] Look like a category member (prototypicality): familiar header, tool rail, panels, standard icons and words. Low visual complexity at first sight.
- [ ] Fluency: one type family for UI, consistent spacing scale, consistent radii, aligned edges, high text contrast.
- [ ] Rounded but not toy-like: radii 8–20 px on controls and cards; pill only for buttons and chips.
- [ ] Targets ≥ 44 px on touch; important actions near the thumb on phones.
- [ ] Green means **private / on this device / safe** and nothing else; status never by hue alone (icon + word + lightness difference).
- [ ] Every text pair ≥ 4.5:1 (WCAG AA), focus rings and control edges ≥ 3:1, both themes; APCA as a sanity check.
- [ ] Delight at the **end** of jobs (export, save, clean privacy check), small, reduced-motion aware; nothing bounces for attention.
- [ ] Honest, plain copy; visible privacy signals; no dark patterns.
