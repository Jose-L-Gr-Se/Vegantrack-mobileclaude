# PRODUCT.md — VeganTrack Product North Star

## 1. Product identity

**Product:** VeganTrack  
**Category:** Plant-based nutrition and food tracking  
**Primary market:** People following a vegan diet  
**Expansion market:** Vegetarian, flexitarian and people intentionally eating more plant-based  
**Platform today:** Android / React Native + Expo  
**Backend:** Shared Supabase backend with the existing web product

### Core positioning

> **VeganTrack helps people eating plant-based understand and sustain their nutrition — not just count calories.**

The product should feel like a **specialist nutrition companion for plant-based eating**, not like a generic calorie counter with a vegan toggle.

The user should be able to answer, quickly and confidently:

- What have I eaten today?
- Am I getting enough protein and energy for my goal?
- Am I covering the nutrients that deserve attention on a plant-based diet?
- What should I improve without having to become a nutrition expert?
- Are my food and supplements together giving me a realistic picture?

### Product promise

> **Eat plant-based with more confidence, less friction and better information.**

Do not promise prevention, diagnosis or treatment of nutritional deficiencies. VeganTrack is a consumer nutrition tool, not a medical device or a replacement for a registered dietitian / healthcare professional.

---

## 2. Why this niche

Generic trackers optimize primarily for calories, weight and broad macro tracking. Plant-based users have additional information needs around nutrients such as vitamin B12, iron, calcium, iodine, vitamin D, zinc, choline and omega-3, depending on the dietary pattern and individual context.

The 2025/2026 Academy of Nutrition and Dietetics position paper states that appropriately planned vegetarian and vegan dietary patterns can be nutritionally adequate, while specifically highlighting nutrients that merit attention, including B12, iodine, iron, choline, vitamin D and calcium. It also notes that individual assessment is important before making supplement recommendations.

This creates a useful product opportunity:

**The problem is not “vegans cannot eat healthily.”  
The problem is “it is harder to know whether the diet is well planned without thinking about the right things.”**

VeganTrack should reduce that cognitive burden.

---

## 3. Beachhead user

### Primary persona

A health-conscious adult who is vegan or very predominantly plant-based and wants to:

- eat well rather than merely avoid animal products
- understand protein and micronutrients
- monitor food intake
- keep an eye on supplements
- improve body composition or performance
- build sustainable habits
- avoid constantly researching nutrition

The user does not necessarily want clinical-grade complexity.

They want **clarity and confidence**.

### Secondary personas

1. People transitioning toward veganism.
2. Vegetarians and flexitarians who want plant-based nutrition guidance.
3. Plant-based athletes who care about protein, energy and recovery.
4. Users motivated by environmental/ethical reasons who also care about health.
5. Nutrition-curious users who find general trackers too generic or overwhelming.

Do not dilute the core product by trying to serve every diet equally.

---

## 4. Competitive landscape

### Cronometer

The strongest benchmark for serious micronutrient tracking. It supports vegan diets and exposes a very large nutrient set.

**What we should learn:** depth, trust, nutrient visibility and data quality.

**Where VeganTrack should differ:** simpler UX, stronger plant-based context, better prioritization of what matters instead of exposing everything equally, and a more approachable daily experience.

### MyFitnessPal

Very strong brand awareness, food database and mainstream food logging.

**What we should learn:** frictionless logging, database breadth and habit loops.

**Where VeganTrack should differ:** plant-based-first product logic rather than a general tracker with dietary settings.

### New plant-based-focused apps

The category is becoming more crowded. Current examples include Plantevo, VegUp, Tofu, Broccy and Replete, with several combining plant-based nutrition tracking, nutrient scoring and/or AI meal analysis.

**Implication:** “made for vegans” alone is no longer enough to differentiate.

The defensible direction should be the combination of:

**plant-based nutrition expertise + trusted data + very low-friction tracking + actionable interpretation + strong product quality.**

---

## 5. Strategic positioning

### We should NOT position VeganTrack as:

- another calorie counter
- a generic meal planner
- an app that scares people about deficiencies
- an AI gimmick
- a vegan barcode scanner only
- a moral judgement system
- a clinical diagnostic tool

