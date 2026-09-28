"""
End-to-end training & evaluation.

    python -m twin_engine.train

Outputs (artifacts/):
    risk_model.txt, calibrator.joblib, features.json   the fused risk engine
    twin_prior.json                                    population prior for personal twin calibration
    sentinel_bandit.json                               LinUCB policy pre-trained in silico
    metrics.json                                       every number quoted in the deck/README
    risk_history.parquet                               test-set predictions (for the dashboard replay)
    plots/*.png                                        ROC, PR, calibration, ablation, drivers, lead time
"""

from __future__ import annotations

import json
import time

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, average_precision_score, brier_score_loss, roc_curve, precision_recall_curve
from sklearn.calibration import calibration_curve

from .config import ARTIFACT_DIR, TRUTH_DIR, TIER_HIGH, TIER_MEDIUM, HORIZON_HOURS, SEED
from .features import Cohort, build_features, labels, driver_group
from .model import RiskModel, PlattCalibrator, train_booster
from .twin import fit_prior, calibrate, driver_contributions, phenotype, apply_scenario, TERMS
from .sentinel import CATALOGUE, ARM_IDS, LinUCB, context_vector

PLOTS = ARTIFACT_DIR / "plots"
TEAL, INK, WARM, GREY = "#00b3b3", "#1b2330", "#e8833a", "#9aa4b2"


def build_dataset(cohort: Cohort) -> pd.DataFrame:
    hours = cohort.prediction_hours()
    frames = []
    for pid in cohort.patient_ids:
        ps = cohort.streams(pid)
        X = build_features(ps, cohort.static.loc[pid], hours)
        y, lead = labels(ps, hours)
        X.insert(0, "patient_id", pid)
        X.insert(1, "hour", hours)
        X["y"] = y
        X["lead_h"] = lead
        frames.append(X)
    return pd.concat(frames, ignore_index=True)


def split_patients(ids: list[str], seed: int = SEED):
    rng = np.random.default_rng(seed)
    p = rng.permutation(ids)
    n = len(p)
    return list(p[: int(0.6 * n)]), list(p[int(0.6 * n): int(0.75 * n)]), list(p[int(0.75 * n):])


def binary_metrics(y, p, thr, df) -> dict:
    a = p >= thr
    tp, fp = int((a & (y == 1)).sum()), int((a & (y == 0)).sum())
    fn, tn = int((~a & (y == 1)).sum()), int((~a & (y == 0)).sum())
    weeks = df["patient_id"].nunique() * (df["hour"].max() - df["hour"].min() + 24) / 168
    return {"threshold": thr, "sensitivity": tp / max(tp + fn, 1), "specificity": tn / max(tn + fp, 1),
            "ppv": tp / max(tp + fp, 1), "alerts_per_patient_week": float(a.sum() / weeks / 4)}  # 4 queries/day → alert-days


def event_lead_times(test_df: pd.DataFrame, probs: np.ndarray, events: pd.DataFrame, thr: float) -> dict:
    """For every test-set surge: was there an alert in the 24 h before onset, and how early was the first one?"""
    d = test_df[["patient_id", "hour"]].copy()
    d["p"] = probs
    by_pid = {k: g for k, g in d.groupby("patient_id")}
    leads, caught, total = [], 0, 0
    for _, e in events.iterrows():
        g = by_pid.get(e["patient_id"])
        if g is None:
            continue
        onset = e["onset_hour"]
        win = g[(g["hour"] <= onset) & (g["hour"] > onset - HORIZON_HOURS)]
        if not len(win):
            continue
        total += 1
        hit = win[win["p"] >= thr]
        if len(hit):
            caught += 1
            leads.append(onset - hit["hour"].min())
    leads = np.array(leads)
    return {"events_evaluated": total, "events_caught": caught, "event_recall": caught / max(total, 1),
            "median_lead_h": float(np.median(leads)) if len(leads) else None,
            "mean_lead_h": float(np.mean(leads)) if len(leads) else None,
            "pct_caught_6h_plus": float((leads >= 6).mean()) if len(leads) else None,
            "lead_hist": leads.tolist()}


