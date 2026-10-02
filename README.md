# ISAT — Insulin Sensitivity Analysis Tool

Calculate surrogate indices of insulin sensitivity and resistance from fasting, OGTT, lipid and body measurements, for a whole research file or one person.

**Use it online: <https://sufyansuleman.github.io/isat/>**

No installation and no account. Everything runs in your browser; your data are never uploaded.

## What it does

- **33 published indices**: HOMA-IR, QUICKI, Matsuda, Stumvoll, Gutt, BIGTT-SI, TyG, VAI, Adipo-IR and more.
- **Upload a file** (CSV/TSV, up to 100,000 people): results for everyone, with warnings when values do not fit the chosen units.
- **Explore the results**: summary per index, distributions (density or histogram, split by sex), Spearman correlation heatmap, scatter plots.
- **Transform** for analysis: log, z-score or rank-based inverse normal (RINT), optionally within sex.
- **Download** results as CSV, a settings file for reproducibility, and every plot as SVG.
- **Transparent methods**: each index shows its formula, reference, the population it was derived in, and how the formula was verified.

Start from the [example file](apps/web/public/isat-template.csv) to see the expected columns.

For more than 100,000 individuals, a command-line tool for Linux is in preparation.

## Accuracy

Results are validated against the R package [InsuSensCalc](https://github.com/sufyansuleman/InsuSensCalc), an independent re-implementation in R, and base R for all transforms and statistics (see [validation/](validation/)). Deliberate differences from InsuSensCalc are listed in [validation/legacy-differences.md](validation/legacy-differences.md).

These are surrogate indices, not direct measurements of insulin sensitivity, and not a diagnosis.

## How to cite

Suleman S, Madsen AL, Ängquist LH, Schubert M, Linneberg A, Loos RJF, Hansen T, Grarup N. Genetic Underpinnings of Fasting and Oral Glucose-stimulated Based Insulin Sensitivity Indices. *J Clin Endocrinol Metab.* 2024;109(11):2754–2763. [doi:10.1210/clinem/dgae275](https://doi.org/10.1210/clinem/dgae275)

Please also cite the original paper of each index you report, and state the ISAT version (shown on every page and in every results file).

## Development

```bash
npm install
npm run dev:web     # local development server
npm test            # all tests
npm run build:web   # production build
```

The calculation engine is in `packages/core`, with one YAML file per method in `packages/core/methods`; the web app is in `apps/web`.

## Feedback

Questions, errors or suggestions: please open an [issue](https://github.com/sufyansuleman/isat/issues).

## Licence

MIT © Sufyan Suleman
