"""Test-only Monte Carlo audit of conditional mean CI coverage, never telemetry data."""

import argparse
import json
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.analysis.corner_dynamics import lap_repeatability


def evaluate(repetitions: int = 3000, seed: int = 0) -> dict:
    """Compare iid normal and stationary AR(1) coverage with known mean zero."""
    rng = np.random.default_rng(seed)
    rows = []
    for rho in (0., .5):
        for count in (5, 6, 8, 12, 20):
            samples = rng.normal(size=(repetitions, count))
            for index in range(1, count):
                samples[:, index] = rho * samples[:, index-1] + np.sqrt(1-rho**2) * samples[:, index]
            intervals = np.asarray([lap_repeatability(row.tolist())["mean_ci95"] for row in samples])
            covered = (intervals[:, 0] <= 0) & (intervals[:, 1] >= 0)
            coverage = float(covered.mean())
            rows.append({"process": "iid_normal" if rho == 0 else "stationary_ar1", "rho": rho,
                         "lap_count": count, "coverage": coverage,
                         "coverage_monte_carlo_se": float(np.sqrt(coverage*(1-coverage)/repetitions)),
                         "mean_width": float(np.diff(intervals, axis=1).mean())})
    return {"source": "synthetic_test_only_not_driver_evidence", "seed": seed, "repetitions_per_cell": repetitions,
            "method": "student_t_iid_mean", "true_mean": 0., "stationary_variance": 1., "rows": rows,
            "limitations": "AR(1) violates independence. Undercoverage is expected and is not fixed by Student t. No empirical session coverage guarantee."}


def main() -> None:
    """Write reproducible test results and a readable limitation audit."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repetitions", type=int, default=3000)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--output", type=Path, default=Path("tmp/repeatability-coverage"))
    args = parser.parse_args()
    if args.repetitions < 100:
        parser.error("Use at least 100 repetitions.")
    result = evaluate(args.repetitions, args.seed)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "summary.json").write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
    lines = ["# Mean interval coverage audit", "", "Synthetic test data only; not driver observations.", "",
             "| Process | n | Coverage | Monte Carlo SE | Mean width |", "|---|---:|---:|---:|---:|"]
    for row in result["rows"]:
        lines.append(f"| {row['process']} | {row['lap_count']} | {row['coverage']:.4f} | {row['coverage_monte_carlo_se']:.4f} | {row['mean_width']:.4f} |")
    lines.extend(["", result["limitations"], "", "The previous block-bootstrap method is retired; these measurements evaluate only its replacement."])
    (args.output / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
