"""Golden tax cases — the pure engine, per province + edge cases. No DB."""

from clientbridge.services.tax_service import TaxComponent, TaxLine, compute_tax

BC = [TaxComponent("GST", 500), TaxComponent("PST", 700)]
ON = [TaxComponent("HST", 1300)]
QC = [TaxComponent("GST", 500), TaxComponent("QST", 998)]
AB = [TaxComponent("GST", 500)]
NS = [TaxComponent("HST", 1500)]


def test_bc_exclusive() -> None:
    r = compute_tax([TaxLine(10000)], BC)
    assert r.subtotal_cents == 10000
    assert r.by_jurisdiction == {"GST": 500, "PST": 700}
    assert r.tax_total_cents == 1200
    assert r.total_cents == 11200


def test_on_hst() -> None:
    r = compute_tax([TaxLine(10000)], ON)
    assert r.tax_total_cents == 1300
    assert r.by_jurisdiction == {"HST": 1300}


def test_qc_qst_is_precise() -> None:
    # $1000: QST is legally 9.975% = $99.75, NOT 9.98% (= $99.80).
    r = compute_tax([TaxLine(100000)], QC)
    assert r.by_jurisdiction == {"GST": 5000, "QST": 9975}
    assert r.tax_total_cents == 14975


def test_qc_small_amount_rounds_half_up() -> None:
    # $100: QST 9.975 → $9.98 (round half up).
    assert compute_tax([TaxLine(10000)], QC).by_jurisdiction == {"GST": 500, "QST": 998}


def test_ab_gst_only() -> None:
    assert compute_tax([TaxLine(10000)], AB).tax_total_cents == 500


def test_ns_hst_15() -> None:
    assert compute_tax([TaxLine(10000)], NS).tax_total_cents == 1500


def test_inclusive_backs_out_tax() -> None:
    # $112 includes BC's 12% → base $100, tax $12.
    r = compute_tax([TaxLine(11200)], BC, prices_include_tax=True)
    assert r.subtotal_cents == 10000
    assert r.tax_total_cents == 1200
    assert r.by_jurisdiction == {"GST": 500, "PST": 700}
    assert r.total_cents == 11200


def test_small_supplier_collects_no_tax() -> None:
    r = compute_tax([TaxLine(10000)], BC, registered=False)
    assert r.tax_total_cents == 0
    assert r.total_cents == 10000


def test_exempt_line_is_untaxed() -> None:
    assert compute_tax([TaxLine(10000, taxable=False)], BC).tax_total_cents == 0


def test_multi_line_aggregates() -> None:
    r = compute_tax([TaxLine(10000), TaxLine(5000, taxable=False), TaxLine(2000)], BC)
    assert r.subtotal_cents == 17000
    # taxable base 12000 → GST 600, PST 840
    assert r.by_jurisdiction == {"GST": 600, "PST": 840}
    assert r.tax_total_cents == 1440


def test_per_line_rounding_half_up() -> None:
    # $9.99 BC: GST 49.95→50, PST 69.93→70
    r = compute_tax([TaxLine(999)], BC)
    assert r.by_jurisdiction == {"GST": 50, "PST": 70}
    assert r.tax_total_cents == 120
