# How letterforms shape perception: a research note for the LocalEditor originals

Written for the product team (wave 2F, item F2). It summarises what published research says about how the
shape of letters affects what people feel and do, states the limits plainly, and ends with the design brief
that the twenty LocalEditor originals were generated from (`tools/typefoundry/families.py`).

**How to read the citations.** Each source was checked in November 2026 against a publisher, PubMed or
library record, and the bibliographic details below come from those records. Where only the abstract or a
reliable summary could be read, the claim is limited to what the abstract says. Anything marked
*(from memory, unverified)* could not be checked in this session and should not be quoted as fact.

## The short version

1. **Typefaces carry meaning on their own.** Readers consistently attribute personality to typefaces, and
   those impressions are fairly stable across people (Brumberger 2003; Shaikh, Chaparro & Fox 2006;
   Henderson, Giese & Cote 2004).
2. **Fit with the message matters more than any single shape rule.** A font that matches the product or
   message is chosen more often and remembered better. A mismatch costs more than a "wrong" individual
   feature (Doyle & Bottomley 2004, 2006; Childers & Jass 2002).
3. **Easy to read means easier, truer and more likeable,** on average and by a small amount. Hard-to-read
   type makes tasks look harder and statements look less true (Song & Schwarz 2008; Reber & Schwarz 1999;
   Alter & Oppenheimer 2009).
4. **Curves are liked, sharp angles signal threat.** People prefer curved objects to sharp-angled versions
   (Bar & Neta 2006). Round typefaces are matched with "sweet" and liked more; angular ones with bitter,
   sour and salty (Velasco et al. 2015).
5. **Weight reads as strength and loudness.** Heavy, angular type is read as more masculine and potent;
   lighter, rounder type as more feminine and gentle (Lieven et al. 2015; Henderson et al. 2004's "weight"
   factor).
6. **Natural, organic, handwritten type reads as human.** Handwritten typefaces raise the sense that a
   person made the product and can increase liking and purchase, but the effect reverses for functional
   products (Schroll, Schnurr & Grewal 2018). "Naturalness" is a key driver of brand personality for new
   brands (Grohmann, Giese & Parkman 2013).
7. **Disfluency is a tool, not a free lunch.** Hard-to-read type can slow people down and has been reported
   to help memory, but replications are mixed and trust and ease suffer (Diemand-Yauman et al. 2011; null
   replications by Rummer et al. 2015).
8. **Effects are modest and depend on context.** Most studies use Latin script, Western student or online
   samples, and short exposures. Culture, language, colour, layout and content all change the result.

## 1. Typeface personality and the models used to describe it

**Typefaces have a persona.** Brumberger (2003, *Technical Communication* 50) asked readers to rate
typefaces and text passages on personality scales and found strong support for the idea that readers
ascribe consistent personality attributes to both. Her companion paper on appropriateness (same volume,
issue 2, pp. 224–231) and a 2004 follow-up on reading time, comprehension and ethos (*Technical
Communication* 51) found that readers notice when type and text do not fit, although comprehension itself
was largely unaffected.

**Onscreen fonts.** Shaikh, Chaparro & Fox (2006, *Usability News* 8) had 561 people rate 20 onscreen fonts
on 15 adjective pairs (e.g. stable–unstable, conformist–rebel, sad–happy). Perceived personality followed
the design family (serif, sans serif, modern, monospace, script/funny), and those perceptions matched the
uses people thought appropriate. Serif fonts scored highest on stable, practical, mature and formal.

**Semantic differential: evaluation, potency, activity.** The classic Osgood dimensions describe how
"good", how "strong" and how "lively" something feels. Doyle & Bottomley (2006, *Journal of Consumer
Psychology* 16(2), 112–123) used them to measure both fonts and product categories: judged appropriateness
depended on matching potency and activity, and also on the font's own connotations regardless of the
product. For our purposes: weight and angularity mostly move potency; slant, irregularity and contrast
rhythm mostly move activity; fluency and familiarity mostly move evaluation.

