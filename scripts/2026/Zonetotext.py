import pandas as pd

# File path
file_path = r"C:\Dashboard\ABMVIZ\Tables\2020\3DAnimatedMapData.csv"

# Read CSV (force ZONE as string)
df = pd.read_csv(file_path, dtype={"ZONE": str})

# Make absolutely sure it's string and strip whitespace
df["ZONE"] = df["ZONE"].astype(str).str.strip()

# Optional: remove .0 if numbers were saved as floats previously
df["ZONE"] = df["ZONE"].str.replace(r"\.0$", "", regex=True)

# Save back to same file
df.to_csv(file_path, index=False)

print("ZONE column successfully converted to text.")
