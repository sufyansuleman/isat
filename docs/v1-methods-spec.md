# ISAT V1 method spec (authoritative for implementation)

Conventions:
- Inputs are in canonical units (glucose mmol/L, insulin pmol/L, TG/HDL/FFA mmol/L, weight kg, BMI kg/m², waist cm, age years, sex male/female).
- Each formula converts through `units.ts` into the units shown. `G_mg` = glucose in mg/dL; `I_uU` = insulin in µU/mL.
- `ln` = natural log.
- `direction` is the published direction. **No negation anywhere.**
- `legacy` is the InsuSensCalc 0.1.0 column, and `rel` is how that column relates to ISAT:
  - `=`: identical.
  - `−`: legacy = −ISAT.
  - `≠`: intentional difference, documented below.

## Fasting
| id | formula | direction | legacy | rel | source |
|---|---|---|---|---|---|
| homa_ir | G0 × I0_uU / 22.5 | resistant | Homa_IR_inv | − | Matthews 1985 |
| quicki | 1/(log10 I0_uU + log10 G0_mg) | sensitive | Quicki | ≠ (legacy uses ln) | Katz 2000 |
| firi | G0 × I0_uU / 25 | resistant | Firi | ≠ (legacy uses mg/dL) | Duncan 1995 |
| raynaud | 40 / I0_uU | sensitive | Raynaud | = | Raynaud 1999 |
| isi_basal | 10000 / (G0_mg × I0_uU) | sensitive | Isi_basal | = | |
| ig_ratio_basal | I0_uU / G0 | resistant | Ig_ratio_basal | − | |
| belfiore_basal | see belfiore.yaml | sensitive | Belfiore_basal | ≠ | Belfiore 1998 |

## OGTT

All OGTT means and AUCs are computed from explicitly required time points. Partial averaging is never allowed: a missing required point makes the method `unavailable`.

| id | formula | required t (min) | direction | legacy | rel |
|---|---|---|---|---|---|
| isi_120 | 10000 / (G120_mg × I120_uU) | 120 | sensitive | Isi_120 | = |
| ig_ratio_120 | I120_uU / G120 | 120 | resistant | Ig_ratio_120 | − |
| gutt | (75000 + (G0_mg − G120_mg)·0.19·BW) / (120 · mean(G0_mg,G120_mg) · ln(mean(I0_uU,I120_uU))) | 0,120 + weight | sensitive | Gutt_index | = |
| cederholm | (75000 + (G0 − G120)·1.15·180·0.19·BW) / (120 · mean(G0,G120) · ln(mean(I0_uU,I120_uU))), with **glucose in mmol/L** | 0,120 + weight | sensitive | Cederholm_index | ≠ |
| matsuda_3pt | 10000 / sqrt(G0_mg·I0_uU·mean(G0,G30,G120)_mg·mean(I0,I30,I120)_uU) | 0,30,120 | sensitive | Matsuda_ISI | = (when all 3 present) |
| matsuda_auc_3pt | 10000 / sqrt(G0_mg·I0_uU·Gm·Im), where Gm, Im = trapezoid AUC over 0/30/120 ÷ 120, i.e. (15v0+60v30+45v120)/120 | 0,30,120 | sensitive | Matsuda_Auc | = |
| matsuda_5pt | 10000 / sqrt(G0_mg·I0_uU·mean(G0..G120)_mg·mean(I0..I120)_uU) | 0,30,60,90,120 | sensitive | — | new (Matsuda & DeFronzo 1999 original) |
| stumvoll_mod | 0.156 − 0.0000459·I120 − 0.000321·I0 − 0.00541·G120 (I in pmol/L, G in mmol/L) | 0,120 | sensitive | Modified_stumvoll | = |
| stumvoll_dem | 0.222 − 0.00333·BMI − 0.0000779·I120 − 0.000422·age (I in pmol/L) | 120 + BMI, age | sensitive | Stumvoll_Demographics | = |
| bigtt_si | exp(4.90 − 0.00402·I0 − 0.000556·I30 − 0.00127·I120 − 0.152·G0 − 0.00871·G30 − 0.0373·G120 − 0.145·male − 0.0376·BMI), with I in pmol/L, G in mmol/L, male = 1/0 | 0,30,120 + sex, BMI | sensitive | BigttSi | = |
| avignon_si0 | 1e8 / (G0_mg·I0_uU·BW·150) | 0 + weight | sensitive | Avignon_Si0 | = |
| avignon_si120 | 1e8 / (G120_mg·I120_uU·BW·150) | 120 + weight | sensitive | Avignon_Si120 | = |
| belfiore_isi_gly | see belfiore.yaml | | sensitive | Belfiore_isi_gly | ≠ |