**Marketing style factors: elaborate, harmony, natural, flourish, weight, compressed.** Henderson, Giese &
Cote (2004, *Journal of Marketing* 68(4), 60–72) had typefaces rated on design characteristics and
impressions and extracted six design dimensions: *elaborate*, *harmony*, *natural*, *flourish*, *weight*
and *compressed*. They mapped these to strategically useful impressions (for example pleasing, engaging,
reassuring, prominent) and gave guidelines for choosing typefaces to manage them. In broad terms
*(details from memory, unverified beyond the abstract)*: natural and harmonious designs were linked to
pleasing and reassuring impressions; elaborate and flourished designs to engaging ones; weight to
prominence; and compression tended to reduce how pleasing a face felt.

**New brands.** Grohmann, Giese & Parkman (2013, *Journal of Brand Management* 20(5), 389–403; online
2012) ran three experiments and found font *naturalness* to be a key driver of the brand personality
consumers infer for a new brand name, with font colour having an independent effect.

**Anatomy.** Mackiewicz (2005, *Journal of Technical Writing and Communication* 35(3), 291–315) proposed
judging a typeface's personality from five letterforms (uppercase J and lowercase a, g, e, n), which carry
much of its anatomical information; she stresses that context of use also shapes the result. We use this
practically: those five letters were the ones we tuned hardest in each family.

## 2. Roundness and angularity

Bar & Neta (2006, *Psychological Science* 17(8), 645–648) showed people pairs of real objects and abstract
patterns that differed only in having curved or sharp-angled contours; the curved versions were liked
significantly more. The authors propose that sharp angles carry an implicit threat signal; a later fMRI
study by the same group reported more amygdala activity for sharp-cornered objects. Carbon (2010, *Acta
Psychologica* 134) found the preference is not universal and is modulated by other aesthetic factors.

For type specifically, Velasco, Woods, Hyndman & Spence (2015, *i-Perception* 6(4)) found people matched
rounder typefaces with "sweet" and more angular ones with "bitter", "salty" and "sour"; rounder typefaces
were also liked more and judged easier to read. A 2018 follow-up across English, Spanish and Chinese found
the round–sweet link in all three, but the angular–bitter/sour/salty links only in Spanish and English: a
reminder that these correspondences are partly cultural.

**Design use.** Round bowls, round stroke ends and softened corners for *positive feeling*; chamfers,
pointed apexes, wedge serifs and acute cuts for *tension*. Keep tension faces legible so that "sharp"
reads as intended energy rather than as noise.

## 3. Weight and boldness

Weight is the strongest single lever on salience: heavier strokes put more ink in the same area and are
seen first. In the marketing models, weight is its own factor (Henderson et al. 2004) and maps to
potency in the semantic-differential tradition (Doyle & Bottomley 2006). Lieven, Grohmann, Herrmann,
Landwehr & van Tilburg (2015, *European Journal of Marketing* 49(1/2), 146–169) tested logo shape, name,
font and colour and found brand design shifts perceived brand masculinity and femininity, which in turn
affect preference; later summaries describe heavy, angular type as reading more masculine and light,
round type as more feminine. Treat the gender coding as a description of a stereotype that the research
measured, not as a recommendation.

**Design use.** Heavy weights for *attention*; moderate, even weights for *trust*; very heavy plus
condensed for *urgency*.

## 4. Width and condensation

Henderson et al. (2004) found *compressed* to be a separate design dimension. Condensed type packs more
letters into a line and is a staple of headlines and sale posters; it raises density and, in our reading
of the impression mappings, reduces how pleasing and calm a face feels *(interpretation; the direction of
the compressed effect is from memory, unverified)*. Wide type takes more room and tends to feel stable and
relaxed. There is little controlled research on width alone, so treat these as design conventions
informed by the models rather than as measured effects.

**Design use.** Condensed and tightly spaced for *urgency* and *tension*; wide and generously spaced for
*calm* and *trust*; extended heavy for *attention* in very short words.

## 5. Stroke contrast and serifs

In Shaikh et al. (2006), serif faces were rated most stable, mature and formal. "Elaborate" and
"flourish" in Henderson et al. (2004) cover contrast, serifs and ornament; they make faces more engaging
and elegant but can cost naturalness. High contrast (thin hairlines, heavy stems) reads as elegant and
premium at display sizes and loses legibility at small sizes because hairlines thin out. Low-contrast,
sturdy serifs keep the "established" signal while staying robust.

