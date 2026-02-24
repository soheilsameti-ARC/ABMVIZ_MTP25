import csv
path=r"c:\\Dashboard\\Json\\ABMVIZ_MTP25\\data\\MTP25_2020\\3DAnimatedMapData.csv"
unique=set()
maxz=0
samples=[]
with open(path, newline='') as f:
    r=csv.DictReader(f)
    for row in r:
        z=int(row['ZONE'])
        unique.add(z)
        if z>maxz: maxz=z
        if z>1000 and len(samples)<10:
            samples.append(row)
print('unique count',len(unique))
print('max zone',maxz)
print('samples>',len(samples))
for s in samples:
    print(s)