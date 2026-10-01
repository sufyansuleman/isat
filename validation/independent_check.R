#!/usr/bin/env Rscript
# Independent re-implementation of every ISAT V1 method, written from the published
# definitions (docs/v1-methods-spec.md and the cited papers), NOT from the TypeScript code.
# Compares against validation/fixtures/isat_results.json (from validation/export_isat.ts).
# Usage (repo root): Rscript validation/independent_check.R

suppressPackageStartupMessages(library(jsonlite))

x <- read.csv("validation/fixtures/inputs.csv", stringsAsFactors = FALSE)
isat <- fromJSON("validation/fixtures/isat_results.json", simplifyVector = FALSE)

# Conversion constants (ISAT defaults; InsuSensCalc-compatible)
G_MG <- 18; I_UU <- 6; TG_MG <- 88.57; HDL_MG <- 38.67
mg <- function(g) g * G_MG          # glucose mmol/L -> mg/dL
uu <- function(i) i / I_UU          # insulin pmol/L -> uU/mL
ok <- function(...) all(!is.na(c(...)))

# Belfiore 1998 normal reference means (canonical units; FFA umol/L -> mmol/L)
REF <- list(i0 = 65.71, g0 = 5.08, f0 = 398.88 / 1000,
            i012 = 638.00, g012 = 11.36, i02 = 363.04, g02 = 10.26)

calc <- function(r) {
  G0 <- r$G0; G30 <- r$G30; G60 <- r$G60; G90 <- r$G90; G120 <- r$G120
  I0 <- r$I0; I30 <- r$I30; I60 <- r$I60; I90 <- r$I90; I120 <- r$I120
  W <- r$weight; BMI <- r$bmi; male <- as.numeric(r$sex == 1)
  out <- list()
  # Fasting
  out$homa_ir        <- G0 * uu(I0) / 22.5                              # Matthews 1985
  out$quicki         <- 1 / (log10(uu(I0)) + log10(mg(G0)))             # Katz 2000
  out$firi           <- G0 * uu(I0) / 25                                # Duncan 1995
  out$raynaud        <- 40 / uu(I0)
  out$isi_basal      <- 1e4 / (mg(G0) * uu(I0))
  out$ig_ratio_basal <- uu(I0) / G0
  out$belfiore_basal <- 2 / ((I0 / REF$i0) * (G0 / REF$g0) + 1)         # Belfiore 1998
  # OGTT
  out$isi_120      <- 1e4 / (mg(G120) * uu(I120))
  out$ig_ratio_120 <- uu(I120) / G120
  out$gutt <- ((75000 + (mg(G0) - mg(G120)) * 0.19 * W) / 120) /
              ((G0 + G120) / 2) / log10((uu(I0) + uu(I120)) / 2)        # Gutt 2000
  out$matsuda_3pt <- if (ok(G30, I30))
    1e4 / sqrt(mg(G0) * uu(I0) * mean(mg(c(G0, G30, G120))) * mean(uu(c(I0, I30, I120)))) else NA
  out$matsuda_auc_3pt <- if (ok(G30, I30)) {
    gm <- (15 * mg(G0) + 60 * mg(G30) + 45 * mg(G120)) / 120
    im <- (15 * uu(I0) + 60 * uu(I30) + 45 * uu(I120)) / 120
    1e4 / sqrt(mg(G0) * uu(I0) * gm * im) } else NA
  out$matsuda_5pt <- if (ok(G30, G60, G90, I30, I60, I90))
    1e4 / sqrt(mg(G0) * uu(I0) * mean(mg(c(G0, G30, G60, G90, G120))) *
               mean(uu(c(I0, I30, I60, I90, I120)))) else NA          # Matsuda & DeFronzo 1999
  out$stumvoll_mod <- 0.156 - 0.0000459 * I120 - 0.000321 * I0 - 0.00541 * G120
  out$stumvoll_dem <- 0.222 - 0.00333 * BMI - 0.0000779 * I120 - 0.000422 * r$age
  out$bigtt_si <- exp(4.90 - 0.00402 * I0 - 0.000556 * I30 - 0.00127 * I120 - 0.152 * G0 -
                      0.00871 * G30 - 0.0373 * G120 - 0.145 * male - 0.0376 * BMI)  # Hansen 2007
  out$avignon_si0   <- 1e8 / (mg(G0) * uu(I0) * W * 150)                 # Avignon 1999
  out$avignon_si120 <- 1e8 / (mg(G120) * uu(I120) * W * 150)
  out$avignon_sim   <- (0.137 * out$avignon_si0 + out$avignon_si120) / 2
  out$belfiore_isi_gly <- if (ok(G60, I60)) {
    2 / (((0.5 * I0 + I60 + 0.5 * I120) / REF$i012) * ((0.5 * G0 + G60 + 0.5 * G120) / REF$g012) + 1)
  } else {
    2 / (((I0 + I120) / REF$i02) * ((G0 + G120) / REF$g02) + 1)
  }
  out$hiri <- ((mg(G0) + mg(G30)) / 2 / 100) * ((uu(I0) + uu(I30)) / 2)  # Gastaldelli 2022 form
  out$ifc  <- log(I120 / I0)                                             # Williamson 2023
  # Lipid / anthropometric
  out$revised_quicki <- 1 / (log10(uu(I0)) + log10(mg(G0)) + log10(r$FFA))
  out$mcauley <- exp(2.63 - 0.28 * log(uu(I0)) - 0.31 * log(r$TG))
  out$tyg     <- log(r$TG * TG_MG * mg(G0) / 2)
  out$tg_hdl  <- (r$TG * TG_MG) / (r$HDL_c * HDL_MG)
  out$vai <- if (male == 1) (r$waist / (39.68 + 1.88 * BMI)) * (r$TG / 1.03) * (1.31 / r$HDL_c)
             else (r$waist / (36.58 + 1.89 * BMI)) * (r$TG / 0.81) * (1.52 / r$HDL_c)
  out$lap <- if (male == 1) (r$waist - 65) * r$TG else (r$waist - 58) * r$TG
  out$adipo_ir <- r$FFA * uu(I0)
  out$belfiore_isi_ffa <- 2 / ((I0 / REF$i0) * (r$FFA / REF$f0) + 1)    # basal form (single FFA)
  # Tracer / DXA
  out$liri <- -0.091 + 0.4 * log10((I0 + I30) / 2) + 0.346 * log10(r$fat_mass / W * 100) -
              0.408 * log10(r$HDL_c * HDL_MG) + 0.435 * log10(BMI)
  out$lipo  <- r$rate_glycerol * uu(I0)
  out$atiri <- r$rate_palmitate * uu(I0)
  out
}

