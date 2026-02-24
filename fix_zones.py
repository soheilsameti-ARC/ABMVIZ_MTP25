#!/usr/bin/env python3
"""
Convert the ZONE column of each 3DAnimatedMapData.csv in the listed scenario
folders to text.  The simplest transformation is to wrap the existing value in
quotes, but here we just ensure it is written as a string; if you need a prefix
(e.g. 'Z1' instead of '1') uncomment the indicated line.
"""

import csv
from pathlib import Path

scenarios = [
    "MTP25_2020",
    "MTP25_2030",
    "MTP25_2033",
    "MTP25_2040",
    "MTP25_2050",
    "MTP25_2050NB",  # note uppercase NB in folder name
]

root = Path(__file__).parent  # project root

for sc in scenarios:
    csv_path = root / "data" / sc / "3DAnimatedMapData.csv"
    if not csv_path.exists():
        print(f"skipping {sc}: file not found")
        continue

    tmp_path = csv_path.with_suffix(".tmp")
    with csv_path.open(newline="") as fin, tmp_path.open("w", newline="") as fout:
        reader = csv.reader(fin)
        writer = csv.writer(fout, quoting=csv.QUOTE_MINIMAL)

        try:
            header = next(reader)
        except StopIteration:
            print(f"{csv_path} is empty – skipping")
            continue

        writer.writerow(header)
        for row in reader:
            # row[0] is ZONE – convert to string and optionally alter:
            zone = str(row[0])
            # zone = "Z" + zone   # <- uncomment to prefix with 'Z'
            row[0] = zone
            writer.writerow(row)

    tmp_path.replace(csv_path)
    print(f"updated {csv_path}")
