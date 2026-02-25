(function (d3, abmviz_utilities) {
  'use strict';
  var exports = {};

  function getMax(data, currentVar) {
    var max = -10000000;
    Object.keys(data).forEach(function(o) {
      Object.keys(data[o]).forEach(function(d) {
        // Fix max of bidirectional flows (safe access when reverse pair missing)
        var a = (data[o] && data[o][d] && data[o][d][currentVar]) || 0;
        var b = (data[d] && data[d][o] && data[d][o][currentVar]) || 0;
        max = Math.max(a + b, max);
      });
    });
    return max;
  }

  (function createOD() {
    var divID = 'od',
        containerID = 'odMap',
        maxLineWidthPixels = 10;

    // Create initial scales for lines on map (width and opacity)
    var w = d3.scaleLinear().range([0, maxLineWidthPixels]);
    var op = d3.scaleLinear().range([0, 1]);

    d3.queue()
      .defer(d3.csv, '../data/' + abmviz_utilities.GetURLParameter('scenario') + '/Desirelines.csv')
      .defer(d3.json, '../data/SuperDistricts.topojson')
      // try the plus‑210 desireline file first, fallback to original
      .defer(function(cb) {
        d3.json('../data/SuperDistrictsDesirelines_plus210.topojson', function(err,data) {
          if (err) {
            d3.json('../data/SuperDistrictsDesirelines.topojson', cb);
          } else {
            cb(null, data);
          }
        });
      })
      // fallback county geometry (contains standard county names such as Cherokee)
      .defer(d3.json, '../data/cb_2015_us_county_500k_GEORGIA.json')
      .await(function(err, csv, geo, desirelines, countiesGeo) {
        // If any of the files failed to load, abort early
        // (the old code removed the div but then kept running which
        // led to TypeErrors when `desirelines` was undefined).
        if (err) {
          console.log('Error loading data:', err);
          d3.select('#' + divID).remove();
          return;          // stop further execution
        }

        // Build object from csv
        var od = {};
        csv.forEach(function(row) {
          var o = +row.ORIG,
              d = +row.DEST;

          if (typeof od[o] === "undefined") {
            od[o] = {};
          }

          // Store if o != d b/c we are only plotting desirelines
          if (o !== d) {
            od[o][d] = {
              WRKSOV: +row.WRKSOV,
              WRKHOV: +row.WRKHOV,
              WRKTRN: +row.WRKTRN,
              NWKSOV: +row.NWKSOV,
              NWKHOV: +row.NWKHOV,
              NWKTRN: +row.NWKTRN,
              ALLSOV: +row.ALLSOV,
              ALLHOV: +row.ALLHOV,
              ALLTRN: +row.ALLTRN,
              WRKALL: +row.WRKALL,
              NWKALL: +row.NWKALL,
              ALLALL: +row.ALLALL
            };
          }
        });  // end csv.forEach()

        // Build superdistrict id to name lookup (handle different property names)
        var nameByID = {};
        // Determine which object key contains the polygons (some files use
        // 'superdistricts', others use 'transit')
        var superKey = (geo.objects && geo.objects.superdistricts) ? 'superdistricts' : (geo.objects ? Object.keys(geo.objects)[0] : null);
        var superGeometries = [];
        if (superKey && geo.objects[superKey] && geo.objects[superKey].geometries) {
          superGeometries = geo.objects[superKey].geometries;
          for(var i = 0; i < superGeometries.length; i += 1) {
            var prop = superGeometries[i].properties || {};
            var id = prop.id !== undefined ? prop.id : (prop.LOGRECNO || prop.GEOID || prop.OBJECTID);
            var name = prop.name !== undefined ? prop.name : prop.NAME;
            if (id !== undefined) nameByID[id] = name;
            if (typeof name !== 'undefined') nameByID[i + 1] = name;
          }
        }

        // If Dawson is missing from the superdistricts, try to find a county
        // geometry in the fallback `countiesGeo` that matches Dawson by
        // centroid proximity, then inject it so desirelines resolve.
        function centroidOfPolygon(coords) {
          // coords -> first ring expected: [[lon,lat],...]
          var ring = coords && coords[0] || [];
          var sx = 0, sy = 0, n = 0;
          for (var k = 0; k < ring.length; k++) {
            sx += ring[k][0]; sy += ring[k][1]; n += 1;
          }
          return n ? [sx / n, sy / n] : [0,0];
        }
        function findCountyGeometryByCentroid(countiesGeo, targetLon, targetLat) {
          if (!countiesGeo) return null;
          var geoms = countiesGeo.features ? countiesGeo.features.map(function(f){return f.geometry;}) : (countiesGeo.geometries || []);
          var best = null, bestDist = Infinity;
          for (var j = 0; j < geoms.length; j++) {
            var g = geoms[j];
            if (!g) continue;
            var coords = g.coordinates;
            if (!coords) continue;
            var c = centroidOfPolygon(coords);
            var dx = c[0] - targetLon, dy = c[1] - targetLat;
            var d2 = dx*dx + dy*dy;
            if (d2 < bestDist) { bestDist = d2; best = g; }
          }
          return best;
        }
        // Only attempt injection if Dawson is not present
        var hasDawson = Object.keys(nameByID).some(function(k){ return (''+nameByID[k]).toLowerCase().indexOf('dawson') !== -1; });
        if (!hasDawson && countiesGeo) {
          // approximate Dawson county centroid (lon, lat)
          var targetLon = -84.14, targetLat = 34.43;
          var countyGeom = findCountyGeometryByCentroid(countiesGeo, targetLon, targetLat);
          if (countyGeom) {
            // Create a feature-like object to be appended later to the features
            var dawsonFeature = { type: 'Feature', geometry: countyGeom, properties: { NAME: 'Dawson', LOGRECNO: 5874, GEOID: 'Dawson' } };
            // Remember to inject into the feature list before drawing
            // We'll attach it to a temporary variable `__injectedDawsonFeature`.
            geo.__injectedDawsonFeature = dawsonFeature;
            // Also expose a name mapping for the next sequential index
            nameByID[Object.keys(nameByID).length + 1] = 'Dawson';
          }
        }

        // Projection
        function projectPoint(lon, lat) {
            var point = map.latLngToLayerPoint(new L.LatLng(lat, lon))
            this.stream.point(point.x, point.y);
        }
        var transform = d3.geoTransform({point: projectPoint}),
            path = d3.geoPath().projection(transform);

        // Build a FeatureCollection for the superdistricts/transit object
        var superFeatureCollection = { type: 'FeatureCollection', features: [] };
        if (superKey && geo.objects[superKey]) {
          superFeatureCollection = topojson.feature(geo, geo.objects[superKey]);
          if (geo.__injectedDawsonFeature) {
            superFeatureCollection.features.push(geo.__injectedDawsonFeature);
          }
        }

        // Update the path using the current transform
        function updateTransform() {
          var bounds = path.bounds(superFeatureCollection),
              buffer = 250,
              topLeft = [bounds[0][0]-buffer,bounds[0][1]-buffer],
              bottomRight = [bounds[1][0]+buffer,bounds[1][1]+buffer];

          mapsvg.attr('width', bottomRight[0] - topLeft[0])
                .attr('height', bottomRight[1] - topLeft[1])
                .style('left', topLeft[0] + 'px')
                .style('top', topLeft[1] + 'px');

          g.attr('transform', 'translate(' + -topLeft[0] + ',' + -topLeft[1] + ')');

          d3.selectAll('.mappolygons').attr('d', path);
          d3.selectAll('.desirelines').attr('d', path);
        }

        // Create map
        var map = L.map(containerID).setView([33.792902, -84.349885], 9);
        L.tileLayer('http://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
          attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
          maxZoom: 16
        }).addTo(map);
        map.addControl(new L.Control.Fullscreen());

        var mapsvg = d3.select(map.getPanes().overlayPane).append('svg'),
            g = mapsvg.append('g');

        // Create tooltip
        var tooltip = d3.select('#odTooltip');

        // Add slider for max circle size
        var mySlider = $('#odSlider').bootstrapSlider();
        mySlider.on('slideStop', function(ev) {
            w.range([0, mySlider.bootstrapSlider('getValue')]);
            updateDesireLines();
        });

        // Draw background super districts
        g.selectAll('.mappolygons')
          .data(superFeatureCollection.features)
          .enter().append('path')
            .attr('class', 'mappolygons')
            .attr('stroke', 'lightgray')
            .attr('fill-opacity', 0.5)
            .attr('fill', '#fff')
            .style('pointer-events', 'visibleFill')
            .on('mouseover', function(d) {
              d3.select(this).style('cursor', 'pointer');
              tooltip.transition()
                .duration(200)
                .style('opacity', 1);
              var dispName = d.properties.name !== undefined ? d.properties.name : d.properties.NAME;
              tooltip.html(dispName);
            })
            .on('mousemove', function () {
              tooltip.style('top', (d3.event.pageY - 16) + 'px')
                .style('left', (d3.event.pageX) + 'px');
            })
            .on('mouseout', function(d) {
              d3.select(this).style('cursor', 'default');
              tooltip.transition()
                .duration(500)
                .style('opacity', 0);
            });

        // Draw background counties on top of super districts. Use counties in
        // the SuperDistricts topojson if present, otherwise fall back to the
        // standalone county GeoJSON which contains canonical county names like Cherokee.
        var countyFeatures = [];
        if (geo.objects && geo.objects.counties) {
          countyFeatures = topojson.feature(geo, geo.objects.counties).features;
        } else if (countiesGeo) {
          if (countiesGeo.features) {
            countyFeatures = countiesGeo.features;
          } else if (countiesGeo.type === 'GeometryCollection' && countiesGeo.geometries) {
            countyFeatures = countiesGeo.geometries.map(function(g) {
              return { type: 'Feature', geometry: g, properties: g.properties || {} };
            });
          }
        }
        g.selectAll('.mapcounties')
          .data(countyFeatures)
          .enter().append('path')
            .attr('fill', 'none')
            .attr('stroke', '#000')
            .attr('class', 'mappolygons mapcounties')
            .attr('d', path);

        // Draw desire lines w/ zero thickness.  The desired dataset
        // may be a TopoJSON (old workflow) or simply a GeoJSON
        // FeatureCollection (our new python export).  `topojson.feature`
        // expects a true topology with `objects`/`arcs`; if we pass it a
        // plain FeatureCollection it blows up with the type of error the
        // user reported.
        var desireFeatures = [];
        if (desirelines) {
          // case 1: plain GeoJSON FeatureCollection
          if (desirelines.type === 'FeatureCollection') {
              desireFeatures = desirelines.features;
          } else if (desirelines.objects && desirelines.objects.desirelines) {
              var obj = desirelines.objects.desirelines;
              // if the geometries look like simple GeoJSON (contain coordinates),
              // just wrap them as features without calling topojson.feature
              if (obj.type === 'GeometryCollection' && obj.geometries && obj.geometries.length > 0 && obj.geometries[0].coordinates) {
                  desireFeatures = obj.geometries.map(function(g) {
                      return { type: 'Feature', geometry: g, properties: g.properties || {} };
                  });
              } else {
                  // normal topojson conversion will throw if arcs missing
                  desireFeatures = topojson.feature(desirelines, obj).features;
              }
          } else {
              console.log('desirelines object has unexpected structure');
          }
        }

        g.selectAll('.desirelines')
          .data(desireFeatures)
          .enter().append('path')
            .attr('class', 'desirelines')
            .attr('stroke', '#3182bd')
            .attr('stroke-linecap', 'round')
            .style('stroke-width', '0')
            .style('pointer-events', 'visibleStroke')
            .on('mouseover', function(d) {
              d3.select(this).style('cursor', 'pointer');
              tooltip.transition()
                .duration(200)
                .style('opacity', 1);
              var o = d.properties.o, dest = d.properties.d;
              var v1 = (od[o] && od[o][dest] && od[o][dest][dataColumn]) || 0;
              var v2 = (od[dest] && od[dest][o] && od[dest][o][dataColumn]) || 0;
              tooltip.html(
                nameByID[o] + ' → ' + nameByID[dest] + ' ' + d3.format(',')(v1) + '<br/>' +
                nameByID[dest] + ' → ' + nameByID[o] + ' ' + d3.format(',')(v2)
              );
            })
            .on('mousemove', function () {
              tooltip.style('top', (d3.event.pageY - 16) + 'px')
                .style('left', (d3.event.pageX) + 'px');
            })
            .on('mouseout', function(d) {
              d3.select(this).style('cursor', 'default');
              tooltip.transition()
                .duration(500)
                .style('opacity', 0);
            });

        // Define function for transitioning line thickness to match data inputs
        var dataColumn;
        function updateDesireLines() {
          var tripType = d3.select('#odTripType').property('value'),
              mode = d3.select('#odMode').property('value');
          dataColumn = tripType.concat(mode).toUpperCase();

          // Find max in data and update line width and opacity scales
          var dataMax = getMax(od, dataColumn);
          w.domain([0, dataMax]);
          op.domain([0, dataMax]);

          d3.selectAll('.desirelines')
            .transition().duration(300)
            .style('stroke-width', function(d) {
              // Sum bidirectional (safe access)
              var o = d.properties.o, dest = d.properties.d;
              var a = (od[o] && od[o][dest] && od[o][dest][dataColumn]) || 0;
              var b = (od[dest] && od[dest][o] && od[dest][o][dataColumn]) || 0;
              return w(a + b);
            })
            .style('stroke-opacity', function(d) {
              // Sum bidirectional (safe access)
              var o = d.properties.o, dest = d.properties.d;
              var a = (od[o] && od[o][dest] && od[o][dest][dataColumn]) || 0;
              var b = (od[dest] && od[dest][o] && od[dest][o][dataColumn]) || 0;
              return op(a + b);
            });
        }
        updateDesireLines();

        // Redraw with change to dropdown menus or checkboxes
        d3.selectAll('.odInput').on('change', function() {
          updateDesireLines();
        });

        // Hide D3 while moving map
        map.on('viewreset', updateTransform);
        map.on('movestart', function() {
          mapsvg.classed('hidden', true);
        });
        map.on('rotate', function() {
          mapsvg.classed('hidden', true);
        });
        map.on('moveend', function() {
          updateTransform();
          mapsvg.classed('hidden', false);
        });

        updateTransform();
    }) // end d3.json()
  }()); // end createOD()

  // Return exports to global namespace (could be empty if nothing is needed
  // in the global namespace)
  return exports;

}(d3v4, abmviz_utilities));