**Design use.** Bracketed, moderate-contrast serifs for *trust*; extreme contrast with hairline serifs
for *elegant attention*; wedge or spur serifs with high contrast for *tension*; soft, rounded serifs for
*positive* warmth.

## 6. x-height, apertures and letter spacing

Legibility at small sizes depends mostly on the x-height (Legge & Bigelow 2011, *Journal of Vision*
11(5):8), which defines the fluent reading range. Open apertures (the gaps in c, e, s, a) make letters
easier to tell apart *(widely held design guidance; specific studies not verified here)*. Letter
spacing interacts with crowding: Zorzi et al. (2012, *PNAS*) found extra-large spacing improved reading
in children with dyslexia, while typical readers did not get faster. Generous spacing and open shapes
make a face feel airy and approachable; tight spacing and closed shapes feel dense and insistent.

**Design use.** Large x-height, open apertures and even spacing for *trust* and *positive*; closed
apertures, tight spacing and tall x-height for *urgency* (density) and *coldness*.

## 7. Slant and irregularity

Slant reads as movement and speed; irregular, handwritten forms read as human and informal. Schroll,
Schnurr & Grewal (2018, *Journal of Consumer Research* 45(3), 648–672) found handwritten typefaces raise
the sense of a human presence behind a product, strengthening attachment and evaluations, with field
studies showing more purchases; the effect weakens for brands people are already attached to and
reverses for functional products. Irregularity that looks unintended (shaky, broken) reads as unstable or
threatening rather than human; the direction depends on how controlled the irregularity looks.

**Design use.** A light forward slant and gentle wobble for *positive* (playful, human); a slight back
slant, reversed stress and a tremor for *tension* (unease).

## 8. Case

All-caps settings read as louder and more formal; in running text they are usually slower for normal
readers because word shapes are lost. Arditi & Cho (2007, *Vision Research* 47(19), 2499–2505) found the
opposite at threshold sizes: uppercase was more legible than lower or mixed case, especially for people
with low vision, because uppercase letters are physically larger at the same point size. So all-caps is
fine for short headlines and labels, poor for paragraphs.

## 9. Processing fluency

Fluency is how easy something is to process. Reber & Schwarz (1999, *Consciousness and Cognition* 8(3),
338–342) made statements harder or easier to read by changing contrast; easy-to-read statements were judged
true above chance, hard ones at chance (a small effect). Song & Schwarz (2008, *Psychological Science*
19(10), 986–988) printed exercise instructions or a recipe in an easy font (Arial) or a hard font (a brush
script); the hard font made the task seem harder and longer and reduced willingness to do it, without
changing recall. Alter & Oppenheimer (2009, *Personality and Social Psychology Review* 13, 219–235)
review fluency effects across perception, memory and judgement: fluent stimuli are generally judged more
true, more likeable, more familiar and lower in risk.

Disfluency has uses. Diemand-Yauman, Oppenheimer & Vaughan (2011, *Cognition* 118) reported better
retention for material in harder-to-read fonts, but Rummer, Schweppe & Schwede (2015, *Metacognition and
Learning*) report null effects across several experiments. Unusual, slightly harder type can also feel
more distinctive or premium *(widely cited idea; specific source not verified here)*. Our reading: use
disfluent display faces for short, deliberate moments (a title, a warning), never for terms, prices or
instructions.

## 10. Congruence with the message

Doyle & Bottomley (2004, *Journal of Business Research* 57(8), 873–880): across ten product categories,
brands were chosen about twice as often in an appropriate font as in an inappropriate one; in a small field
study shoppers chose the appropriately-labelled chocolates about 75% of the time. Childers & Jass (2002,
*Journal of Consumer Psychology* 12(2), 93–106) found that typefaces communicate their own semantic
associations, and that memory for an ad rose with consistency between typeface associations, the ad's
visuals and its copy. Juni & Gross (2008, *Perceptual and Motor Skills* 106(1), 35–42) found that the same
satirical article was rated differently on emotional and persuasive descriptors when set in Arial versus
Times New Roman *(design from a secondary summary; direction of effects not verified)*.

**Design use.** Every family in the set has a plain description and suggested uses so people can pick for
fit, not for a single shape rule. The picker filters by feel, which is a fit signal.

