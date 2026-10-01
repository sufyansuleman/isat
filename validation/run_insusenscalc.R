#!/usr/bin/env Rscript
# Regenerate legacy expected values by running InsuSensCalc's own source on validation inputs.
# Usage: Rscript validation/run_insusenscalc.R [path/to/InsuSensCalc]
# Output: validation/fixtures/insusenscalc_<version>.json (raw legacy columns, unrounded)

suppressPackageStartupMessages({
  library(dplyr); library(magrittr); library(tibble); library(jsonlite)
})

args <- commandArgs(trailingOnly = TRUE)
ref_dir <- if (length(args) >= 1) args[1] else "../InsuSensCalc_ref"
version <- read.dcf(file.path(ref_dir, "DESCRIPTION"), fields = "Version")[1, 1]
source(file.path(ref_dir, "R", "calc_indices.R"))

inputs <- read.csv("validation/fixtures/inputs.csv", stringsAsFactors = FALSE)
# All four InsuSensCalc categories, including tracer_dxa
res <- suppressMessages(suppressWarnings(
  isi_calculator(inputs, category = c("fasting", "ogtt", "adipo", "tracer_dxa"))
))

legacy_cols <- setdiff(names(res), names(inputs))
out <- list(
  source = "InsuSensCalc",
  version = version,
  generated = format(Sys.time(), "%Y-%m-%dT%H:%M:%S%z"),
  r_version = R.version.string,
  rows = lapply(seq_len(nrow(res)), function(i) {
    c(list(participant_id = res$participant_id[i]),
      lapply(res[i, legacy_cols], function(v) if (is.na(v) || !is.finite(v)) NULL else unname(v)))
  })
)
out_file <- sprintf("validation/fixtures/insusenscalc_%s.json", version)
write_json(out, out_file, auto_unbox = TRUE, digits = NA, pretty = TRUE, null = "null")
cat("wrote", out_file, "with", length(legacy_cols), "columns x", nrow(res), "rows\n")
