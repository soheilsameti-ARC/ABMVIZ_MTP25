(function (d3, abmviz_utilities) {
  'use strict';

  (function createCountyOD() {
    var divID = 'countyOd';
    var containerID = 'countyOdMap';

    var selectedColorRampIndex = 1;
    var maxLineWidth = 4;
    var currentTileLayer;
    var countyLineLayer;
    var selectedAttribute = 'ALLALL';

    var palette = [
      [
        '#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6',
        '#4292c6', '#2171b5', '#08519c', '#08306b', '#041b33'
      ],
      [
        '#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c',
        '#fc4e2a', '#e31a1c', '#bd0026', '#800026', '#4d0025'
      ],
      [
        '#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476',
        '#41ab5d', '#238b45', '#006d2c', '#00441b', '#002510'
      ],
      [
        '#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a',
        '#ef3b2c', '#cb181d', '#a50f15', '#67000d', '#3f0008'
      ],
      [
        '#041b33', '#08306b', '#08519c', '#2171b5', '#4292c6',
        '#6baed6', '#9ecae1', '#c6dbef', '#deebf7', '#f7fbff'
      ],
      [
        '#ffffd9', '#edf8b1', '#c7e9b4', '#7fcdbb', '#41b6c4',
        '#1d91c0', '#225ea8', '#253494', '#081d58', '#081d58'
      ]
    ];

    // Load scenario from URL parameter or scenarios.csv
    var urlScenario = abmviz_utilities.GetURLParameter('scenario');
    
    function loadScenarios(callback) {
      d3.csv('../data/scenarios.csv', function(err, scenarios) {
        if (err) {
          console.error('Failed to load scenarios.csv:', err);
          callback('MTP24_2020'); // Fallback to default
          return;
        }
        
        var scenario = urlScenario;
        
        // If no URL parameter, use first scenario from CSV
        if (!scenario && scenarios.length > 0) {
          scenario = scenarios[0].Scenario;
          console.log('Using default scenario from scenarios.csv:', scenario);
        } else if (!scenario) {
          scenario = 'MTP24_2020'; // Ultimate fallback
        }
        
        console.log('Selected scenario:', scenario);
        callback(scenario);
      });
    }

    // Load scenario first, then initialize map
    loadScenarios(function(scenario) {
      var csvPath = '../data/' + scenario + '/county_desirelines.csv';
      var nodesPath = '../data/' + scenario + '/county_nodes.csv';
      var countiesPath = '../data/counties.topojson';
      var fallbackCountiesPath = '../data/counties.topojson';
      var desirelinesPath = '../data/county_desirelines.topojson';
      var fallbackDesirelinesPath = '../data/county_desirelines.topojson';
      var centroidsPath = '../data/Counties_Centroids.topojson';

      console.log('Loading county OD data from:', csvPath);

      // Load CSV with explicit error handling
      d3.csv(csvPath, function(err, csv) {
        if (err) {
          console.error('Error loading CSV:', err);
          d3.select('#' + divID).remove();
          return;
        }

        console.log('=== CSV DEBUG INFO ===');
        console.log('Rows:', csv ? csv.length : 0);
        console.log('Columns:', csv && csv.columns ? csv.columns : 'UNDEFINED');
        console.log('First row:', csv && csv.length > 0 ? csv[0] : 'NO ROWS');
        console.log('CSV object type:', typeof csv);
        console.log('CSV keys:', csv ? Object.keys(csv) : 'N/A');
        console.log('=== END DEBUG ===');

        if (!csv || csv.length === 0) {
          console.error('CSV is empty or failed to parse');
          d3.select('#' + divID).remove();
          return;
        }

        // Load TopoJSON files and county node CSV
        Promise.all([
          new Promise((resolve, reject) => loadWithFallback(d3.json, countiesPath, fallbackCountiesPath, (err, data) => err ? reject(err) : resolve(data))),
          new Promise((resolve, reject) => loadWithFallback(d3.json, desirelinesPath, fallbackDesirelinesPath, (err, data) => err ? reject(err) : resolve(data))),
          new Promise((resolve, reject) => loadWithFallback(d3.json, centroidsPath, null, (err, data) => err ? reject(err) : resolve(data))),
          new Promise((resolve) => d3.csv(nodesPath, function(err, data) {
            if (err) {
              console.warn('Failed to load county_nodes.csv:', err);
              resolve([]);
              return;
            }
            resolve(data);
          }))
        ]).then(([countiesTopo, desirelinesTopo, centroidsTopo, nodeCsv]) => {
          console.log('Data loaded successfully - CSV rows:', csv.length);
          initMap(csv, countiesTopo, desirelinesTopo, centroidsTopo, nodeCsv);
        }).catch(err => {
          console.error('Error loading TopoJSON data:', err);
          d3.select('#' + divID).remove();
        });
      });
    });

    function normalizeFips(v) {
      if (v === undefined || v === null || v === '') return null;
      var s = String(v).trim();
      if (/^\d+\.0+$/.test(s)) s = String(parseInt(s, 10));
      return s.padStart(5, '0');
    }

    function firstDefined(obj, keys) {
      for (var i = 0; i < keys.length; i += 1) {
        if (obj[keys[i]] !== undefined && obj[keys[i]] !== null && obj[keys[i]] !== '') {
          return obj[keys[i]];
        }
      }
      return undefined;
    }

    function prettyLabel(col) {
      var labels = {
        ALLALL: 'All Trips',
        WRKALL: 'Work Trips',
        NWKALL: 'Non-Work Trips',
        ALLSOV: 'SOV',
        ALLHOV: 'HOV',
        ALLTRN: 'Transit',
        ALLWALK: 'Walk',
        ALLBIKE: 'Bike'
      };

      return labels[col] || col;
    }

    function formatNumber(num) {
      return Math.round(num || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function roundToThousands(num) {
      if (num === null || num === undefined || isNaN(num)) return 0;
      return Math.round(num / 1000) * 1000;
    }

    function loadWithFallback(loader, mainPath, fallbackPath, callback) {
      loader(mainPath, function(err, data) {
        if (!err && data) {
          callback(null, data);
          return;
        }

        if (!fallbackPath) {
          callback(err, null);
          return;
        }

        loader(fallbackPath, function(err2, data2) {
          callback(err2, data2);
        });
      });
    }

    function getTopoFeatures(topo) {
      if (!topo) return [];

      if (topo.type === 'FeatureCollection') {
        return topo.features || [];
      }

      if (topo.objects) {
        var key = topo.objects.transit ? 'transit' : Object.keys(topo.objects)[0];
        return topojson.feature(topo, topo.objects[key]).features || [];
      }

      return [];
    }

    function getClassColor(value, breaks) {
      if (value === null || value === undefined || isNaN(value)) {
        return '#f0f0f0';
      }

      for (var i = 0; i < breaks.length - 1; i += 1) {
        if (value <= breaks[i + 1] || i === breaks.length - 2) {
          return palette[selectedColorRampIndex][i];
        }
      }

      return palette[selectedColorRampIndex][palette[selectedColorRampIndex].length - 1];
    }

    function getLineWeight(value, maxValue) {
      if (!maxValue || maxValue <= 0 || !value) return 0;

      var ratio = value / maxValue;

  // Compress extreme values so the largest OD line does not become huge
      var weight = Math.sqrt(ratio) * maxLineWidth;

  // Hard cap thickness
      return Math.max(0.75, Math.min(4, weight));
    }

    function getBidirectionalValue(feature, odData) {
      var p = feature.properties || {};
      var o = normalizeFips(firstDefined(p, ['o', 'ORIG_FIPS', 'ORIG']));
      var d = normalizeFips(firstDefined(p, ['d', 'DEST_FIPS', 'DEST']));

      var a = odData[o] && odData[o][d] ? odData[o][d][selectedAttribute] || 0 : 0;
      var b = odData[d] && odData[d][o] ? odData[d][o][selectedAttribute] || 0 : 0;

      return a + b;
    }

    function getDirectionalValue(odData, o, d) {
      return odData[o] && odData[o][d] ? odData[o][d][selectedAttribute] || 0 : 0;
    }

    function buildBreaks(values) {
      var validValues = values.filter(function(v) {
        return v !== null && v !== undefined && !isNaN(v) && v > 0;
      });

      if (!validValues.length) {
        return [0, 1];
      }

      var serie = new geostats(validValues);

      try {
        return serie.getClassJenks(10);
      } catch (e) {
        var max = d3.max(validValues);
        return d3.range(0, 11).map(function(i) {
          return (max / 10) * i;
        });
      }
    }

    function updateLegend(breaks) {
      var legendDiv = d3.select('#countyOdLegend');

      if (legendDiv.empty()) return;

      legendDiv.html('');

      if (!breaks || breaks.length < 2) {
        legendDiv.text('No legend available');
        return;
      }

      var rectWidth = 110;
      var li = { h: 32, s: 5, r: 3 };
      var totalLegendWidth = (breaks.length - 1) * (rectWidth + li.s);

      var legend = legendDiv
        .append('svg')
        .attr('width', totalLegendWidth)
        .attr('height', li.h);

      var legendGroups = legend
        .selectAll('g')
        .data(d3.range(breaks.length - 1))
        .enter()
        .append('g')
        .attr('transform', function(d, i) {
          return 'translate(' + i * (rectWidth + li.s) + ',0)';
        });

      legendGroups
        .append('rect')
        .attr('rx', li.r)
        .attr('ry', li.r)
        .attr('width', rectWidth)
        .attr('height', li.h)
        .style('fill', function(d, i) {
          return palette[selectedColorRampIndex][i];
        });

      legendGroups
        .append('text')
        .attr('x', rectWidth / 2)
        .attr('y', li.h / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .style('fill', 'white')
        .style('font-size', '12px')
        .style('font-weight', 'bold')
        .text(function(d, i) {
          return formatNumber(roundToThousands(breaks[i])) + ' - ' + formatNumber(roundToThousands(breaks[i + 1]));
        });
    }

    function buildPaletteSelector(updateStyle) {
      var rampContainer = d3.select('#countyOdColorRamp');

      if (rampContainer.empty()) return;

      rampContainer.selectAll('*').remove();

      var rampClasses = ['Blues', 'Oranges', 'Greens', 'Reds', 'ReversedBlues', 'Teals'];

      palette.forEach(function(ramp, i) {
        var rampDiv = rampContainer
          .append('div')
          .attr('class', 'ramp ' + rampClasses[i] + (i === selectedColorRampIndex ? ' selected' : ''))
          .style('display', 'inline-block')
          .style('cursor', 'pointer')
          .style('margin', '2px')
          .style('border', i === selectedColorRampIndex ? '2px solid black' : '1px solid #ccc')
          .on('click', function() {
            d3.selectAll('#countyOdColorRamp .ramp')
              .classed('selected', false)
              .style('border', '1px solid #ccc');

            d3.select(this)
              .classed('selected', true)
              .style('border', '2px solid black');

            selectedColorRampIndex = i;
            updateStyle();
          });

        var svg = rampDiv.append('svg').attr('width', 60).attr('height', 15);
        var colors = ramp.slice(0, 4);

        colors.forEach(function(color, j) {
          svg
            .append('rect')
            .attr('fill', color)
            .attr('width', 15)
            .attr('height', 15)
            .attr('x', j * 15);
        });
      });
    }

    function initMap(csv, countiesTopo, desirelinesTopo, centroidsTopo, nodeCsv) {
      if (!csv || !csv.length) {
        console.error('No county OD records loaded');
        d3.select('#' + divID).remove();
        return;
      }

      // D3 v3 doesn't auto-populate csv.columns, so extract them from the first row
      var csvColumns = Object.keys(csv[0]);
      console.log('Extracted CSV columns:', csvColumns);

      // MOVE THIS TO THE TOP - Before it's used
      var countyFeatures = getTopoFeatures(countiesTopo);
      var centroidFeatures = getTopoFeatures(centroidsTopo);
      var nodeDataByFips = {};
      var countyNameByFips = {};

      countyFeatures.forEach(function(f) {
        var p = f.properties || {};
        var fips = normalizeFips(firstDefined(p, ['FIPS', 'GEOID', 'COUNTYFP']));
        var name = firstDefined(p, ['NAME', 'name', 'County', 'COUNTY', 'NAMELSAD']) || fips;

        if (fips) {
          countyNameByFips[fips] = name;
          console.log('Mapped FIPS:', fips, '→', name);
        }
      });

      (nodeCsv || []).forEach(function(row) {
        var fips = normalizeFips(firstDefined(row, ['FIPS', 'fips']));

        if (!fips) return;

        nodeDataByFips[fips] = {
          county: firstDefined(row, ['county', 'County', 'COUNTY']) || countyNameByFips[fips] || fips,
          allTrips: Math.round(+row.trips_produced || +row.trips_attracted || 0),
          sov: Math.round(+row.sov || 0),
          hov: Math.round(+row.hov || 0),
          walk: Math.round(+row.walk || 0),
          bike: Math.round(+row.bike || 0)
        };
      });

      var numericColumns = csvColumns.filter(function(col) {
        var idColumns = {
          ORIG_FIPS: true,
          DEST_FIPS: true,
          origin_county: true,
          destination_county: true,
          Origin_Long: true,
          Origin_Lat: true,
          Dest_Long: true,
          Dest_Lat: true,
          od_id: true
        };

        if (idColumns[col]) return false;

        return csv.some(function(row) {
          return row[col] !== undefined && row[col] !== null && row[col] !== '' && !isNaN(+row[col]);
        });
      });

      console.log('Numeric columns found:', numericColumns);

      if (!numericColumns.length) {
        console.error('No numeric columns found in county_desirelines.csv');
        d3.select('#' + divID).remove();
        return;
      }

      selectedAttribute = numericColumns.indexOf('ALLALL') >= 0 ? 'ALLALL' : numericColumns[0];

      var attributeSelect = d3.select('#countyOdAttribute');
      attributeSelect.selectAll('option').remove();

      attributeSelect
        .selectAll('option')
        .data(numericColumns)
        .enter()
        .append('option')
        .attr('value', function(d) { return d; })
        .property('selected', function(d) { return d === selectedAttribute; })
        .text(function(d) { return prettyLabel(d); });

      var odData = {};

      csv.forEach(function(row) {
        var o = normalizeFips(firstDefined(row, ['ORIG_FIPS', 'origin_fips', 'ORIG', 'o']));
        var d = normalizeFips(firstDefined(row, ['DEST_FIPS', 'destination_fips', 'DEST', 'd']));

        if (!o || !d || o === d) return;

        if (!odData[o]) odData[o] = {};

        var rowValues = {};
        numericColumns.forEach(function(col) {
          rowValues[col] = Math.round(+row[col] || 0);
        });

        rowValues.origin_county = countyNameByFips[o] || firstDefined(row, ['origin_county', 'oName', 'Origin_County']) || o;
        rowValues.destination_county = countyNameByFips[d] || firstDefined(row, ['destination_county', 'dName', 'Destination_County']) || d;

        odData[o][d] = rowValues;
      });

      var desireFeatures = getTopoFeatures(desirelinesTopo);

      if (!desireFeatures.length) {
        desireFeatures = csv.map(function(row) {
          var o = normalizeFips(firstDefined(row, ['ORIG_FIPS', 'origin_fips', 'ORIG', 'o']));
          var d = normalizeFips(firstDefined(row, ['DEST_FIPS', 'destination_fips', 'DEST', 'd']));

          var origLon = +firstDefined(row, ['Origin_Long', 'origin_long', 'Orig_Long']);
          var origLat = +firstDefined(row, ['Origin_Lat', 'origin_lat', 'Orig_Lat']);
          var destLon = +firstDefined(row, ['Dest_Long', 'dest_long', 'Dest_Long']);
          var destLat = +firstDefined(row, ['Dest_Lat', 'dest_lat', 'Dest_Lat']);

          if (!o || !d || o === d || isNaN(origLon) || isNaN(origLat) || isNaN(destLon) || isNaN(destLat)) {
            return null;
          }

          return {
            type: 'Feature',
            properties: {
              o: o,
              d: d,
              oName: firstDefined(row, ['origin_county', 'oName', 'Origin_County']) || countyNameByFips[o] || o,
              dName: firstDefined(row, ['destination_county', 'dName', 'Destination_County']) || countyNameByFips[d] || d
            },
            geometry: {
              type: 'LineString',
              coordinates: [
                [origLon, origLat],
                [destLon, destLat]
              ]
            }
          };
        }).filter(function(f) {
          return f !== null;
        });
      }

      desireFeatures.forEach(function(f) {
        var p = f.properties || {};

        p.o = normalizeFips(firstDefined(p, ['o', 'ORIG_FIPS', 'ORIG']));
        p.d = normalizeFips(firstDefined(p, ['d', 'DEST_FIPS', 'DEST']));

        p.oName = firstDefined(p, ['oName', 'origin_county', 'Origin_County']) || countyNameByFips[p.o] || p.o;
        p.dName = firstDefined(p, ['dName', 'destination_county', 'Destination_County']) || countyNameByFips[p.d] || p.d;
      });

      desireFeatures.sort(function(a, b) {
        return getBidirectionalValue(b, odData) - getBidirectionalValue(a, odData);
      });

      if (window.countyOdMapInstance) {
        window.countyOdMapInstance.off();
        window.countyOdMapInstance.remove();
        window.countyOdMapInstance = null;
      }

      $('#' + containerID).empty();

      var map = L.map(containerID).setView([33.792902, -84.349885], 8);
      window.countyOdMapInstance = map;

      currentTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution:  '&copy; OpenStreetMap contributors &copy; CARTO',
        maxZoom: 20,
        subdomains: 'abcd'
      }).addTo(map);

      if (L.Control && L.Control.Fullscreen) {
        map.addControl(new L.Control.Fullscreen());
      }

      var countiesLayer = L.geoJSON(countyFeatures, {
        style: function() {
          return {
            fillColor: '#ffffff',
            weight: 1,
            opacity: 1,
            color: '#777',
            fillOpacity: 0.2
          };
        }
      }).addTo(map);

      countyLineLayer = L.layerGroup().addTo(map);
      var arrowheadsLayer = L.layerGroup().addTo(map);
      map.on('zoomend', function() {
              updateVisibleLines();
            });

      function renderCountyOdTable(rows) {
        var tbody = d3.select('#countyOdTable tbody');
        if (tbody.empty()) return;
        tbody.html('');

        var sorted = rows.slice().sort(function(a, b) {
          return (+b.ALLALL || 0) - (+a.ALLALL || 0);
        });

        sorted.forEach(function(row) {
          var o = normalizeFips(firstDefined(row, ['ORIG_FIPS', 'origin_fips', 'ORIG', 'o']));
          var d = normalizeFips(firstDefined(row, ['DEST_FIPS', 'destination_fips', 'DEST', 'd']));
          var origin = countyNameByFips[o] || firstDefined(row, ['origin_county', 'Origin_County', 'oName']) || o;
          var dest = countyNameByFips[d] || firstDefined(row, ['destination_county', 'Destination_County', 'dName']) || d;

          tbody.append('tr').html(
            '<td>' + origin + '</td>' +
            '<td>' + dest + '</td>' +
            '<td>' + formatNumber(+row.ALLALL || 0) + '</td>' +
            '<td>' + formatNumber(+row.ALLSOV || 0) + '</td>' +
            '<td>' + formatNumber(+row.ALLHOV || 0) + '</td>' +
            '<td>' + formatNumber(+row.ALLWALK || 0) + '</td>' +
            '<td>' + formatNumber(+row.ALLBIKE || 0) + '</td>'
          );
        });
      }

      function updateArrowheads() {
        arrowheadsLayer.clearLayers();

        var maxValue = getCurrentMax();
        var breaks = getCurrentBreaks();
        var visibleCount = getVisibleFeatureCount();

        desireFeatures.slice(0, visibleCount).forEach(function(feature) {
          var coords = feature.geometry && feature.geometry.coordinates;
          if (!coords || coords.length < 2) return;

          var last = coords[coords.length - 1];
          var prev = coords[coords.length - 2];
          var end = L.latLng(last[1], last[0]);
          var start = L.latLng(prev[1], prev[0]);
          var ptEnd = map.latLngToLayerPoint(end);
          var ptStart = map.latLngToLayerPoint(start);
          var dx = ptEnd.x - ptStart.x;
          var dy = ptEnd.y - ptStart.y;
          var length = Math.sqrt(dx * dx + dy * dy);
          if (length < 1) return;

          var ux = dx / length;
          var uy = dy / length;
          var lineWeight = getLineWeight(getBidirectionalValue(feature, odData), maxValue);
          var arrowLen = Math.max(7, Math.min(13, lineWeight * 2.4));
          var arrowWidth = arrowLen * 0.38;
          var baseX = ptEnd.x - ux * arrowLen;
          var baseY = ptEnd.y - uy * arrowLen;
          var left = map.layerPointToLatLng(L.point(baseX + uy * arrowWidth, baseY - ux * arrowWidth));
          var right = map.layerPointToLatLng(L.point(baseX - uy * arrowWidth, baseY + ux * arrowWidth));
          var color = getClassColor(getBidirectionalValue(feature, odData), breaks);

          var arrow = L.polygon([left, end, right], {
            color: color,
            fillColor: color,
            weight: 0,
            opacity: 1,
            fillOpacity: 0.75,
            interactive: false
          });

          arrowheadsLayer.addLayer(arrow);
        });
        if (arrowheadsLayer.bringToFront) {
          arrowheadsLayer.bringToFront();
        }
      }

      var centroidsLayer = L.geoJSON(centroidFeatures, {
        pointToLayer: function(feature, latlng) {
          return L.circleMarker(latlng, {
            radius: 6,
            fillColor: '#ff7800',
            color: '#333',
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8
          });
        },
        onEachFeature: function(feature, layer) {
          var p = feature.properties || {};
          var fips = normalizeFips(firstDefined(p, ['FIPS', 'fips']));
          var node = nodeDataByFips[fips] || {};
          var countyName = firstDefined(p, ['county', 'COUNTY', 'County']) || node.county || fips;

          var popupContent =
            '<strong>County:</strong> ' + countyName + '<br/>' +
            '<strong>All Trips:</strong> ' + formatNumber(node.allTrips) + '<br/>' +
            '<strong>SOV:</strong> ' + formatNumber(node.sov) + '<br/>' +
            '<strong>HOV:</strong> ' + formatNumber(node.hov) + '<br/>' +
            '<strong>Walk:</strong> ' + formatNumber(node.walk) + '<br/>' +
            '<strong>Bike:</strong> ' + formatNumber(node.bike);

          layer.bindPopup(popupContent);
        }
      }).addTo(map);

      function getCurrentValues() {
        return desireFeatures.map(function(feature) {
          return getBidirectionalValue(feature, odData);
        });
      }

      function getCurrentMax() {
        var values = getCurrentValues();
        return d3.max(values) || 1;
      }

      function getCurrentBreaks() {
        return buildBreaks(getCurrentValues());
      }

      function getVisibleFeatureCount() {
        var zoom = map.getZoom();
        if (zoom <= 7) return Math.min(50, desireFeatures.length);
        if (zoom === 8) return Math.min(75, desireFeatures.length);
        if (zoom === 9) return Math.min(120, desireFeatures.length);
        if (zoom === 10) return Math.min(220, desireFeatures.length);
        if (zoom === 11) return Math.min(320, desireFeatures.length);
        return desireFeatures.length;
      }
      function updateVisibleLines() {
        var visibleCount = getVisibleFeatureCount();

        countyLineLayer.clearLayers();

        var visibleFeatures = desireFeatures
          .slice(0, visibleCount)
          .slice()
          .reverse();

        visibleFeatures.forEach(function(feature) {
          var value = getBidirectionalValue(feature, odData);
          if (value <= 0) return;

          var layer = L.geoJSON(feature, {
            style: {
              color: getClassColor(value, getCurrentBreaks()),
              weight: getLineWeight(value, getCurrentMax()),
              opacity: 0.3,
              lineCap: 'round',
              lineJoin: 'round',
              className: 'county-od-line'
            },
            onEachFeature: function(feature, layer) {
              bindCountyOdPopupAndTooltip(feature, layer);
            }
          });

          layer.addTo(countyLineLayer);
      });

  updateArrowheads();
}

      function sortDesireFeaturesByCurrentAttribute() {
        desireFeatures.sort(function(a, b) {
          return getBidirectionalValue(b, odData) - getBidirectionalValue(a, odData);
        });
      }

      function updateStyle() {
        if (!countyLineLayer) {
          countyLineLayer = L.layerGroup().addTo(map);
        }

        sortDesireFeaturesByCurrentAttribute();

        var maxValue = getCurrentMax();
        var breaks = getCurrentBreaks();
        var visibleCount = getVisibleFeatureCount();

        updateLegend(breaks);

        
        updateVisibleLines();


        if (countyLineLayer && countyLineLayer.bringToFront) {
          countyLineLayer.bringToFront();
        }
        updateArrowheads();
      }

      function bindCountyOdPopupAndTooltip(feature, layer) {
        var p = feature.properties || {};
        var o = p.o;
        var d = p.d;
        var flow = (odData[o] && odData[o][d]) ? odData[o][d] : {};

        var popupContent =
          '<strong>Origin County:</strong> ' + (p.oName || o) + '<br/>' +
          '<strong>Destination County:</strong> ' + (p.dName || d) + '<br/>' +
          '<strong>All Trips:</strong> ' + formatNumber(flow.ALLALL) + '<br/>' +
          '<strong>SOV:</strong> ' + formatNumber(flow.ALLSOV) + '<br/>' +
          '<strong>HOV:</strong> ' + formatNumber(flow.ALLHOV) + '<br/>' +
          '<strong>Walk:</strong> ' + formatNumber(flow.ALLWALK) + '<br/>' +
          '<strong>Bike:</strong> ' + formatNumber(flow.ALLBIKE);

        layer.bindPopup(popupContent);

        layer.on('mouseover', function() {
          var v1 = getDirectionalValue(odData, o, d);
          var v2 = getDirectionalValue(odData, d, o);

          layer.bindTooltip(
            '<strong>' + prettyLabel(selectedAttribute) + '</strong><br/>' +
            p.oName + ' → ' + p.dName + ': ' + formatNumber(v1) + '<br/>' +
            p.dName + ' → ' + p.oName + ': ' + formatNumber(v2) + '<br/>' +
            '<strong>Total:</strong> ' + formatNumber(v1 + v2),
            { sticky: true }
          ).openTooltip();
        });
      }

      

      renderCountyOdTable(csv);
      updateStyle();

      if (countiesLayer.getBounds && countiesLayer.getBounds().isValid()) {
        map.fitBounds(countiesLayer.getBounds());
      } else if (countyLineLayer.getBounds && countyLineLayer.getBounds().isValid()) {
        map.fitBounds(countyLineLayer.getBounds());
      }

      setTimeout(function() {
        map.invalidateSize();
      }, 200);

      attributeSelect.on('change', function() {
        selectedAttribute = this.value;
        updateStyle();
      });

      $('#countyOdSlider').bootstrapSlider({
        formatter: function(value) {
          return 'Line thickness: ' + value;
        }
      }).on('slideStop', function(ev) {
        maxLineWidth = ev.value;
        updateStyle();
      });

      $('#countyOdBaseMap').on('change', function() {
        var value = this.value;

        if (currentTileLayer) {
          map.removeLayer(currentTileLayer);
        }

        if (value === 'carto') {
          currentTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
            subdomains: 'abcd',
            maxZoom: 20
          });
        }

          else if (value === 'osm') {
          currentTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 19,
            subdomains: ['a', 'b', 'c']
          });
        } else if (value === 'esri') {
          currentTileLayer = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
            {
              attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
              maxZoom: 16
            }
          );
        } 

        currentTileLayer.addTo(map);
      });

      buildPaletteSelector(updateStyle);
      updateStyle();

      $('a[href="#CountyOandD"]')
        .off('shown.bs.tab.countyod')
        .on('shown.bs.tab.countyod', function() {
          setTimeout(function() {
            map.invalidateSize();

            if (countiesLayer.getBounds && countiesLayer.getBounds().isValid()) {
              map.fitBounds(countiesLayer.getBounds());
            }

            updateStyle();
          }, 200);
        });
    }

  })();

})(d3, abmviz_utilities);