def main():
    t0 = time.time()
    ARTIFACT_DIR.mkdir(exist_ok=True)
    PLOTS.mkdir(parents=True, exist_ok=True)
    cohort = Cohort()
    print("Building fused dataset ...")
    df = build_dataset(cohort)
    df.to_parquet(ARTIFACT_DIR / "dataset.parquet", index=False)
    tr_ids, va_ids, te_ids = split_patients(cohort.patient_ids)
    (ARTIFACT_DIR / "split.json").write_text(json.dumps({"train": tr_ids, "valid": va_ids, "test": te_ids}))
    tr, va, te = (df[df.patient_id.isin(s)] for s in (tr_ids, va_ids, te_ids))
    feats = [c for c in df.columns if c not in ("patient_id", "hour", "y", "lead_h")]
    print(f"Samples: train {len(tr):,} | valid {len(va):,} | test {len(te):,} | features {len(feats)} "
          f"| positive rate {df.y.mean():.3f}")

    # ── Fusion ablation ───────────────────────────────────────────────
    ehr = [f for f in feats if f.startswith("ehr_")]
    cuff = [f for f in feats if f.startswith("cuff_")]
    timef = ["hour_of_day", "day_of_week"]
    wear = [f for f in feats if f not in ehr and f not in cuff and f not in timef]
    sets = {
        "EHR only (static)": ehr + timef,
        "Home cuff only (standard care)": cuff + timef,
        "Wearables + MyZenn only": wear + timef,
        "All dynamic streams": cuff + wear + timef,
        "HridayTwin fusion (EHR + streams)": feats,
    }
    ablation = {}
    for name, cols in sets.items():
        b = train_booster(tr[cols], tr.y.to_numpy(), va[cols], va.y.to_numpy())
        p = b.predict(te[cols], num_iteration=b.best_iteration)
        ablation[name] = {"auroc": roc_auc_score(te.y, p), "auprc": average_precision_score(te.y, p), "n_features": len(cols)}
        print(f"  {name:38s} AUROC {ablation[name]['auroc']:.3f}  AUPRC {ablation[name]['auprc']:.3f}")
    rule = te["cuff_sbp_last"].fillna(te["cuff_sbp_last"].median())
    ablation["Clinical rule (last home SBP)"] = {"auroc": roc_auc_score(te.y, rule),
                                                 "auprc": average_precision_score(te.y, rule), "n_features": 1}

    # ── Final fused model + calibration ───────────────────────────────
    booster = train_booster(tr[feats], tr.y.to_numpy(), va[feats], va.y.to_numpy())
    cal = PlattCalibrator().fit(booster.predict(va[feats], num_iteration=booster.best_iteration), va.y.to_numpy())
    model = RiskModel(booster, cal, feats)
    model.save()
    p_te = model.predict(te)
    events = pd.read_csv(TRUTH_DIR / "events.csv")
    te_events = events[events.patient_id.isin(te_ids)]
    metrics = {
        "cohort": {"patients": len(cohort.patient_ids), "days": cohort.days, "train_patients": len(tr_ids),
                   "valid_patients": len(va_ids), "test_patients": len(te_ids), "samples": len(df),
                   "features": len(feats), "positive_rate": float(df.y.mean()), "events_total": len(events),
                   "events_test": len(te_events)},
        "test": {"auroc": roc_auc_score(te.y, p_te), "auprc": average_precision_score(te.y, p_te),
                 "brier": brier_score_loss(te.y, p_te), "prevalence": float(te.y.mean()),
                 "at_high": binary_metrics(te.y.to_numpy(), p_te, TIER_HIGH, te),
                 "at_medium": binary_metrics(te.y.to_numpy(), p_te, TIER_MEDIUM, te)},
        "lead_time_high": event_lead_times(te, p_te, te_events, TIER_HIGH),
        "lead_time_medium": event_lead_times(te, p_te, te_events, TIER_MEDIUM),
        "ablation": ablation,
        "best_iteration": booster.best_iteration,
    }
    gain = pd.Series(booster.feature_importance("gain"), index=feats)
    metrics["driver_importance"] = (gain.groupby(gain.index.map(driver_group)).sum() / gain.sum()).sort_values(ascending=False).round(4).to_dict()
    metrics["top_features"] = (gain / gain.sum()).sort_values(ascending=False).head(15).round(4).to_dict()
    print(f"Fused test AUROC {metrics['test']['auroc']:.3f} | AUPRC {metrics['test']['auprc']:.3f} | "
          f"Brier {metrics['test']['brier']:.3f}")
    lt = metrics["lead_time_medium"]
    print(f"Events caught (medium tier): {lt['event_recall']:.1%}, median lead {lt['median_lead_h']} h")

    hist = te[["patient_id", "hour", "y", "lead_h"]].copy()
    hist["prob"] = p_te
    hist.to_parquet(ARTIFACT_DIR / "risk_history.parquet", index=False)

    # ── Mechanistic twin: prior + validation against hidden physiology ─
    print("Calibrating personal twins ...")
    prior = fit_prior([cohort.streams(p) for p in tr_ids])
    (ARTIFACT_DIR / "twin_prior.json").write_text(json.dumps(prior.to_dict()))
    latent = pd.read_csv(TRUTH_DIR / "latent_params.csv").set_index("patient_id")
    rows = []
    last_hour = cohort.H - 1
    for pid in te_ids:
        ps = cohort.streams(pid)
        tw = calibrate(ps, prior)
        contrib = driver_contributions(ps, tw, last_hour)
        ph = phenotype(contrib)
        top2 = sorted(contrib, key=contrib.get, reverse=True)[:2]
        rows.append({"patient_id": pid, **{f"theta_{n}": tw.theta[i] for i, n in enumerate(TERMS)},
                     "phenotype_driver": ph["driver"], "phenotype_top2": top2, "true_driver": latent.loc[pid, "dominant_driver"],
                     "true_beta": latent.loc[pid, "stress_beta"], "true_gamma": latent.loc[pid, "sleep_gamma"],
                     "true_salt": latent.loc[pid, "salt_sens"], "true_med": latent.loc[pid, "med_effect"]})
    tv = pd.DataFrame(rows)
    has_truth = tv["true_driver"].notna() & (tv["true_driver"] != "")
    metrics["twin_validation"] = {
        "corr_stress_sensitivity": float(tv["theta_stress"].corr(tv["true_beta"], method="spearman")),
        "corr_sleep_sensitivity": float(tv["theta_sleep_debt"].corr(tv["true_gamma"], method="spearman")),
        "corr_salt_sensitivity": float(tv["theta_salt_load"].corr(tv["true_salt"], method="spearman")),
        "corr_drug_effect": float((-tv["theta_drug_level"]).corr(tv["true_med"], method="spearman")),
        "phenotype_accuracy": float((tv.loc[has_truth, "phenotype_driver"] == tv.loc[has_truth, "true_driver"]).mean()),
        "phenotype_top2_accuracy": float(np.mean([t in p for t, p in zip(tv.loc[has_truth, "true_driver"], tv.loc[has_truth, "phenotype_top2"])])),
        "phenotype_majority_baseline": float(tv.loc[has_truth, "true_driver"].value_counts(normalize=True).iloc[0]),
        "phenotype_n": int(has_truth.sum()),
        "prior": prior.to_dict(),
    }
    print("  Twin validation:", {k: round(v, 3) for k, v in metrics["twin_validation"].items() if isinstance(v, float)})

    # ── MySentinel bandit: in-silico pre-training on the twin cohort ──
    print("Pre-training MySentinel bandit in silico ...")
    rng = np.random.default_rng(SEED)

    def cf_reward(pid, hour, feat_row, base_p, arm_idx):
        ps = cohort.streams(pid)
        tw = calibrate(ps, prior, until_hour=hour)
        m = apply_scenario(ps, hour, CATALOGUE[arm_idx].scenario, tw=tw)
        Xc = build_features(m, cohort.static.loc[pid], np.array([hour]))
        return float(base_p - model.predict(Xc)[0])

    p_tr = model.predict(tr)
    cand = tr.assign(p=p_tr)[p_tr >= 0.2]
    samp = cand.sample(min(1500, len(cand)), random_state=SEED)
    bandit = LinUCB(ARM_IDS, dim=7, alpha=0.5)
    for _, r in samp.iterrows():
        x = context_vector(r.to_dict(), r.p)
        arm = bandit.select(x)
        rew = cf_reward(r.patient_id, int(r.hour), r, r.p, ARM_IDS.index(arm)) + rng.normal(0, 0.02)
        bandit.update(arm, x, rew)
    bandit.save()
    # Evaluate on held-out patients against the twin "oracle" (best arm by simulation)
    te_c = te.assign(p=p_te)[p_te >= 0.2]
    ev = te_c.sample(min(250, len(te_c)), random_state=SEED + 1)
    agree, gains, rand, best = 0, [], [], []
    for _, r in ev.iterrows():
        rewards = [cf_reward(r.patient_id, int(r.hour), r, r.p, k) for k in range(len(CATALOGUE))]
        pick = ARM_IDS.index(max(bandit.scores(context_vector(r.to_dict(), r.p)).items(), key=lambda kv: kv[1]["mean"])[0])
        agree += int(pick == int(np.argmax(rewards)))
        gains.append(rewards[pick])
        rand.append(float(np.mean(rewards)))
        best.append(max(rewards))
    metrics["sentinel"] = {
        "train_rounds": len(samp), "arm_pulls": bandit.pulls,
        "top1_agreement_with_twin_oracle": agree / max(len(ev), 1),
        "mean_risk_reduction_bandit": float(np.mean(gains)), "mean_risk_reduction_random": float(np.mean(rand)),
        "mean_risk_reduction_oracle": float(np.mean(best)), "eval_points": len(ev),
    }
    print("  Sentinel:", {k: (round(v, 3) if isinstance(v, float) else v) for k, v in metrics["sentinel"].items()})

    metrics["runtime_s"] = round(time.time() - t0, 1)
    (ARTIFACT_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2, default=float))
    make_plots(te, p_te, metrics, tv)
    print(f"Done in {metrics['runtime_s']} s -> {ARTIFACT_DIR}")


