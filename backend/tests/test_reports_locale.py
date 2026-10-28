import csv
import io
import re
import zipfile

import httpx
import pytest

from clientbridge.core.config import get_settings

KINDS = ["income", "sales-by-item", "gst-hst", "pst", "t4a", "payouts", "staff-pay"]
PERIOD = {"start": "2000-01-01", "end": "2100-01-01"}


async def _export(api: httpx.AsyncClient) -> dict[str, list[list[str]]]:
    res = await api.post("/v1/reports/export", json={"kinds": KINDS, **PERIOD})
    assert res.status_code == 200, res.text
    with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
        return {
            name: list(csv.reader(io.StringIO(zf.read(name).decode()))) for name in zf.namelist()
        }


async def test_en_xa_pseudo_localizes_headers_and_keeps_data(
    as_owner: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    english = await _export(as_owner)
    monkeypatch.setattr(get_settings(), "pseudo_locale", True)
    pseudo = await _export(as_owner)
    assert pseudo.keys() == english.keys() and len(pseudo) == len(KINDS)
    for name, rows in pseudo.items():
        header, *data = rows
        assert len(header) == len(english[name][0]), name
        labels = [row[0] for row in data] if name.startswith("income-") else []
        for cell in header + labels:
            assert cell.startswith("[") and cell.endswith("~]"), cell
            assert not re.search(r"[A-Za-z]", cell.split(":")[0]), cell
        if labels:
            data, english[name] = [r[1:] for r in data], [r[1:] for r in english[name]]
        assert data == english[name][1:], name


async def test_en_ca_headers_stay_machine_readable(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.get("/v1/reports/payouts.csv?start=2000-01-01&end=2100-01-01")
    assert res.text.splitlines()[0] == "payout,arrival,amount_cents,status"
