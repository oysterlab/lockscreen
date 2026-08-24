# PET-R002 — Chibi Identity Prompt Loop

## Objective

Validate whether a fixed 15-image user-input set can be transformed into the approved Latte/Nila chibi product language while preserving the same individual cat and every cat-related accessory.

## Fixed execution contract

- 15 fixed inputs, identical order in all three rounds.
- Three rounds with round starts at least two hours apart.
- Built-in ImageGen only; no API/CLI generation.
- Generate the pet and required accessory as a removable chroma-key asset.
- Composite deterministically on the locked `1080x1920` background.
- Whole generated silhouette is capped at the golden-reference size guide.
- One conceptual prompt change per round.
- No assistant-declared product PASS. G2/G3/G4/G5 require owner/human review; owner veto overrides every score.

## Round hypothesis

1. **R1 — Role-labelled manifest baseline:** source cat is identity; Latte/Nila are style only; inject the per-cat identity and accessory manifest.
2. **R2 — Anti-leak identity firewall:** keep the manifest and explicitly prohibit identity transfer from the golden cats, with a source-first trait checklist.
3. **R3 — Chibi affect/material calibration:** keep the identity firewall and add the golden sculpt, plush material, cute-expression, and touchability constraints as one style/affect change.

## Golden references

- `samples/experiment_1/target_latte.png`
- `samples/experiment_1/target_nila.png`
- `samples/experiment_1/target_latte_9x16.png`
- `samples/experiment_1/target_nila_9x16.png`

The locked background is `samples/experiment_1/base_9x16.png`.

## Final gate

A sample is product PASS only when G0–G6 in `EVALUATION-V2.md` all pass. A round is product PASS only when all 15 samples pass. Automated geometry and pixel checks cannot substitute for the human identity/chibi/accessory/affect gates.