## Limits

- **Effect sizes are modest.** Many effects are small (Reber & Schwarz's truth effect was about d = 0.13
  in one later review) and some, such as the disfluency memory benefit, do not reliably replicate.
- **Context dominates.** Colour, imagery, words, layout and the reader's goal all change perception. A
  typeface cannot rescue a message that does not fit.
- **Samples are narrow.** Most studies use Latin script, English or a few European languages, and Western
  student or online panels. Round–sweet matched across English, Spanish and Chinese; angular–sour did not.
- **Stimuli are not controlled typefaces.** Studies compare existing fonts that differ in many ways at
  once, so attributing an effect to one feature (roundness, weight) is an inference. Our generator varies
  one design variable at a time, which would make cleaner stimuli for future testing.
- **No font makes anyone buy.** The research supports "fit and fluency nudge impressions"; it does not
  support claims that a typeface drives sales on its own.

## Design brief: four intents, five concepts each

Parameter names refer to `tools/typefoundry/tf/style.py`. Units are per 1000 em. Stem weights are for the
Regular instance; Bold is roughly 1.35–1.5 times heavier.

| Intent | What the research supports | Parameter ranges | Five concepts (corners of the space) |
|---|---|---|---|
| **Attention** — salience, prominence, energy | Weight → prominence and potency; compression → density; elaborate/flourish → engagement; high contrast reads as premium display | stem 110–130; width 0.7–0.8 (condensed) or 1.3–1.4 (extended); contrast from 0.75 (low) to 0.15 (extreme); apertures closed to medium; tight spacing 0.86–0.95 | **Loudline** heavy condensed grotesque · **Wideshout** extended heavy sans with ink traps · **Spotlit** fat-face hairline-serif display · **Headbrick** heavy slab serif · **Flarepoint** geometric black with ink traps and pointed apexes |
| **Trust** — credibility, calm, ease | Fluency → truth and ease; harmony/natural → reassuring; serifs → stable, mature; large x-height and open apertures → legibility | stem 80–92; contrast 0.38–0.9; apertures open (0.6–0.9); x-height 500–535; spacing 1.0–1.1, some tracking; no jitter, no slant | **Anchorline** humanist sans · **Northwall** sturdy low-contrast bracketed serif · **Plainfield** calm wide grotesque · **Clearwell** clear rounded-terminal sans · **Hearthbook** classical high-x-height book face |
| **Positive feeling** — warmth, friendliness, joy | Curvature preference; round → sweet and liked; handwritten → human presence; natural → pleasing; light slant → movement | curve tension 0.55–0.6 (round); round stroke ends; ball terminals; corner rounding 6–11; jitter 0–0.75 (seeded); slant 0–9°; open apertures | **Sunbun** round geometric · **Doodlebee** handwritten monoline · **Butterleaf** soft rounded serif with ball terminals · **Puffpop** heavy wide bubble · **Breezeway** light slanted humanist |
| **Tension** — unease, urgency, aggression, coldness (the deliberate negative pole, for warnings, horror, protest, sale pressure and contrast) | Sharp angles → threat signal; angular → bitter/sour; disfluency → effort, distinctiveness, lower trust; compression and weight → pressure; irregularity that looks unintended → instability | chamfer 0.5 or pointed apexes; wedge serifs; contrast 0.24 or reversed (2.1+); squareness 0.84 with closed apertures; jitter 1.0 with backslant −5° and reversed stress; width 0.8–0.84 | **Shardcut** angular chamfered condensed · **Frostgrid** cold squared technical sans · **Quakeline** unstable tremor with backslant · **Spikemark** condensed wedge-serif, high contrast · **Wrongway** reverse-contrast condensed |

Each tension face must stay legible at headline sizes: the aim is a clear feeling of edge, cold or
instability, not unreadable text.

## Sources

Checked against publisher, PubMed or library records (November 2026):

