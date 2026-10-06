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

## Command-line tool (Linux)

Use it for files with more than 100,000 individuals, or on an HPC cluster. It is a single file with nothing to install, and its results are identical to the website's.

Download it from the [Releases page](https://github.com/sufyansuleman/isat/releases/latest), or directly:

```bash
curl -L https://github.com/sufyansuleman/isat/releases/latest/download/isat-linux-x64.tar.gz | tar xz
./isat version    # on ARM machines use isat-linux-arm64.tar.gz
```

The release also has `isat.mjs` (0.16 MB), the same tool for machines with Node.js 20 or newer (`node isat.mjs ...`), and `sha256sums.txt` to verify the downloads.

```bash
./isat check cohort.csv                                   # columns, units, problems
./isat calculate cohort.csv -o results.csv                # all indices
./isat calculate cohort.csv -o res_${SLURM_ARRAY_TASK_ID}.csv --chunk ${SLURM_ARRAY_TASK_ID}/20   # in a SLURM array (--array=1-20)
./isat merge res_*.csv -o results.csv                     # join the chunks
./isat transform results.csv -o rint.csv --method rint --within-sex --input cohort.csv
```

Run `./isat <command> --help` for all options. Memory: the tool caps its heap at 1 GB; for very large files set a different cap with `DENO_V8_FLAGS=--max-old-space-size=4096 ./isat transform ...` (value in MB).

## Accuracy

Results are validated against the R package [InsuSensCalc](https://github.com/sufyansuleman/InsuSensCalc), an independent re-implementation in R, and base R for all transforms and statistics (see [validation/](validation/)). Deliberate differences from InsuSensCalc are listed in [validation/legacy-differences.md](validation/legacy-differences.md).

These are surrogate indices, not direct measurements of insulin sensitivity, and not a diagnosis.

## Populations the indices were derived in

Each index was developed in one population, mostly single cohorts in Europe or the USA with a few hundred people or fewer, and most papers do not report ancestry. Examples: Matsuda in 153 adults in San Antonio (USA), HOMA-IR in 23 adults, Gutt in 135 Black and White adults in Miami, TyG in 748 adults in Mexico, LAP in 9,180 US adults (NHANES III).

**Full table (population, N, place, original paper for every index): [docs/derivation-populations.md](docs/derivation-populations.md).**

Compare values within your own study rather than with thresholds from other populations, and account for ancestry in the analysis (for example genetic principal components), not by changing the index.

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
