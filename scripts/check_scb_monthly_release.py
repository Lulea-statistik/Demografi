#!/usr/bin/env python3
"""Check the SCB 2025+ monthly population table on scheduled release days.

The publication calendar determines dates and target reference periods. Only a
real new monthly period in SCB's current table is recorded; no estimated data.
"""
import datetime as dt
import json
import pathlib
import sys
from zoneinfo import ZoneInfo

import requests

ROOT = pathlib.Path(__file__).resolve().parents[1]
CALENDAR = ROOT / "scb_publications.json"
STATUS = ROOT / "scb_data_status.json"
TABLE = "TAB6473"
URL = f"https://statistikdatabasen.scb.se/api/v2/tables/{TABLE}/metadata"
ZONE = ZoneInfo("Europe/Stockholm")


def target_release(schedule, today):
    return next((r for r in schedule.get("releases", [])
                 if r.get("date") == today.isoformat()
                 and isinstance(r.get("period"), str)
                 and len(r["period"]) == 7
                 and r["period"][:4].isdigit()
                 and r["period"][4] == "M"
                 and r["period"][5:].isdigit()), None)


def get_months(metadata):
    dimensions = []
    if isinstance(metadata.get("id"), list) and isinstance(metadata.get("dimension"), dict):
        for name in metadata["id"]:
            dimension = metadata["dimension"].get(name, {})
            index = (dimension.get("category") or {}).get("index", {})
            vals = index if isinstance(index, list) else list(index.keys())
            dimensions.append((name, vals))
    else:
        dimensions = [
            (v.get("code", ""), v.get("values", []))
            for v in metadata.get("variables", metadata.get("Variables", []))
        ]
    candidates = [(key, vals) for key, vals in dimensions
                  if any(str(value).startswith("20") and "M" in str(value) for value in vals)]
    if len(candidates) != 1:
        raise ValueError("SCB:s tidsdimension kunde inte identifieras entydigt")
    months = [str(value) for value in candidates[0][1]
              if len(str(value)) == 7 and str(value)[:4].isdigit()
              and str(value)[4] == "M" and str(value)[5:].isdigit()]
    if not months:
        raise ValueError("Inga giltiga månadsperioder i SCB-metadata")
    return sorted(months)


def main():
    now = dt.datetime.now(ZONE)
    schedule = json.loads(CALENDAR.read_text(encoding="utf-8"))
    release = target_release(schedule, now.date())
    if not release:
        print(f"{now.date()}: ingen månadsvis SCB-publicering enligt den lokala kalendern.")
        return 0
    existing = json.loads(STATUS.read_text(encoding="utf-8")) if STATUS.exists() else {}
    target = release["period"]
    if existing.get("latest_period", "") >= target:
        print(f"{target} har redan verifierats. Ingen ytterligare SCB-förfrågan behövs.")
        return 0

    response = requests.get(URL, params={"lang": "sv"}, timeout=25,
                            headers={"User-Agent": "Lulea-statistik-Demografi/1.0"})
    response.raise_for_status()
    months = get_months(response.json())
    newest = months[-1]
    print(f"Planerad referensmånad: {target}. Nyast hos SCB: {newest}.")
    if newest < target:
        print("Ingen ny publicerad period ännu. Nästa schemalagda kontroll får försöka igen.")
        return 0

    STATUS.write_text(json.dumps({
        "latest_period": newest,
        "verified_at": now.isoformat(timespec="seconds"),
        "reference_period": target,
        "source": URL
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Ny månad verifierad: {newest}. Statusfilen uppdaterad.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"SCB-kontroll misslyckades: {exc}", file=sys.stderr)
        sys.exit(1)