- Alter, A. L., & Oppenheimer, D. M. (2009). Uniting the tribes of fluency to form a metacognitive nation. *Personality and Social Psychology Review*, 13, 219–235.
- Arditi, A., & Cho, J. (2007). Letter case and text legibility in normal and low vision. *Vision Research*, 47(19), 2499–2505. doi:10.1016/j.visres.2007.06.010
- Bar, M., & Neta, M. (2006). Humans prefer curved visual objects. *Psychological Science*, 17(8), 645–648.
- Brumberger, E. R. (2003). The rhetoric of typography: The persona of typeface and text. *Technical Communication*, 50. — and: The awareness and impact of typeface appropriateness, *Technical Communication*, 50(2), 224–231.
- Carbon, C.-C. (2010). The cycle of preference: Long-term dynamics of aesthetic appreciation. *Acta Psychologica*, 134, 233–244.
- Childers, T. L., & Jass, J. (2002). All dressed up with something to say: Effects of typeface semantic associations on brand perceptions and consumer memory. *Journal of Consumer Psychology*, 12(2), 93–106. doi:10.1207/153276602760078631
- Diemand-Yauman, C., Oppenheimer, D. M., & Vaughan, E. B. (2011). Fortune favors the bold (and the italicized): Effects of disfluency on educational outcomes. *Cognition*, 118.
- Doyle, J. R., & Bottomley, P. A. (2004). Font appropriateness and brand choice. *Journal of Business Research*, 57(8), 873–880. doi:10.1016/S0148-2963(02)00487-3
- Doyle, J. R., & Bottomley, P. A. (2006). Dressed for the occasion: Font-product congruity in the perception of logotype. *Journal of Consumer Psychology*, 16(2), 112–123. doi:10.1207/s15327663jcp1602_2
- Grohmann, B., Giese, J. L., & Parkman, I. D. (2013). Using type font characteristics to communicate brand personality of new brands. *Journal of Brand Management*, 20(5), 389–403. doi:10.1057/bm.2012.23
- Henderson, P. W., Giese, J. L., & Cote, J. A. (2004). Impression management using typeface design. *Journal of Marketing*, 68(4), 60–72. doi:10.1509/jmkg.68.4.60.42736
- Juni, S., & Gross, J. S. (2008). Emotional and persuasive perception of fonts. *Perceptual and Motor Skills*, 106(1), 35–42. doi:10.2466/pms.106.1.35-42
- Legge, G. E., & Bigelow, C. A. (2011). Does print size matter for reading? A review of findings from vision science and typography. *Journal of Vision*, 11(5):8.
- Lieven, T., Grohmann, B., Herrmann, A., Landwehr, J. R., & van Tilburg, M. (2015). The effect of brand design on brand gender perceptions and brand preference. *European Journal of Marketing*, 49(1/2), 146–169. doi:10.1108/EJM-08-2012-0456
- Mackiewicz, J. (2005). How to use five letterforms to gauge a typeface's personality: A research-driven method. *Journal of Technical Writing and Communication*, 35(3), 291–315. doi:10.2190/LQVL-EJ9Y-1LRX-7C95
- Reber, R., & Schwarz, N. (1999). Effects of perceptual fluency on judgments of truth. *Consciousness and Cognition*, 8(3), 338–342. doi:10.1006/ccog.1999.0386
- Rummer, R., Schweppe, J., & Schwede, A. (2015). Fortune is fickle: Null-effects of disfluency on learning outcomes. *Metacognition and Learning*. doi:10.1007/s11409-015-9151-5
- Schroll, R., Schnurr, B., & Grewal, D. (2018). Humanizing products with handwritten typefaces. *Journal of Consumer Research*, 45(3), 648–672.
- Shaikh, A. D., Chaparro, B. S., & Fox, D. (2006). Perception of fonts: Perceived personality traits and uses. *Usability News*, 8(1).
- Song, H., & Schwarz, N. (2008). If it's hard to read, it's hard to do: Processing fluency affects effort prediction and motivation. *Psychological Science*, 19(10), 986–988.
- Velasco, C., Woods, A. T., Hyndman, S., & Spence, C. (2015). The taste of typeface. *i-Perception*, 6(4).
- Zorzi, M., et al. (2012). Extra-large letter spacing improves reading in dyslexia. *PNAS*, 109(28).

Not verified in this session (cited from memory only where marked above): the exact direction of each of
Henderson et al.'s six factors on each impression; the details of Juni & Gross's results; the general claim
that unusual type feels more premium.