### We SHOULD position VeganTrack as:

> **The nutrition companion built around plant-based eating.**

The product should make plant-based nutrition feel:

**simple → understandable → actionable → sustainable**

---

## 6. Product pillars

### Pillar A — Log without friction

Food logging must be faster than opening a spreadsheet.

Preferred interaction order:

1. Recent / frequent foods
2. Barcode scanner
3. Search
4. Saved meals / recipes
5. Custom foods
6. AI-assisted input where reliable

The user should never have to fight the UI to record a meal.

### Pillar B — Show what matters

Do not overwhelm users with dozens of numbers.

The interface should prioritize:

- energy / calories when relevant to the user's goal
- protein
- fiber
- key plant-based micronutrients
- supplement contribution
- meaningful trends

Advanced details should be available progressively.

### Pillar C — Turn numbers into understanding

Raw percentages are not enough.

The product should progressively evolve toward language such as:

- “Your protein target is on track.”
- “Calcium is consistently low this week.”
- “Your diet is covering most of today's priority nutrients.”
- “Your supplement contributes most of today's B12 total.”

Avoid alarmist language such as “DEFICIENCY”, “DANGER” or medical conclusions based solely on logged food.

### Pillar D — Build sustainable habits

Use:

- streaks
- lightweight goals
- weekly trends
- positive reinforcement
- completion moments
- reminders that users control

Avoid guilt, shame and obsessive perfection.

### Pillar E — Earn trust

Trust is a product feature.

Users should understand:

- where food data comes from
- when data is estimated
- what the score means
- what is based on food vs supplements
- when AI is uncertain
- when a result should not be interpreted medically

---

## 7. VeganTrack's strongest existing assets

Do not throw these away casually.

The current application already has:

- offline-first diary
- SQLite local mirror
- pending sync queue
- Supabase integration
- secure session persistence
- OpenFoodFacts integration
- barcode scanning
- recipes
- custom foods
- supplement tracking
- weight tracking
- VeganScore
- micronutrient calculations
- local notifications
- deep linking
- dark mode
- tests and CI

These are valuable foundations for a serious product.

The engineering goal is to make them **more reliable, coherent and polished**, not to replace them merely for architectural fashion.

---

## 8. The product loop

The core daily loop should become:

**Open → understand today → log → receive useful feedback → close the day → return tomorrow**

The product should minimize the time between opening the app and doing something useful.

The ideal first session:

**Install → onboarding → first useful insight → first food logged**

Avoid onboarding that feels like a questionnaire before the user gets value.

---

## 9. Home / diary north star

The main screen is the product's most important surface.

It should answer within seconds:

- Where am I today?
- How am I doing against my goal?
- What have I logged?
- What deserves attention?
- What is the fastest next action?

The main CTA should be obvious and contextual.

Potential future hierarchy:

**Today's status  
→ key nutrition signals  
→ meals  
→ quick add actions  
→ useful insight**

Do not fill the screen with dashboards just because data exists.

---

## 10. Scores

VeganScore is a useful product asset because it provides a simple mental model.

However:

- It must be understandable.
- It must not pretend to be a medical score.
- It must not punish users for eating imperfectly.
- It should explain the main drivers.
- It should reward consistency and nutritional adequacy, not obsessive tracking.
- The algorithm must remain deterministic and testable.

Future evolution may include specialized sub-scores, but avoid score proliferation.

---

## 11. Nutrition philosophy

VeganTrack should follow an evidence-led approach.

Principles:

- Plant-based diets can be nutritionally adequate when appropriately planned.
- Do not frame vegan eating as inherently deficient.
- Do not frame vegan eating as automatically optimal.
- Highlight nutrients that deserve attention without creating fear.
- Distinguish dietary intake from supplementation.
- Prefer food-first guidance where appropriate.
- Do not prescribe supplementation doses to individuals without appropriate context.
- Clearly label estimates and uncertainty.
- Encourage professional advice for medical concerns, pregnancy, eating disorders, diagnosed deficiencies or other higher-risk contexts.