OGTT summaries are reported as summaries, not indices:
- Glucose and insulin AUC by trapezoid over **all supplied** time points, with the time points used stated.
- The mean glucose and mean insulin used by each method.

## Lipid / anthropometric
| id | formula | direction | legacy | rel |
|---|---|---|---|---|
| revised_quicki | 1/(log10 I0_uU + log10 G0_mg + log10 FFA) | sensitive | Revised_QUICKI | = |
| mcauley | exp(2.63 − 0.28·ln I0_uU − 0.31·ln TG) | sensitive | McAuley_index | = |
| tyg | ln(TG_mg · G0_mg / 2), with TG_mg = TG·88.57 | resistant | TyG_inv | − |
| tg_hdl | TG_mg / HDL_mg, with HDL_mg = HDL·38.67 | resistant | TG_HDL_C_inv | − |
| vai | male: (waist/(39.68+1.88·BMI))·(TG/1.03)·(1.31/HDL); female: (waist/(36.58+1.89·BMI))·(TG/0.81)·(1.52/HDL) | resistant | VAI_Men_inv / VAI_Women_inv | − (pick the column by sex) |
| lap | male: (waist−65)·TG; female: (waist−58)·TG | resistant | LAP_Men_inv / LAP_Women_inv | − (by sex) |
| adipo_ir | FFA · I0_uU | resistant | Adipo_inv | − |
| belfiore_isi_ffa | see belfiore.yaml | sensitive | Belfiore_inv_FFA | ≠ |

Note on VAI and LAP: ISAT computes the formula for the participant's own sex only. InsuSensCalc computes both formulas for every row.

## Verification status (emit as metadata; `provisional` adds a warning to every result)
- **confirmed:** quicki, homa_ir, matsuda_*, bigtt_si, vai, lap, mcauley, tyg, belfiore_* (formula).
- **supported_secondary:** hiri (form tabulated in Gastaldelli 2022, doi:10.1002/oby.23503; Abdul-Ghani 2007 originally used 0�30 min AUCs, differing by a constant factor only), avignon_sim (SiM = (0.137�Sib + Si2h)/2 per Avignon 1999 as reported in secondary sources; the abstract does not state the coefficient), firi (Duncan 1995 reproduced in secondary sources; primary not read).
- **legacy_match:** bennett, liri, lipo, atiri (formula reproduces InsuSensCalc; primary sources not read).
- **confirmed (added 2026-10-01):** ifc, Williamson et al. Nat Genet 2023;55:973-983 (PMC7614755), IFC = ln(I120/I0).
- **provisional:**
  - gutt, cederholm: log base not stated in any source read; ln matches InsuSensCalc.
  - cederholm: whether the means use time points 0/120 only or all OGTT samples is unconfirmed.
- **Belfiore default reference means** are transcribed from Belfiore 1998, user-supplied on 2026-10-01 and not yet checked against the PDF. Ship them as the default reference set `belfiore_1998`. The user can override it.
  - basal: insulin 65.71 pmol/L, glucose 5.08 mmol/L, FFA 398.88 µmol/L (0.39888 mmol/L).
  - 0–2 h area: insulin 363.04 pmol/L·h, glucose 10.26 mmol/L·h, FFA 478.00 µmol/L·h.
  - 0–1–2 h area: insulin 638.00 pmol/L·h, glucose 11.36 mmol/L·h, FFA 296.25 µmol/L·h.

## Deferred (registered as `unavailable` with reason "not included in this version: <why>")
- homa2: closed-source model.

## Orientation
`orient(results, mode)`: 'published' (default) changes nothing. 'sensitivity' negates every result whose direction is resistant and whose YAML legacy relation is `negated`, renames it `<id>_inv`, sets `orientation: 'sensitivity'` and `details.orientation_note` ("negated published index (InsuSensCalc convention): higher = more sensitive"). It reproduces the InsuSensCalc `_inv` columns.