excluded <- c("cederholm", "bennett", "homa2")
rows <- lapply(seq_len(nrow(x)), function(i) as.list(x[i, ]))
n_ok <- 0; problems <- character()
for (i in seq_along(rows)) {
  ref <- calc(rows[[i]])
  got <- isat$default[[i]]$results
  pid <- isat$default[[i]]$participant_id
  stopifnot(pid == rows[[i]]$participant_id)
  for (m in unlist(isat$methods)) {
    g <- got[[m]]
    if (m %in% excluded) {
      if (g$status != "unavailable") problems <- c(problems, sprintf("%s %s: excluded but status %s", pid, m, g$status))
      next
    }
    expected <- ref[[m]]
    if (is.null(expected)) { problems <- c(problems, sprintf("%s %s: no independent implementation", pid, m)); next }
    if (is.na(expected)) {
      if (g$status == "ok") problems <- c(problems, sprintf("%s %s: R says unavailable, ISAT returned %s", pid, m, format(g$value)))
      else n_ok <- n_ok + 1
      next
    }
    if (g$status != "ok" || is.null(g$value)) {
      problems <- c(problems, sprintf("%s %s: ISAT status %s, R value %.10g", pid, m, g$status, expected)); next
    }
    rel <- abs(g$value - expected) / max(abs(expected), 1e-300)
    if (rel > 1e-9) problems <- c(problems, sprintf("%s %s: ISAT %.12g vs R %.12g (rel %.2e)", pid, m, g$value, expected, rel))
    else n_ok <- n_ok + 1
  }
}

# Avignon SiM with cohort-derived weight (InsuSensCalc / Suleman 2024 option)
s0 <- sapply(rows, function(r) calc(r)$avignon_si0); s120 <- sapply(rows, function(r) calc(r)$avignon_si120)
w <- mean(s120) / mean(s0)
for (i in seq_along(rows)) {
  e <- (w * s0[i] + s120[i]) / 2; g <- isat$sample_weight[[i]]$avignon_sim
  if (abs(g - e) / abs(e) > 1e-9) problems <- c(problems, sprintf("%s avignon_sim(sample): ISAT %.12g vs R %.12g", rows[[i]]$participant_id, g, e))
  else n_ok <- n_ok + 1
}

# Edge cases: no method may return a number from invalid input
edge_bad <- character()
for (case in names(isat$edge)) {
  for (m in names(isat$edge[[case]])) {
    g <- isat$edge[[case]][[m]]
    if (g$status != "ok" && length(g$reasons) == 0) edge_bad <- c(edge_bad, sprintf("%s/%s: %s without a reason", case, m, g$status))
    if (g$status == "ok" && (is.null(g$value) || !is.finite(g$value))) edge_bad <- c(edge_bad, sprintf("%s/%s: ok but non-finite value", case, m))
  }
}
dep <- function(case, m) isat$edge[[case]][[m]]$status
checks <- c(
  "empty input -> nothing ok" = all(sapply(isat$edge$empty, function(g) g$status != "ok")),
  "glucose 0 -> quicki error" = dep("glucose_zero", "quicki") == "error",
  "glucose 0 -> homa_ir not ok" = dep("glucose_zero", "homa_ir") != "ok",
  "insulin < 0 -> homa_ir error" = dep("insulin_negative", "homa_ir") == "error",
  "insulin 0 missing -> homa_ir unavailable" = dep("insulin_missing_0", "homa_ir") == "unavailable",
  "glucose NaN -> homa_ir not ok" = dep("glucose_nan", "homa_ir") != "ok",
  "no sex -> vai unavailable" = dep("no_sex", "vai") == "unavailable",
  "no sex -> bigtt unavailable" = dep("no_sex", "bigtt_si") == "unavailable",
  "no weight -> gutt unavailable" = dep("no_weight", "gutt") == "unavailable"
)

cat(sprintf("Independent R vs ISAT: %d checks agree (rel 1e-9 or matching unavailability)\n", n_ok))
cat(sprintf("Mismatches: %d\n", length(problems))); if (length(problems)) cat(paste0("  ", problems, "\n"), sep = "")
cat(sprintf("Edge-case structural problems: %d\n", length(edge_bad))); if (length(edge_bad)) cat(paste0("  ", edge_bad, "\n"), sep = "")
cat("Edge-case behaviour:\n"); for (k in names(checks)) cat(sprintf("  [%s] %s\n", if (isTRUE(checks[[k]])) "PASS" else "FAIL", k))
quit(status = if (length(problems) || length(edge_bad) || !all(checks)) 1 else 0)
