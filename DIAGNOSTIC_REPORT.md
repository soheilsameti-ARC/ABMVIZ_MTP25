# Diagnostic Report: TRIP MODE by COUNTY and TRIP O&D Map Loading Issues

## Issues Found

### 1. County GeoJSON Format Mismatch
**File:** `data/cb_2015_us_county_500k_GEORGIA.json`
- **Format:** GeometryCollection (not FeatureCollection)
- **Size:** 26.7 MB
- **Issue:** Contains 586 geometries with NO properties attribute (missing NAME field)
- **Impact:** Map filtering code tried to access `feature.properties.NAME` which was undefined
- **Error Type:** Silent failure - county layer wouldn't render

### 2. Unsafe Property Access in barchart_and_map.js
**Lines affected:**
- Line 279: `feature.properties.NAME == currentCounty` (no null check)
- Line 421: `feature.properties.id` and `feature.properties.MTAZ10` (no null check)
- Line 514: `layer.feature.properties.NAME` (no null check)

**Impact:** When county features have no properties, code would throw errors or silently fail

---

## Solutions Implemented

### Fix 1: Modified `src/barchart_and_map.js` - County Layer Loading (Lines 454-491)
Added capability to handle both FeatureCollection and GeometryCollection formats:
- Detects if county GeoJSON has properties with NAME field
- Applies filter only if properties exist
- Logs fallback message when properties are missing
- Validates bounds before fitting to map

**Key Code:**
```javascript
var hasProperties = false;
if (countyTiles.features && countyTiles.features.length > 0) {
  hasProperties = countyTiles.features.some(function(f) {
    return f.properties && f.properties.NAME;
  });
}

if (hasProperties) {
  geoJsonOptions.filter = function (feature) {
    return feature.properties && countiesSet.has(feature.properties.NAME);
  };
} else {
  console.log("County GeoJSON has no NAME properties; loading all geometries without filtering");
}

if (allCountyBounds.isValid && allCountyBounds.isValid()) {
  map.fitBounds(allCountyBounds);
}
```

### Fix 2: Added Null Checks for Property Access (Lines 279, 421, 514)
- Line 279: Added `feature.properties &&` check before accessing `.NAME`
- Line 421: Added null safety for both `id` and `MTAZ10` properties
- Line 514: Added validity check before accessing `layer.feature.properties.NAME`

### Fix 3: od.js Already Handles GeometryCollection (Lines 225-228)
The O&D page code already properly handles GeometryCollection format:
```javascript
if (countiesGeo.type === 'GeometryCollection' && countiesGeo.geometries) {
  countyFeatures = countiesGeo.geometries.map(function(g) {
    return { type: 'Feature', geometry: g, properties: g.properties || {} };
  });
}
```

---

## Data Files Validated
- **ZoneShape.GeoJSON:** 35.5 MB, 5,922 features, valid (has properties)
- **Desirelines.csv:** Present in all scenario folders (5,640 rows typical)
- **SuperDistricts.topojson:** Present
- **cb_2015_us_county_500k_GEORGIA.json:** 26.7 MB, 586 geometries, NO properties

---

## Expected Behavior After Fixes
1. **TRIP MODE by COUNTY page:** County layer will now display all county geometries without filtering errors
2. **TRIP O&D page:** County overlay will render properly with centroid-based Dawson county injection (already implemented)
3. **Console logs:** Messages will indicate when properties are missing and fallback is in use
4. Maps should load successfully without JavaScript errors

---

## Files Modified
- `src/barchart_and_map.js`: Added 4 safety checks + conditional county layer logic

## Files Checked (No Changes Needed)
- `src/od.js`: Already handles GeometryCollection properly
- `src/index.html`: HTML structure is correct
- Data files: All present and valid