The app should be **supportive, not paternalistic**.

---

## 12. UX/UI principles

The visual identity should communicate:

**fresh + trustworthy + calm + modern + plant-based**

Avoid:

- excessive “green everything”
- cartoonish vegan clichés
- generic AI gradients
- visual noise
- fake complexity
- excessive cards and borders
- overly gamified health interfaces

Prefer:

- strong hierarchy
- generous spacing
- restrained color palette
- excellent typography
- clear iconography
- subtle motion
- predictable interactions
- native-feeling Android behavior
- carefully designed empty/loading/error states

Professionalism comes from consistency more than decoration.

---

## 13. Accessibility

Accessibility is part of product quality.

Target:

- readable text
- adequate contrast
- touch targets large enough for comfortable use
- semantic labels where supported
- no information communicated only by color
- dynamic content that remains understandable
- dark mode that is intentionally designed, not mechanically inverted

---

## 14. Monetization strategy

The business model should be:

**free core utility → proven value → premium depth**

The free product must genuinely solve the main daily problem.

Potential premium areas:

- longer history
- advanced trends
- deeper analytics
- expanded recipes
- advanced AI capabilities
- richer personalization
- advanced exports
- future integrations
- more sophisticated coaching / insight layers

Do not put essential trust-building information behind a paywall simply to force conversion.

Avoid dark patterns.

The existing monetization documentation in `docs/GUIA-MONETIZACION.md` is part of the product context and should be respected when making payment-related changes.

---

## 15. North-star metrics

The first objective is not revenue.

The sequence is:

**Activation → retention → trust → habit → conversion → revenue**

Track and reason about:

### Activation
- onboarding completion
- first meal logged
- first full day logged
- first useful insight viewed

### Engagement
- meals logged per active day
- active days per week
- scanner usage
- repeat foods / meals
- supplement tracking usage
- weekly review usage

### Retention
- D1
- D7
- D30
- weekly active users
- return rate after first logged day

### Product quality
- crash-free sessions
- sync failures
- failed requests
- offline queue failures
- average time to useful interaction

### Monetization
- paywall views
- trial starts
- conversion
- churn
- annual vs monthly mix
- revenue per active user

Metrics should be introduced deliberately and with privacy in mind.

---

## 16. Product roadmap philosophy

Prioritize in this order:

### P0 — Trust / safety / data integrity
Crashes, lost data, broken authentication, corrupt synchronization, broken payments.

### P1 — Core daily experience
Onboarding, diary, logging, scanner, nutrient summary, errors and loading.

### P2 — Differentiation
Plant-based insights, trends, personalization, smarter recommendations, AI where useful.

### P3 — Growth / delight
Advanced social features, experiments, secondary features and polish.

Never use new features to hide unresolved P0/P1 quality problems.

---

## 17. 12–24 month vision

VeganTrack should become:

> **The trusted everyday nutrition companion for people eating plant-based.**

A mature product could combine:

- fast food logging
- plant-based food discovery
- nutrient adequacy tracking
- supplement awareness
- personalized insights
- trend analysis
- recipes and meal planning
- intelligent assistance
- integrations
- credible educational content
- a sustainable premium subscription

The long-term moat is not one feature.

It is the **combination of data + plant-based domain expertise + accumulated user history + trustworthy interpretation + daily habit**.

---

## 18. Research references

Use current evidence and verify claims before turning them into product copy.

- Academy of Nutrition and Dietetics, 2025/2026 position paper on vegetarian dietary patterns:
  https://pubmed.ncbi.nlm.nih.gov/39923894/
- NIH Office of Dietary Supplements, Vitamin B12:
  https://ods.od.nih.gov/factsheets/Vitaminb12-HealthProfessional/
- Current VeganTrack product positioning:
  https://www.vegantrack.app/
- Cronometer plant-based / vegan functionality:
  https://cronometer.com/features/custom-diet-tracking.html
- Spanish veggie population research / ProVeg:
  https://proveg.org/es/ii-edicion-de-la-mayor-encuesta-a-la-poblacion-veggie-en-espana/

Research date: September 2026.

This document describes product direction, not medical advice.
