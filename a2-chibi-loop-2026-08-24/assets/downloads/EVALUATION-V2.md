# Evaluation V2 — Chibi Identity Hard Gates

This experiment inherits the complete V2 rubric from `../PET-R001_prompt_loop_2026-08-24/EVALUATION-V2.md`.

## Machine-verifiable gates

- Exact canvas: `1080x1920`.
- Exactly one generated pet silhouette.
- Background pixels outside the subject/accessory/shadow mask: exact match to the locked base.
- Whole generated silhouette: width `<= 0.40W`, height `<= 0.20H`.
- Center X: `0.55–0.63W`; top Y: `0.66–0.70H`; baseline: `0.82–0.87H`.

## Human/owner gates

- Same chibi family as the four golden references, never photoreal or semi-real.
- Obviously the exact input individual, not a generic same-breed cat and not Latte/Nila identity leakage.
- Every required accessory/object is present with matching type, color, pattern, placement, and relation; no invented accessory when manifest says NONE.
- Cute, touchable, premium plush affect and clean anatomy.
- Owner veto overrides all measurements and assistant judgments.

`PASS` is unavailable until all human/owner gates are reviewed. Before that, use `CANDIDATE — OWNER REVIEW REQUIRED` or `FAIL`.
