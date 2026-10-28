"""The replication health probe's per-business bucket totals."""

from scripts.replication_health import Bucket, by_business


def test_buckets_count_for_each_business_their_parameters_name() -> None:
    owners = {
        "bz_a": {"bz_a"},
        "bz_b": {"bz_b"},
        "st_a": {"bz_a"},
        "us_both": {"bz_a", "bz_b"},
    }
    buckets = [
        Bucket('1#business_full|0["bz_a"]', 10, 1000),
        Bucket('1#history_full|0["bz_a","2026-10"]', 4, 400),
        Bucket('1#history_self|0["2026-10","st_a"]', 2, 200),
        Bucket('1#staff_limited|2["us_both"]', 1, 50),
        Bucket('1#business_full|0["bz_b"]', 3, 300),
        Bucket('1#staff_self|0["st_gone"]', 5, 500),
        Bucket("1#global[]", 1, 10),
    ]
    assert by_business(buckets, owners) == {
        "bz_a": {"buckets": 4, "operations": 17, "bytes": 1650},
        "bz_b": {"buckets": 2, "operations": 4, "bytes": 350},
    }
