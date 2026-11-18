#!/usr/bin/env python3
"""Update SCB monthly population publication dates, ignoring other BE0101 releases."""
import datetime as dt
import json
import pathlib
import re
import sys

import requests
from bs4 import BeautifulSoup

URL = "https://www.scb.se/hitta-statistik/publiceringskalendern/"
PARAMS = {"period": "Forward1Year", "prodKod": "BE0101"}
OUT = pathlib.Path(__file__).resolve().parents[1] / "scb_publications.json"
MONTHS = [
    "januari", "februari", "mars", "april", "maj", "juni",
    "juli", "augusti", "september", "oktober", "november", "december"
]
MONTH_RE = re.compile(r"^(" + "|".join(MONTHS) + r")\s+(20\d\d)$", re.I)
DATE_RE = re.compile(r"20\d\d-\d\d-\d\d")


def parse_calendar(html, today):
    soup = BeautifulSoup(html, "html.parser")
    releases = []
    for tr in soup.select("tr"):
        cells = [re.sub(r"\s+", " ", td.get_text(" ", strip=True)).strip()
                 for td in tr.select("td")]
        if len(cells) < 3:
            continue
        # Make sure the name of the publication is exactly Befolkningsstatistik,
        # not a secondary publication with a related or different title.
        if not any(c.lower() == "befolkningsstatistik" for c in cells):
            continue
        monthly = next((MONTH_RE.fullmatch(c) for c in cells if MONTH_RE.fullmatch(c)), None)
        if monthly is None:
            continue  # Excludes quarters, years and '1 november 2026'.
        name, year = monthly.groups()
        month_num = MONTHS.index(name.lower()) + 1
        dates = [d for c in cells for d in DATE_RE.findall(c)]
        if not dates:
            continue
        # A moved publication may list two dates: the newer one should appear last.
        date_str = dates[-1]
        try:
            date = dt.date.fromisoformat(date_str)
        except ValueError:
            continue
        if date < today:
            continue
        releases.append({"date": date_str, "period": f"{year}M{month_num:02d}"})
    return sorted({(r["date"], r["period"]): r for r in releases}.values(),
                  key=lambda r: (r["date"], r["period"]))


def main():
    today = dt.datetime.now(dt.timezone.utc).date()
    response = requests.get(URL, params=PARAMS, timeout=30,
                            headers={"User-Agent": "Lulea-statistik-publiceringskalender/1.0"})
    response.raise_for_status()
    releases = parse_calendar(response.text, today)
    if not releases:
        print("Ingen verifierbar framtida månadsrad i kalendern; bevarar befintlig fil.", file=sys.stderr)
        return 1
    output = {
        "source": response.url,
        "checked_on": today.isoformat(),
        "releases": releases,
    }
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    # Avoid commits when data are identical; changes in checked_on alone are not significant.
    if old.get("releases") == releases:
        print("Ingen ändring av publiceringsdatum.")
        return 0
    OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Verifierade månadsvisa publiceringsdatum:", releases)
    return 0


if __name__ == "__main__":
    sys.exit(main())
