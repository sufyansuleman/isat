#!/usr/bin/env Rscript
# Regenerate IsletCalc expected values by running the installed IsletCalc package on the validation inputs.
# Usage (repo root): Rscript validation/run_isletcalc.R
# Input : validation/fixtures/inputs_islet.csv (columns G0..I120, sex, bmi, Glucagon0/30/60/120)
# Output: validation/fixtures/isletcalc_<version>.json (raw IsletCalc columns, unrounded)
# IsletCalc coding: sex 1 = male, anything else = female; insulin pmol/L, glucose mmol/L, glucagon pmol/L.

suppressPackageStartupMessages(library(jsonlite))
if (!requireNamespace("IsletCalc", quietly = TRUE)) {
  lib <- Sys.getenv("R_LIBS_USER")
  if (nzchar(lib)) dir.create(lib, showWarnings = FALSE, recursive = TRUE)
  install.packages("IsletCalc", repos = "https://cloud.r-project.org", lib = if (nzchar(lib)) lib else NULL)
}
suppressPackageStartupMessages(library(IsletCalc))
version <- as.character(packageVersion("IsletCalc"))

inputs <- read.csv("validation/fixtures/inputs_islet.csv", stringsAsFactors = FALSE)
dat <- inputs[, c("participant_id", "G0", "G30", "G120", "I0", "I30", "I120", "sex", "bmi",
                  "Glucagon0", "Glucagon30", "Glucagon120")]
res <- suppressMessages(suppressWarnings(insulin_release(dat, category = c("fasting", "ogtt"))))
res <- suppressMessages(suppressWarnings(glucagon_release(res)))
res <- suppressMessages(suppressWarnings(glucagon_resistance(res)))

cols <- setdiff(names(res), names(dat))
out <- list(
  source = "IsletCalc",
  version = version,
  generated = format(Sys.time(), "%Y-%m-%dT%H:%M:%S%z"),
  r_version = R.version.string,
  rows = lapply(seq_len(nrow(res)), function(i) {
    c(list(participant_id = res$participant_id[i]),
      lapply(res[i, cols], function(v) if (is.na(v) || !is.finite(v)) NULL else unname(v)))
  })
)
out_file <- sprintf("validation/fixtures/isletcalc_%s.json", version)
write_json(out, out_file, auto_unbox = TRUE, digits = NA, pretty = TRUE, null = "null")
cat("wrote", out_file, "with", length(cols), "columns x", nrow(res), "rows\n")