def make_plots(te, p, metrics, tv):
    plt.rcParams.update({"font.family": "DejaVu Sans", "axes.spines.top": False, "axes.spines.right": False,
                         "axes.edgecolor": GREY, "axes.labelcolor": INK, "xtick.color": INK, "ytick.color": INK})
    y = te.y.to_numpy()

    fig, ax = plt.subplots(1, 3, figsize=(15, 4.4))
    fpr, tpr, _ = roc_curve(y, p)
    ax[0].plot(fpr, tpr, color=TEAL, lw=2.5, label=f"HridayTwin (AUROC {metrics['test']['auroc']:.2f})")
    ax[0].plot([0, 1], [0, 1], ls="--", color=GREY, lw=1)
    ax[0].set(xlabel="False positive rate", ylabel="True positive rate", title="ROC, held-out patients")
    ax[0].legend(frameon=False, loc="lower right")
    pr, rc, _ = precision_recall_curve(y, p)
    ax[1].plot(rc, pr, color=TEAL, lw=2.5, label=f"AUPRC {metrics['test']['auprc']:.2f}")
    ax[1].axhline(y.mean(), ls="--", color=GREY, lw=1, label=f"Prevalence {y.mean():.2f}")
    ax[1].set(xlabel="Recall", ylabel="Precision", title="Precision–recall")
    ax[1].legend(frameon=False)
    fp, mp = calibration_curve(y, p, n_bins=10, strategy="quantile")
    ax[2].plot(mp, fp, "o-", color=TEAL, lw=2)
    ax[2].plot([0, 1], [0, 1], ls="--", color=GREY, lw=1)
    ax[2].set(xlabel="Predicted probability", ylabel="Observed frequency",
              title=f"Calibration (Brier {metrics['test']['brier']:.3f})")
    fig.tight_layout()
    fig.savefig(PLOTS / "performance.png", dpi=160)
    plt.close(fig)

    ab = pd.DataFrame(metrics["ablation"]).T.sort_values("auroc")
    fig, ax = plt.subplots(figsize=(9, 4.2))
    colors = [TEAL if "fusion" in n else (WARM if "rule" in n.lower() else GREY) for n in ab.index]
    ax.barh(ab.index, ab["auroc"], color=colors)
    for i, v in enumerate(ab["auroc"]):
        ax.text(v + 0.004, i, f"{v:.3f}", va="center", color=INK, fontsize=10)
    ax.set_xlim(0.5, 1.0)
    ax.set(xlabel="AUROC (held-out patients)", title="Fusion ablation: each data stream adds signal")
    fig.tight_layout()
    fig.savefig(PLOTS / "ablation.png", dpi=160)
    plt.close(fig)

    di = pd.Series(metrics["driver_importance"]).sort_values()
    fig, ax = plt.subplots(figsize=(8, 4.2))
    ax.barh(di.index, di.values * 100, color=TEAL)
    ax.set(xlabel="Share of model gain (%)", title="What the risk engine relies on")
    fig.tight_layout()
    fig.savefig(PLOTS / "drivers.png", dpi=160)
    plt.close(fig)

    lh = metrics["lead_time_medium"]["lead_hist"]
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.hist(lh, bins=np.arange(0, 25, 3), color=TEAL, edgecolor="white")
    ax.axvline(np.median(lh), color=WARM, lw=2, label=f"median {np.median(lh):.0f} h")
    ax.set(xlabel="Hours of warning before surge onset", ylabel="Surges", title="Early-warning lead time")
    ax.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(PLOTS / "lead_time.png", dpi=160)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(5.2, 4.4))
    ax.scatter(tv["true_beta"], tv["theta_stress"], color=TEAL, alpha=0.75, edgecolor="white")
    ax.set(xlabel="True stress sensitivity (hidden, mmHg)", ylabel="Twin-estimated stress coefficient",
           title=f"Twin recovers hidden physiology\n(Spearman ρ = {metrics['twin_validation']['corr_stress_sensitivity']:.2f})")
    fig.tight_layout()
    fig.savefig(PLOTS / "twin_validation.png", dpi=160)
    plt.close(fig)


if __name__ == "__main__":
    main()
