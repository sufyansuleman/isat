#!/usr/bin/env Rscript
# Independent base-R recomputation of the ISAT transforms, descriptive statistics, Spearman and Pearson correlations.
# Compares against validation/fixtures/transform_results.json (from validation/export_transform.ts).
# Usage (repo root): Rscript validation/transform_check.R

suppressPackageStartupMessages(library(jsonlite))
res <- fromJSON("validation/fixtures/transform_results.json", simplifyVector = FALSE)
num <- function(l) vapply(l, function(v) if (is.null(v)) NA_real_ else as.numeric(v), numeric(1))
TOL <- 1e-9
n_ok <- 0L; problems <- character()
check <- function(label, got, exp) {
  got <- as.numeric(got); exp <- as.numeric(exp)
  bad <- (is.na(got) != is.na(exp)) | (!is.na(got) & !is.na(exp) & abs(got - exp) > TOL * pmax(1, abs(exp)))
  if (length(got) != length(exp) || any(bad)) problems <<- c(problems, sprintf("%s: %d of %d values differ", label, sum(bad), length(exp)))
  else n_ok <<- n_ok + length(exp)
}

v <- lapply(res$inputs[c("x1", "x2", "x3")], num)
sex <- vapply(res$inputs$sex, function(s) if (is.null(s)) NA_character_ else s, character(1))

blom <- function(x) { n <- sum(!is.na(x)); r <- rank(x, ties.method = "average", na.last = "keep"); qnorm((r - 3/8) / (n + 1/4)) }
zs <- function(x) { if (sum(!is.na(x)) < 2 || sd(x, na.rm = TRUE) == 0) return(rep(NA_real_, length(x))); as.numeric(scale(x)) }
lg <- function(x) { y <- x; y[!is.na(x) & x <= 0] <- NA; log(y) }
fn <- list(log = lg, z = zs, rint = blom)
by_sex <- function(x, f) { out <- rep(NA_real_, length(x)); for (g in c("male", "female")) { i <- which(sex == g); out[i] <- f(x[i]) }; out }

for (nm in names(v)) for (k in names(fn)) {
  x <- v[[nm]]
  check(paste(nm, k), num(res$transforms[[paste0(nm, "_", k)]]$values), fn[[k]](x))
  check(paste(nm, k, "by sex"), num(res$transforms[[paste0(nm, "_", k, "_bysex")]]$values), by_sex(x, fn[[k]]))
  check(paste(nm, k, "non-positive"), res$transforms[[paste0(nm, "_", k)]]$non_positive, if (k == "log") sum(!is.na(x) & x <= 0) else 0)
}

skew_g1 <- function(x) { x <- x[!is.na(x)]; n <- length(x); m2 <- mean((x - mean(x))^2); m3 <- mean((x - mean(x))^3); (m3 / m2^1.5) * sqrt(n * (n - 1)) / (n - 2) }
for (nm in names(v)) {
  x <- v[[nm]]; d <- res$describe[[nm]]; xx <- x[!is.na(x)]
  q <- quantile(xx, c(0.25, 0.5, 0.75), type = 7, names = FALSE)
  check(paste(nm, "describe"),
        c(d$n, d$missing, d$mean, d$sd, d$median, d$q1, d$q3, d$min, d$max, d$skewness),
        c(length(xx), sum(is.na(x)), mean(xx), sd(xx), q[2], q[1], q[3], min(xx), max(xx), skew_g1(x)))
}

for (key in names(res$spearman)) {
  ab <- strsplit(key, "__", fixed = TRUE)[[1]]
  ok <- !is.na(v[[ab[1]]]) & !is.na(v[[ab[2]]])
  r <- cor(v[[ab[1]]], v[[ab[2]]], method = "spearman", use = "pairwise.complete.obs")
  check(paste("spearman", key), c(res$spearman[[key]]$rho, res$spearman[[key]]$n), c(r, sum(ok)))
}

for (key in names(res$pearson)) {
  ab <- strsplit(key, "__", fixed = TRUE)[[1]]
  ok <- !is.na(v[[ab[1]]]) & !is.na(v[[ab[2]]])
  r <- cor(v[[ab[1]]], v[[ab[2]]], method = "pearson", use = "pairwise.complete.obs")
  check(paste("pearson", key), c(res$pearson[[key]]$r, res$pearson[[key]]$n), c(r, sum(ok)))
}

check("qnorm", vapply(res$qnorm, function(e) e$q, numeric(1)), qnorm(vapply(res$qnorm, function(e) e$p, numeric(1))))

# Bandwidth (bw.nrd0) and exact Gaussian kernel density on the ISAT grid, recomputed as mean(dnorm((g - x)/bw))/bw.
for (nm in names(res$bw)) check(paste("bw.nrd0", nm), res$bw[[nm]], bw.nrd0(v[[nm]][!is.na(v[[nm]])]))
for (nm in names(res$kde)) {
  d <- res$kde[[nm]]; x <- v[[nm]][!is.na(v[[nm]])]; g <- num(d$x); b <- as.numeric(d$bw)
  check(paste("kde bandwidth", nm), b, bw.nrd0(x))
  check(paste("kde n", nm), d$n, length(x))
  check(paste("kde", nm), num(d$y), sapply(g, function(gg) mean(dnorm((gg - x) / b)) / b))
}

cat(sprintf("Independent R vs ISAT transforms: %d values agree (tolerance %g)\n", n_ok, TOL))
cat(sprintf("Mismatches: %d\n", length(problems))); if (length(problems)) cat(paste0("  ", problems, "\n"), sep = "")
quit(status = if (length(problems)) 1 else 0)
