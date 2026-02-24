import csv, os
scenarios=["MTP25_2020","MTP25_2030","MTP25_2033","MTP25_2040","MTP25_2050","MTP25_2050NB"]
root=r"C:\Dashboard\Json\ABMVIZ_MTP25\data"
for sc in scenarios:
    path=os.path.join(root,sc,"3DAnimatedMapData.csv")
    if not os.path.exists(path):
        print(sc,"missing file")
        continue
    zones=set()
    with open(path,newline='') as f:
        r=csv.reader(f)
        next(r,None)
        for row in r:
            zones.add(row[0])
    print(sc,len(zones))
