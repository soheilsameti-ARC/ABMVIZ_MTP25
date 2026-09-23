(function (d3, abmviz_utilities) {
  'use strict';

  (function createHexagon() {
    var divID = 'hexagon',
        containerID = 'hexagonMap';

    var opacity = 0.8;
    var selectedColorRampIndex = 0;
    var showBoundaries = true;
    var currentTileLayer;
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
        '#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6',
        '#4292c6', '#2171b5', '#08519c', '#08306b', '#041b33'
      ].reverse(),
      [
        '#ffffd9', '#edf8b1', '#c7e9b4', '#7fcdbb', '#41b6c4',
        '#1d91c0', '#225ea8', '#253494', '#081d58', '#081d58'
      ]
    ];

    var scenario = abmviz_utilities.GetURLParameter('scenario');
    var tripsCsvPath = '../data/' + scenario + '/HEX_TRIPS.csv';
    var topoJsonPath = '../data/HEX_GRID.topojson';

    function locateTripsField(row) {
      for (var key in row) {
        if (!row.hasOwnProperty(key)) {
          continue;
        }
        if (key.toUpperCase() !== 'GRID_ID') {
          return key;
        }
      }
      return null;
    }

    function getClassColor(value, breaks) {
      if (value === null || value === undefined) {
        return '#f0f0f0';
      }
      for (var i = 0; i < breaks.length - 1; i += 1) {
        if (value <= breaks[i + 1] || i === breaks.length - 2) {
          return palette[selectedColorRampIndex][i];
        }
      }
      return palette[selectedColorRampIndex][palette[selectedColorRampIndex].length - 1];
    }

    function formatNumber(num) {
      return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function updateLegend(breaks) {
      var legendDiv = d3.select('#hexagonLegend');
      legendDiv.html('');
      if (!breaks || breaks.length < 2) {
        legendDiv.text('No legend available');
        return;
      }

      var rectWidth = 110;
      var li = { h: 32, s: 5, r: 3 };
      var totalLegendWidth = (breaks.length - 1) * (rectWidth + li.s);
      var legend = legendDiv.append('svg').attr('width', totalLegendWidth).attr('height', li.h);

      var legendGroups = legend.selectAll('g').data(d3.range(breaks.length - 1)).enter().append('g')
        .attr('transform', function(d, i) {
          return 'translate(' + i * (rectWidth + li.s) + ',0)';
        });

      legendGroups.append('rect')
        .attr('rx', li.r)
        .attr('ry', li.r)
        .attr('width', rectWidth)
        .attr('height', li.h)
        .style('fill', function(d, i) {
          return palette[selectedColorRampIndex][i];
        });

      legendGroups.append('text')
        .attr('x', rectWidth / 2)
        .attr('y', li.h / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .style('fill', 'white')
        .style('font-size', '12px')
        .style('font-weight', 'bold')
        .text(function(d, i) {
          var low = Math.ceil(breaks[i] / 1000) * 1000;
          var high = Math.ceil(breaks[i + 1] / 1000) * 1000;
          return formatNumber(low) + ' - ' + formatNumber(high);
        });
    }

    function initMap(csv, geo) {
      if (!csv || !csv.length) {
        console.error('No hexagon trip records loaded');
        d3.select('#' + divID).remove();
        return;
      }

      if (!geo) {
        console.error('No hexagon geometry loaded');
        d3.select('#' + divID).remove();
        return;
      }

      var tripsField = locateTripsField(csv[0]);
      if (!tripsField) {
        console.error('No trips field found in CSV');
        d3.select('#' + divID).remove();
        return;
      }

      var hexData = {};
      csv.forEach(function(row) {
        var gridId = row.GRID_ID || row.Grid_ID || row.grid_id;
        var trips = Math.round(+row[tripsField] || 0);
        if (gridId) {
          hexData[gridId] = trips;
        }
      });

      var values = [];
      for (var key in hexData) {
        if (hexData.hasOwnProperty(key)) {
          values.push(hexData[key]);
        }
      }
      if (!values.length) {
        console.error('No trip values available after parsing CSV');
        d3.select('#' + divID).remove();
        return;
      }

      var serie = new geostats(values);
      var breaks = serie.getClassJenks(10);
      updateLegend(breaks);

      var map = L.map(containerID).setView([33.792902, -84.349885], 10);
      currentTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
        subdomains: ['a', 'b', 'c']
      }).addTo(map);
      map.addControl(new L.Control.Fullscreen());

      var topoObject = geo.objects.transit || geo.objects[Object.keys(geo.objects)[0]];
      var features = topojson.feature(geo, topoObject);

      var hexLayer = L.geoJSON(features, {
        style: function(feature) {
          var gridId = feature.properties.GRID_ID || feature.properties.Grid_ID || feature.properties.grid_id;
          var trips = hexData[gridId] || 0;
          return {
            fillColor: getClassColor(trips, breaks),
            weight: showBoundaries ? 1 : 0,
            opacity: 1,
            color: 'white',
            fillOpacity: opacity
          };
        },
        onEachFeature: function(feature, layer) {
          var gridId = feature.properties.GRID_ID || feature.properties.Grid_ID || feature.properties.grid_id;
          var trips = hexData[gridId] || 0;
          layer.bindTooltip('Grid: ' + (gridId || 'N/A') + '<br/>Trips: ' + trips.toFixed(0));
        }
      }).addTo(map);

      if (hexLayer.getBounds && hexLayer.getBounds().isValid()) {
        map.fitBounds(hexLayer.getBounds());
      }
      setTimeout(function() {
        map.invalidateSize();
      }, 200);

      function updateStyle() {
        hexLayer.setStyle(function(feature) {
          var gridId = feature.properties.GRID_ID || feature.properties.Grid_ID || feature.properties.grid_id;
          var trips = hexData[gridId] || 0;
          return {
            fillColor: getClassColor(trips, breaks),
            weight: showBoundaries ? 1 : 0,
            opacity: 1,
            color: 'white',
            fillOpacity: opacity
          };
        });
      }

      $('#hexagonOpacitySlider').bootstrapSlider({
        formatter: function(value) {
          return 'Opacity: ' + value;
        }
      }).on('slideStop', function(ev) {
        opacity = ev.value;
        updateStyle();
      });

      $('#hexagonBoundaries').on('change', function() {
        showBoundaries = this.checked;
        updateStyle();
      });

      $('#hexagonBaseMap').on('change', function() {
        var value = this.value;
        map.removeLayer(currentTileLayer);
        if (value === 'osm') {
          currentTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 19,
            subdomains: ['a', 'b', 'c']
          });
        } else if (value === 'esri') {
          currentTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
            maxZoom: 16
          });
        } else if (value === 'carto') {
          currentTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
          });
        }
        currentTileLayer.addTo(map);
      });

      var rampContainer = d3.select('#hexagonColorRamp');
      rampContainer.selectAll('*').remove();
      var rampClasses = ['Blues', 'Oranges', 'Greens', 'Reds', 'ReversedBlues', 'Teals'];
      palette.forEach(function(ramp, i) {
        var rampDiv = rampContainer.append('div')
          .attr('class', 'ramp ' + rampClasses[i] + (i === selectedColorRampIndex ? ' selected' : ''))
          .on('click', function() {
            d3.selectAll('#hexagonColorRamp .ramp').classed('selected', false);
            d3.select(this).classed('selected', true);
            selectedColorRampIndex = i;
            updateLegend(breaks);
            updateStyle();
          });

        var svg = rampDiv.append('svg').attr('width', 60).attr('height', 15);
        var colors = ramp.slice(0, 4); // first 4 colors
        colors.forEach(function(color, j) {
          svg.append('rect')
            .attr('fill', color)
            .attr('width', 15)
            .attr('height', 15)
            .attr('x', j * 15);
        });
      });
    }

    function loadData(callback) {
      if (d3.queue) {
        d3.queue()
          .defer(d3.csv, tripsCsvPath)
          .defer(d3.json, topoJsonPath)
          .await(callback);
      } else if (d3.csv && d3.json) {
        d3.csv(tripsCsvPath, function(err, csvData) {
          if (err) {
            callback(err);
            return;
          }
          d3.json(topoJsonPath, function(err2, topoData) {
            callback(err2, csvData, topoData);
          });
        });
      } else {
        callback(new Error('Unable to load data: d3 queue or loader unavailable'));
      }
    }

    loadData(function(err, csv, geo) {
      if (err) {
        console.error('Error loading hexagon data:', err);
        d3.select('#' + divID).remove();
        return;
      }
      initMap(csv, geo);
    });
  })();

})(d3, abmviz_utilities);