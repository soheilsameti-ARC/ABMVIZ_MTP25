//encapsulate all code within a IIFE (Immediately-invoked-function-expression) to avoid polluting global namespace
var overview = (function (d3, abmviz_utilities) {
  'use strict';

  // Fixed, chronological horizon-year order. 2050NB is an alternate "No-Build"
  // scenario for the same 2050 horizon year, not a later year.
  var scenarioOrder = ['MTP24_2020', 'MTP24_2030', 'MTP24_2033', 'MTP24_2040', 'MTP24_2050', 'MTP24_2050NB'];

  // Fixed stacking/legend order, mapped to fixed categorical hue slots (never re-ordered by value).
  // AUTO includes TNC (ride-hail) trips - tripdata.trip_mode_name has no
  // separate auto/non-auto split for TNC, and it is a car trip.
  var modeGroups = ['AUTO', 'TRANSIT', 'NONMOTORIZED', 'SCHOOL_BUS'];
  var modeLabels = {
    AUTO: 'Auto',
    TRANSIT: 'Transit',
    NONMOTORIZED: 'Walk/Bike',
    SCHOOL_BUS: 'School Bus'
  };
  var modeColorVars = {
    AUTO: '--ov-auto',
    TRANSIT: '--ov-transit',
    NONMOTORIZED: '--ov-nonmotor',
    SCHOOL_BUS: '--ov-schoolbus'
  };

  // Categorical hue per horizon year (kept distinguishable when overlaid).
  // 2050NB reuses 2050's color (same horizon year) but is drawn dashed since
  // it is an alternate scenario, not a further step in the sequence.
  var yearColorVars = {
    MTP24_2020: '--ov-year-1',
    MTP24_2030: '--ov-year-2',
    MTP24_2033: '--ov-year-3',
    MTP24_2040: '--ov-year-4',
    MTP24_2050: '--ov-year-5',
    MTP24_2050NB: '--ov-year-5'
  };
  var dashedScenarios = { MTP24_2050NB: true };

  var rootSelector = '#overview-root';
  var chartSelector = '#overview-chart';
  var tooltipSelector = '#overview-tooltip';
  var hourlyChartSelector = '#overview-hourly-chart';
  var hourlyTooltipSelector = '#overview-hourly-tooltip';
  var hourlyLegendSelector = '#overview-hourly-legend';
  var hourlyTableScenarioSelectSelector = '#overview-hourly-table-scenario';
  var hourlyTableToggleSelector = '#overview-hourly-table-toggle-input';
  var hourlyTableContainerSelector = '#overview-hourly-table-container';

  var periodChartSelector = '#overview-period-chart';
  var periodTooltipSelector = '#overview-period-tooltip';
  var periodLegendSelector = '#overview-period-legend';

  var vehicleChartSelector = '#overview-vehicle-chart';
  var vehicleTooltipSelector = '#overview-vehicle-tooltip';
  var vehicleLegendSelector = '#overview-vehicle-legend';
  var vehicleTableScenarioSelectSelector = '#overview-vehicle-table-scenario';
  var vehicleTableToggleSelector = '#overview-vehicle-table-toggle-input';
  var vehicleTableContainerSelector = '#overview-vehicle-table-container';

  var chartWidth = 960;
  var chartHeight = 300;
  var margin = { top: 30, right: 24, bottom: 40, left: 56 };
  var markerRadius = 4;
  var periodCount = 48;

  function shortAxisLabel(scenario) {
    var labels = {
      MTP24_2020: '2020',
      MTP24_2030: '2030',
      MTP24_2033: '2033',
      MTP24_2040: '2040',
      MTP24_2050: '2050',
      MTP24_2050NB: '2050 No-Build'
    };
    return labels[scenario] || scenario;
  }

  function cleanHeader(header, scenario) {
    if (!header) return shortAxisLabel(scenario);
    return header.replace(/_/g, ' ');
  }

  function compactNumber(n) {
    var abs = Math.abs(n);
    if (abs >= 1e6) return trimZero((n / 1e6).toFixed(1)) + 'M';
    if (abs >= 1e3) return trimZero((n / 1e3).toFixed(1)) + 'K';
    return abmviz_utilities.numberWithCommas(Math.round(n));
  }

  function trimZero(s) {
    return s.replace(/\.0$/, '');
  }

  function colorVar(varName) {
    var style = getComputedStyle(document.querySelector(rootSelector));
    return style.getPropertyValue(varName).trim();
  }

  // Trip departures by half-hour period, exported from the ABM trip list
  // (tripdata.depart_period in each abm_* Postgres schema) via
  // data/<scenario>/TripsByPeriod.csv - one row per period, already zero-filled
  // for periods with no departures.
  function aggregateHourly(rows) {
    var byPeriod = {};
    for (var p = 1; p <= periodCount; p += 1) {
      byPeriod[p] = 0;
    }
    rows.forEach(function (row) {
      var period = +row.period;
      if (byPeriod.hasOwnProperty(period)) {
        byPeriod[period] += (+row.trips || 0);
      }
    });
    var periods = [];
    for (var p2 = 1; p2 <= periodCount; p2 += 1) {
      periods.push({
        period: p2,
        timeLabel: abmviz_utilities.halfHourTimePeriodToTimeString(p2),
        quantity: byPeriod[p2]
      });
    }
    return periods;
  }

  // Standard travel-model time periods, in half-hour period ranges (period 1 =
  // 3:00am). These windows are different lengths (Midday is 6 hours, PM Peak
  // is 4), so comparing raw period totals lets the longer window win even when
  // a shorter window is more intense. Divide by duration to compare average
  // trips/hour instead - that also matches what "peak period" means in
  // traffic engineering (highest rate, not the most accumulated volume).
  var periodDefs = [
    { key: 'EA', label: 'Early AM', range: [1, 6], hours: 3 },
    { key: 'AM', label: 'AM Peak', range: [7, 12], hours: 3 },
    { key: 'MD', label: 'Midday', range: [13, 24], hours: 6 },
    { key: 'PM', label: 'PM Peak', range: [25, 32], hours: 4 },
    { key: 'EV', label: 'Evening', range: [33, 48], hours: 8 }
  ];

  function aggregateToFivePeriods(periods) {
    return periodDefs.map(function (def) {
      var quantity = 0;
      for (var p = def.range[0]; p <= def.range[1]; p += 1) {
        var point = periods[p - 1];
        quantity += point ? point.quantity : 0;
      }
      return { key: def.key, label: def.label, hours: def.hours, quantity: quantity, rate: quantity / def.hours };
    });
  }

  function periodTimeRangeLabel(def) {
    var start = abmviz_utilities.halfHourTimePeriodToTimeString(def.range[0]);
    var end = abmviz_utilities.halfHourTimePeriodToTimeString(def.range[1] + 1);
    return start + ' - ' + end;
  }

  var hourCount = 24;

  // Trips by mode for each clock hour, exported from the ABM trip list via
  // data/<scenario>/TripsByHourMode.csv (hour_bucket = ceil(depart_period/2),
  // so hour 1 = 3:00am-4:00am same day convention as the half-hour chart).
  function aggregateHourlyByMode(rows) {
    var byHour = {};
    for (var h = 1; h <= hourCount; h += 1) {
      byHour[h] = { AUTO: 0, TRANSIT: 0, NONMOTORIZED: 0, SCHOOL_BUS: 0, total: 0 };
    }
    rows.forEach(function (row) {
      var hour = +row.hour_bucket;
      if (!byHour.hasOwnProperty(hour)) return;
      byHour[hour].AUTO += (+row.auto || 0);
      byHour[hour].TRANSIT += (+row.transit || 0);
      byHour[hour].NONMOTORIZED += (+row.nonmotorized || 0);
      byHour[hour].SCHOOL_BUS += (+row.school_bus || 0);
      byHour[hour].total += (+row.total || 0);
    });
    var hours = [];
    for (var h2 = 1; h2 <= hourCount; h2 += 1) {
      var startPeriod = (h2 - 1) * 2 + 1;
      hours.push({
        hour: h2,
        timeLabel: abmviz_utilities.halfHourTimePeriodToTimeString(startPeriod),
        totals: byHour[h2],
        total: byHour[h2].total
      });
    }
    // hours[] is built in the model's day convention (starts 3am). Rotate so
    // display order starts at 1am instead: hour_bucket 23 ("1 am") and 24
    // ("2 am") move to the front, followed by 1 through 22 (3am...12am).
    return hours.slice(22).concat(hours.slice(0, 22));
  }

  // Derives 24 hourly vehicle-trip totals from the same 48 half-hour points the
  // chart uses (summing each pair of periods), instead of a second DB query.
  function aggregateVehicleHourly(periods) {
    var hours = [];
    for (var h = 1; h <= hourCount; h += 1) {
      var p1 = periods[(h - 1) * 2];
      var p2 = periods[(h - 1) * 2 + 1];
      var startPeriod = (h - 1) * 2 + 1;
      hours.push({
        hour: h,
        timeLabel: abmviz_utilities.halfHourTimePeriodToTimeString(startPeriod),
        total: (p1 ? p1.quantity : 0) + (p2 ? p2.quantity : 0)
      });
    }
    return hours.slice(22).concat(hours.slice(0, 22));
  }

  function loadAll(callback) {
    d3.csv('data/scenarios.csv', function (err, scenarios) {
      if (err || !scenarios) {
        console.error('overview: failed to load scenarios.csv', err);
        return;
      }

      var headerByScenario = {};
      scenarios.forEach(function (row) {
        headerByScenario[row.Scenario] = row.Header;
      });

      var order = scenarioOrder.filter(function (s) {
        return scenarios.some(function (row) { return row.Scenario === s; });
      });

      var loaders = order.map(function (scenario) {
        return new Promise(function (resolve) {
          d3.csv('data/' + scenario + '/TripModeTotals.csv', function (errModes, modeRows) {
            if (errModes || !modeRows) {
              console.warn('overview: failed to load TripModeTotals.csv for', scenario, errModes);
            }
            d3.csv('data/' + scenario + '/TripsByPeriod.csv', function (errPeriod, periodRows) {
              if (errPeriod || !periodRows) {
                console.warn('overview: failed to load TripsByPeriod.csv for', scenario, errPeriod);
              }
              d3.csv('data/' + scenario + '/TripsByHourMode.csv', function (errHourMode, hourModeRows) {
                if (errHourMode || !hourModeRows) {
                  console.warn('overview: failed to load TripsByHourMode.csv for', scenario, errHourMode);
                }
                d3.csv('data/' + scenario + '/AutoVehicleTripsByPeriod.csv', function (errVehicle, vehicleRows) {
                  if (errVehicle || !vehicleRows) {
                    console.warn('overview: failed to load AutoVehicleTripsByPeriod.csv for', scenario, errVehicle);
                  }
                  resolve({
                    scenario: scenario,
                    modeRows: (!errModes && modeRows) ? modeRows : [],
                    periodRows: (!errPeriod && periodRows) ? periodRows : [],
                    hourModeRows: (!errHourMode && hourModeRows) ? hourModeRows : [],
                    vehicleRows: (!errVehicle && vehicleRows) ? vehicleRows : []
                  });
                });
              });
            });
          });
        });
      });

      Promise.all(loaders).then(function (results) {
        var data = results.map(function (r) {
          var totals = { AUTO: 0, TRANSIT: 0, NONMOTORIZED: 0, SCHOOL_BUS: 0 };
          r.modeRows.forEach(function (row) {
            var group = row.mode_group;
            var qty = +row.trips || 0;
            if (totals.hasOwnProperty(group)) {
              totals[group] += qty;
            }
          });
          var total = modeGroups.reduce(function (sum, g) { return sum + totals[g]; }, 0);
          return {
            scenario: r.scenario,
            header: cleanHeader(headerByScenario[r.scenario], r.scenario),
            axisLabel: shortAxisLabel(r.scenario),
            totals: totals,
            total: total
          };
        });

        var hourlyByScenario = {};
        var hourModeByScenario = {};
        var vehicleByScenario = {};
        results.forEach(function (r) {
          hourlyByScenario[r.scenario] = aggregateHourly(r.periodRows);
          hourModeByScenario[r.scenario] = aggregateHourlyByMode(r.hourModeRows);
          vehicleByScenario[r.scenario] = aggregateHourly(r.vehicleRows);
        });

        callback(data, hourlyByScenario, hourModeByScenario, vehicleByScenario);
      });
    });
  }

  function renderKpis(data) {
    var container = d3.select('#overview-kpis');
    container.selectAll('*').remove();

    var baseline = data.length ? data[0].total : 0;

    var tile = container.selectAll('.overview-kpi-col')
      .data(data)
      .enter()
      .append('div')
      .attr('class', 'col-xs-6 col-sm-2 overview-kpi-col');

    var box = tile.append('div').attr('class', 'overview-kpi-tile');

    box.append('div').attr('class', 'overview-kpi-label').text(function (d) { return d.header; });
    box.append('div').attr('class', 'overview-kpi-value').text(function (d) { return compactNumber(d.total); });
    box.append('div').attr('class', 'overview-kpi-delta').text(function (d, i) {
      if (i === 0) return 'Baseline';
      var pct = baseline ? ((d.total - baseline) / baseline) * 100 : 0;
      var sign = pct >= 0 ? '+' : '';
      return sign + pct.toFixed(1) + '% vs 2020';
    });
  }

  function renderChart(data) {
    var svg = d3.select(chartSelector);
    svg.selectAll('*').remove();
    svg.attr('viewBox', '0 0 ' + chartWidth + ' ' + chartHeight)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    var innerWidth = chartWidth - margin.left - margin.right;
    var innerHeight = chartHeight - margin.top - margin.bottom;

    var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    var x = d3.scaleBand()
      .domain(data.map(function (d) { return d.scenario; }))
      .range([0, innerWidth])
      .paddingInner(0.35)
      .paddingOuter(0.08);

    var xCenter = function (d) { return x(d.scenario) + x.bandwidth() / 2; };

    var maxTotal = d3.max(data, function (d) { return d.total; }) || 1;

    var y = d3.scaleLinear()
      .domain([0, maxTotal * 1.12])
      .range([innerHeight, 0])
      .nice();

    var yTicks = y.ticks(5);

    // Gridlines (behind bars)
    g.selectAll('.ov-gridline')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('class', 'ov-gridline')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', function (d) { return y(d); })
      .attr('y2', function (d) { return y(d); });

    // Y axis labels
    g.selectAll('.ov-axis-label')
      .data(yTicks)
      .enter()
      .append('text')
      .attr('class', 'ov-axis-label')
      .attr('x', -10)
      .attr('y', function (d) { return y(d); })
      .attr('dy', '0.32em')
      .attr('text-anchor', 'end')
      .text(function (d) { return compactNumber(d); });

    // Baseline (x axis)
    g.append('line')
      .attr('class', 'ov-baseline')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', innerHeight)
      .attr('y2', innerHeight);

    // Category labels
    g.selectAll('.ov-category-label')
      .data(data)
      .enter()
      .append('text')
      .attr('class', 'ov-category-label')
      .attr('x', function (d) { return x(d.scenario) + x.bandwidth() / 2; })
      .attr('y', innerHeight + 20)
      .attr('text-anchor', 'middle')
      .text(function (d) { return d.axisLabel; });

    // 2050 No-Build is an alternate scenario for the same horizon year, not a
    // later year - flag the branch instead of letting the curve imply a trend.
    var noBuildIndex = data.map(function (d) { return d.scenario; }).indexOf('MTP24_2050NB');
    if (noBuildIndex > 0) {
      var dividerX = (xCenter(data[noBuildIndex - 1]) + xCenter(data[noBuildIndex])) / 2;
      g.append('line')
        .attr('class', 'ov-branch-divider')
        .attr('x1', dividerX)
        .attr('x2', dividerX)
        .attr('y1', 0)
        .attr('y2', innerHeight);
      g.append('text')
        .attr('class', 'ov-branch-label')
        .attr('x', dividerX)
        .attr('y', -18)
        .attr('text-anchor', 'middle')
        .text('alt. scenario, not a later year');
    }

    // Single aggregate curve: total trips across all modes. Per-mode composition
    // stays available via the hover tooltip and the data table below.
    var lineGen = d3.line()
      .x(function (d, i) { return xCenter(data[i]); })
      .y(function (d) { return y(d.total); })
      .curve(d3.curveMonotoneX);

    var areaGen = d3.area()
      .x(function (d, i) { return xCenter(data[i]); })
      .y0(innerHeight)
      .y1(function (d) { return y(d.total); })
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', colorVar('--ov-total'))
      .attr('fill-opacity', 0.12)
      .attr('d', areaGen);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', colorVar('--ov-total'))
      .attr('stroke-width', 2)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round')
      .attr('d', lineGen);

    g.selectAll(null)
      .data(data)
      .enter()
      .append('circle')
      .attr('class', 'ov-marker')
      .attr('cx', xCenter)
      .attr('cy', function (d) { return y(d.total); })
      .attr('r', markerRadius)
      .attr('fill', colorVar('--ov-total'))
      .attr('stroke', colorVar('--ov-surface'))
      .attr('stroke-width', 2);

    data.forEach(function (d) {
      // Total value label above the topmost curve point.
      if (d.total > 0) {
        g.append('text')
          .attr('class', 'ov-total-label')
          .attr('x', xCenter(d))
          .attr('y', y(d.total) - 12)
          .text(compactNumber(d.total));
      }

      // Hover hit target spans the full category band and chart height.
      var hit = g.append('rect')
        .attr('class', 'ov-hit-target')
        .attr('x', x(d.scenario))
        .attr('y', 0)
        .attr('width', x.bandwidth())
        .attr('height', innerHeight)
        .attr('tabindex', 0);

      hit.on('pointerenter pointermove focus', function () {
        d3.select(this).classed('hovered', true);
        showTooltip(d, d3.event);
      });

      hit.on('pointerleave blur', function () {
        d3.select(this).classed('hovered', false);
        hideTooltip();
      });
    });
  }

  function positionTooltip(tooltip, evt) {
    var containerNode = document.querySelector(rootSelector);
    var containerRect = containerNode.getBoundingClientRect();
    var left = (evt ? evt.clientX : 0) - containerRect.left + 16;
    var top = (evt ? evt.clientY : 0) - containerRect.top + 16;

    tooltip
      .style('left', left + 'px')
      .style('top', top + 'px')
      .style('opacity', 1);
  }

  function showTooltip(d, evt) {
    var tooltip = d3.select(tooltipSelector);
    tooltip.selectAll('*').remove();

    tooltip.append('div').attr('class', 'ov-tooltip-title').text(d.header);

    modeGroups.forEach(function (modeKey) {
      var row = tooltip.append('div').attr('class', 'ov-tooltip-row');
      row.append('span')
        .attr('class', 'ov-tooltip-key')
        .style('background-color', colorVar(modeColorVars[modeKey]));
      row.append('span').attr('class', 'ov-tooltip-value').text(abmviz_utilities.numberWithCommas(Math.round(d.totals[modeKey])));
      row.append('span').attr('class', 'ov-tooltip-label').text(modeLabels[modeKey]);
    });

    var totalRow = tooltip.append('div').attr('class', 'ov-tooltip-total');
    totalRow.text('Total: ' + abmviz_utilities.numberWithCommas(Math.round(d.total)));

    positionTooltip(tooltip, evt);
  }

  function hideTooltip() {
    d3.select(tooltipSelector).style('opacity', 0);
  }

  function showLineTooltip(p, data, hourlyByScenario, evt, tooltipSel) {
    var tooltip = d3.select(tooltipSel);
    tooltip.selectAll('*').remove();

    tooltip.append('div').attr('class', 'ov-tooltip-title').text(p.timeLabel);

    data.forEach(function (d) {
      var periods = hourlyByScenario[d.scenario] || [];
      var point = periods[p.period - 1];
      var qty = point ? point.quantity : 0;

      var row = tooltip.append('div').attr('class', 'ov-tooltip-row');
      row.append('span')
        .attr('class', 'ov-tooltip-key')
        .style('background-color', colorVar(yearColorVars[d.scenario] || '--ov-total'));
      row.append('span').attr('class', 'ov-tooltip-value').text(abmviz_utilities.numberWithCommas(Math.round(qty)));
      row.append('span').attr('class', 'ov-tooltip-label').text(d.axisLabel);
    });

    positionTooltip(tooltip, evt);
  }

  function hideLineTooltip(tooltipSel) {
    d3.select(tooltipSel).style('opacity', 0);
  }

  function showPeriodTooltip(periodDef, data, fiveByScenario, evt, tooltipSel) {
    var tooltip = d3.select(tooltipSel);
    tooltip.selectAll('*').remove();

    tooltip.append('div').attr('class', 'ov-tooltip-title').text(periodDef.label);

    data.forEach(function (d) {
      var buckets = fiveByScenario[d.scenario] || [];
      var bucket = buckets.filter(function (b) { return b.key === periodDef.key; })[0];
      var rate = bucket ? bucket.rate : 0;

      var row = tooltip.append('div').attr('class', 'ov-tooltip-row');
      row.append('span')
        .attr('class', 'ov-tooltip-key')
        .style('background-color', colorVar(yearColorVars[d.scenario] || '--ov-total'));
      row.append('span').attr('class', 'ov-tooltip-value').text(abmviz_utilities.numberWithCommas(Math.round(rate)) + '/hr');
      row.append('span').attr('class', 'ov-tooltip-label').text(d.axisLabel);
    });

    positionTooltip(tooltip, evt);
  }

  function renderTable(data) {
    var tbody = d3.select('#overview-table tbody');
    tbody.selectAll('*').remove();

    var rows = tbody.selectAll('tr')
      .data(data)
      .enter()
      .append('tr');

    rows.append('td').text(function (d) { return d.header; });
    modeGroups.forEach(function (modeKey) {
      rows.append('td')
        .attr('class', 'ov-num')
        .text(function (d) { return abmviz_utilities.numberWithCommas(Math.round(d.totals[modeKey])); });
    });
    rows.append('td')
      .attr('class', 'ov-num')
      .style('font-weight', '600')
      .text(function (d) { return abmviz_utilities.numberWithCommas(Math.round(d.total)); });

    d3.select('#overview-table-toggle-input').on('change', function () {
      d3.select('#overview-table-container').classed('hidden-table', !this.checked);
    });
  }

  function renderLineLegend(data, seriesLines, legendSel) {
    var legend = d3.select(legendSel);
    legend.selectAll('*').remove();

    var items = legend.selectAll('.overview-legend-item')
      .data(data)
      .enter()
      .append('div')
      .attr('class', 'overview-legend-item');

    items.each(function (d) {
      var item = d3.select(this);
      var color = colorVar(yearColorVars[d.scenario] || '--ov-total');
      var dashed = !!dashedScenarios[d.scenario];

      var key = item.append('svg').attr('width', 20).attr('height', 10);
      var line = key.append('line')
        .attr('x1', 0)
        .attr('x2', 20)
        .attr('y1', 5)
        .attr('y2', 5)
        .attr('stroke', color)
        .attr('stroke-width', 2.5)
        .attr('stroke-linecap', 'round');

      if (dashed) {
        line.attr('stroke-dasharray', '4 3');
      }

      item.append('span').text(d.axisLabel);

      item.on('click', function () {
        var lineAndMarkers = seriesLines[d.scenario];
        var nowHidden = !lineAndMarkers.classed('ov-line-hidden');
        lineAndMarkers.classed('ov-line-hidden', nowHidden);
        item.classed('dimmed', nowHidden);
      });
    });
  }

  function updateHoverMarkers(hoverMarkers, data, hourlyByScenario, p, xCenter, y) {
    hoverMarkers.selectAll('*').remove();
    data.forEach(function (d) {
      var periods = hourlyByScenario[d.scenario] || [];
      var point = periods[p.period - 1];
      if (!point) return;

      hoverMarkers.append('circle')
        .attr('cx', xCenter(p.period))
        .attr('cy', y(point.quantity))
        .attr('r', 3.5)
        .attr('fill', colorVar(yearColorVars[d.scenario] || '--ov-total'))
        .attr('stroke', colorVar('--ov-surface'))
        .attr('stroke-width', 1.5);
    });
  }

  function renderMultiYearLineChart(hourlyByScenario, data, opts) {
    var svg = d3.select(opts.chartSel);
    svg.selectAll('*').remove();
    svg.attr('viewBox', '0 0 ' + chartWidth + ' ' + chartHeight)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    var innerWidth = chartWidth - margin.left - margin.right;
    var innerHeight = chartHeight - margin.top - margin.bottom;

    var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    var periodTemplate = [];
    for (var pIdx = 1; pIdx <= periodCount; pIdx += 1) {
      periodTemplate.push({ period: pIdx, timeLabel: abmviz_utilities.halfHourTimePeriodToTimeString(pIdx) });
    }

    var x = d3.scaleBand()
      .domain(periodTemplate.map(function (p) { return p.period; }))
      .range([0, innerWidth])
      .paddingInner(0)
      .paddingOuter(0.02);

    var xCenter = function (period) { return x(period) + x.bandwidth() / 2; };

    var maxQty = d3.max(data, function (d) {
      return d3.max(hourlyByScenario[d.scenario] || [], function (p) { return p.quantity; });
    }) || 1;

    var y = d3.scaleLinear()
      .domain([0, maxQty * 1.18])
      .range([innerHeight, 0])
      .nice();

    var yTicks = y.ticks(5);

    g.selectAll('.ov-gridline')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('class', 'ov-gridline')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', function (d) { return y(d); })
      .attr('y2', function (d) { return y(d); });

    g.selectAll('.ov-axis-label')
      .data(yTicks)
      .enter()
      .append('text')
      .attr('class', 'ov-axis-label')
      .attr('x', -10)
      .attr('y', function (d) { return y(d); })
      .attr('dy', '0.32em')
      .attr('text-anchor', 'end')
      .text(function (d) { return compactNumber(d); });

    g.append('line')
      .attr('class', 'ov-baseline')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', innerHeight)
      .attr('y2', innerHeight);

    // Tick label every 2 hours (every 4th half-hour period) to avoid clutter.
    var tickPeriods = periodTemplate.filter(function (p) { return (p.period - 1) % 4 === 0; });
    g.selectAll('.ov-hour-label')
      .data(tickPeriods)
      .enter()
      .append('text')
      .attr('class', 'ov-category-label')
      .attr('x', function (p) { return xCenter(p.period); })
      .attr('y', innerHeight + 20)
      .attr('text-anchor', 'middle')
      .text(function (p) { return p.timeLabel; });

    var lineGen = d3.line()
      .x(function (p) { return xCenter(p.period); })
      .y(function (p) { return y(p.quantity); })
      .curve(d3.curveMonotoneX);

    // One line per horizon year - no area wash and no per-point markers, since
    // 6 overlaid fills/dots would just muddy the comparison. See
    // dataviz-stacked-multiline-misleading: identity across series belongs to
    // line position/color here, not to stacking.
    var seriesPaths = {};

    data.forEach(function (d) {
      var periods = hourlyByScenario[d.scenario] || [];
      var color = colorVar(yearColorVars[d.scenario] || '--ov-total');
      var dashed = !!dashedScenarios[d.scenario];

      var path = g.append('path')
        .datum(periods)
        .attr('class', 'ov-year-line')
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 2)
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round')
        .attr('d', lineGen);

      if (dashed) {
        path.attr('stroke-dasharray', '6 4');
      }

      seriesPaths[d.scenario] = path;
    });

    // Label only the single global peak across all years - never one per point.
    var globalPeak = null;
    data.forEach(function (d) {
      (hourlyByScenario[d.scenario] || []).forEach(function (p) {
        if (!globalPeak || p.quantity > globalPeak.quantity) {
          globalPeak = { period: p.period, timeLabel: p.timeLabel, quantity: p.quantity, scenario: d.scenario };
        }
      });
    });

    if (globalPeak) {
      g.append('text')
        .attr('class', 'ov-total-label')
        .attr('x', xCenter(globalPeak.period))
        .attr('y', y(globalPeak.quantity) - 12)
        .text('Peak ' + globalPeak.timeLabel + ' (' + shortAxisLabel(globalPeak.scenario) + '): ' + compactNumber(globalPeak.quantity));
    }

    var hoverMarkers = g.append('g').attr('class', 'ov-hover-markers');

    // Hover hit target per half-hour period, shared across all series.
    periodTemplate.forEach(function (p) {
      var hit = g.append('rect')
        .attr('class', 'ov-hit-target')
        .attr('x', x(p.period))
        .attr('y', 0)
        .attr('width', x.bandwidth())
        .attr('height', innerHeight)
        .attr('tabindex', 0);

      hit.on('pointerenter pointermove focus', function () {
        d3.select(this).classed('hovered', true);
        updateHoverMarkers(hoverMarkers, data, hourlyByScenario, p, xCenter, y);
        showLineTooltip(p, data, hourlyByScenario, d3.event, opts.tooltipSel);
      });

      hit.on('pointerleave blur', function () {
        d3.select(this).classed('hovered', false);
        hoverMarkers.selectAll('*').remove();
        hideLineTooltip(opts.tooltipSel);
      });
    });

    renderLineLegend(data, seriesPaths, opts.legendSel);
  }

  function renderPeriodChart(hourlyByScenario, data, opts) {
    var svg = d3.select(opts.chartSel);
    svg.selectAll('*').remove();
    svg.attr('viewBox', '0 0 ' + chartWidth + ' ' + chartHeight)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    var innerWidth = chartWidth - margin.left - margin.right;
    var innerHeight = chartHeight - margin.top - margin.bottom;

    var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    var fiveByScenario = {};
    data.forEach(function (d) {
      fiveByScenario[d.scenario] = aggregateToFivePeriods(hourlyByScenario[d.scenario] || []);
    });

    var x = d3.scaleBand()
      .domain(periodDefs.map(function (def) { return def.key; }))
      .range([0, innerWidth])
      .paddingInner(0.35)
      .paddingOuter(0.12);

    var xCenter = function (key) { return x(key) + x.bandwidth() / 2; };

    var maxRate = d3.max(data, function (d) {
      return d3.max(fiveByScenario[d.scenario], function (b) { return b.rate; });
    }) || 1;

    var y = d3.scaleLinear()
      .domain([0, maxRate * 1.18])
      .range([innerHeight, 0])
      .nice();

    var yTicks = y.ticks(5);

    g.selectAll('.ov-gridline')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('class', 'ov-gridline')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', function (d) { return y(d); })
      .attr('y2', function (d) { return y(d); });

    g.selectAll('.ov-axis-label')
      .data(yTicks)
      .enter()
      .append('text')
      .attr('class', 'ov-axis-label')
      .attr('x', -10)
      .attr('y', function (d) { return y(d); })
      .attr('dy', '0.32em')
      .attr('text-anchor', 'end')
      .text(function (d) { return compactNumber(d) + '/hr'; });

    g.append('line')
      .attr('class', 'ov-baseline')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', innerHeight)
      .attr('y2', innerHeight);

    // Period name, with its clock-time range underneath in muted ink.
    g.selectAll('.ov-period-label')
      .data(periodDefs)
      .enter()
      .append('text')
      .attr('class', 'ov-category-label')
      .attr('x', function (def) { return xCenter(def.key); })
      .attr('y', innerHeight + 20)
      .attr('text-anchor', 'middle')
      .text(function (def) { return def.label; });

    g.selectAll('.ov-period-range-label')
      .data(periodDefs)
      .enter()
      .append('text')
      .attr('class', 'ov-axis-label')
      .attr('x', function (def) { return xCenter(def.key); })
      .attr('y', innerHeight + 34)
      .attr('text-anchor', 'middle')
      .text(function (def) { return periodTimeRangeLabel(def); });

    // One curved line per horizon year, five points (Early AM..Evening). See
    // dataviz-stacked-multiline-misleading: identity across series belongs to
    // line position/color here, not to stacking.
    var lineGen = d3.line()
      .x(function (b) { return xCenter(b.key); })
      .y(function (b) { return y(b.rate); })
      .curve(d3.curveMonotoneX);

    var seriesLines = {};

    data.forEach(function (d) {
      var buckets = fiveByScenario[d.scenario];
      var color = colorVar(yearColorVars[d.scenario] || '--ov-total');
      var dashed = !!dashedScenarios[d.scenario];
      var seriesGroup = g.append('g').attr('class', 'ov-year-line');

      var path = seriesGroup.append('path')
        .datum(buckets)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 2)
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round')
        .attr('d', lineGen);

      if (dashed) {
        path.attr('stroke-dasharray', '6 4');
      }

      seriesGroup.selectAll('circle')
        .data(buckets)
        .enter()
        .append('circle')
        .attr('class', 'ov-marker')
        .attr('cx', function (b) { return xCenter(b.key); })
        .attr('cy', function (b) { return y(b.rate); })
        .attr('r', markerRadius)
        .attr('fill', color)
        .attr('stroke', colorVar('--ov-surface'))
        .attr('stroke-width', 2);

      seriesLines[d.scenario] = seriesGroup;
    });

    // Label only the single global peak across all years - never one per point.
    var globalPeak = null;
    data.forEach(function (d) {
      fiveByScenario[d.scenario].forEach(function (b) {
        if (!globalPeak || b.rate > globalPeak.rate) {
          globalPeak = { key: b.key, label: b.label, rate: b.rate, scenario: d.scenario };
        }
      });
    });

    if (globalPeak) {
      g.append('text')
        .attr('class', 'ov-total-label')
        .attr('x', xCenter(globalPeak.key))
        .attr('y', y(globalPeak.rate) - 12)
        .text(globalPeak.label + ' (' + shortAxisLabel(globalPeak.scenario) + '): ' + compactNumber(globalPeak.rate) + '/hr');
    }

    // Hover hit target per period, shared across all series.
    periodDefs.forEach(function (def) {
      var hit = g.append('rect')
        .attr('class', 'ov-hit-target')
        .attr('x', x(def.key))
        .attr('y', 0)
        .attr('width', x.bandwidth())
        .attr('height', innerHeight)
        .attr('tabindex', 0);

      hit.on('pointerenter pointermove focus', function () {
        d3.select(this).classed('hovered', true);
        showPeriodTooltip(def, data, fiveByScenario, d3.event, opts.tooltipSel);
      });

      hit.on('pointerleave blur', function () {
        d3.select(this).classed('hovered', false);
        hideLineTooltip(opts.tooltipSel);
      });
    });

    renderLineLegend(data, seriesLines, opts.legendSel);
  }

  function showHourlyVehicleTooltip(idx, data, hoursByScenario, evt, tooltipSel) {
    var tooltip = d3.select(tooltipSel);
    tooltip.selectAll('*').remove();

    var reference = (hoursByScenario[data[0].scenario] || [])[idx];
    tooltip.append('div').attr('class', 'ov-tooltip-title').text(reference ? reference.timeLabel : '');

    data.forEach(function (d) {
      var hours = hoursByScenario[d.scenario] || [];
      var point = hours[idx];
      var qty = point ? point.total : 0;

      var row = tooltip.append('div').attr('class', 'ov-tooltip-row');
      row.append('span')
        .attr('class', 'ov-tooltip-key')
        .style('background-color', colorVar(yearColorVars[d.scenario] || '--ov-total'));
      row.append('span').attr('class', 'ov-tooltip-value').text(abmviz_utilities.numberWithCommas(Math.round(qty)));
      row.append('span').attr('class', 'ov-tooltip-label').text(d.axisLabel);
    });

    positionTooltip(tooltip, evt);
  }

  function updateHourlyHoverMarkers(hoverMarkers, data, hoursByScenario, idx, xCenter, y) {
    hoverMarkers.selectAll('*').remove();
    data.forEach(function (d) {
      var hours = hoursByScenario[d.scenario] || [];
      var point = hours[idx];
      if (!point) return;

      hoverMarkers.append('circle')
        .attr('cx', xCenter(idx))
        .attr('cy', y(point.total))
        .attr('r', 3.5)
        .attr('fill', colorVar(yearColorVars[d.scenario] || '--ov-total'))
        .attr('stroke', colorVar('--ov-surface'))
        .attr('stroke-width', 1.5);
    });
  }

  // Renders the vehicle-trips series at hourly resolution (24 points, already
  // rotated to start at 1am by aggregateVehicleHourly) - same granularity as
  // its own data table below, rather than the 48 half-hour points the input
  // AutoVehicleTripsByPeriod.csv is stored at.
  function renderHourlyVehicleChart(vehicleByScenario, data, opts) {
    var svg = d3.select(opts.chartSel);
    svg.selectAll('*').remove();
    svg.attr('viewBox', '0 0 ' + chartWidth + ' ' + chartHeight)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    var innerWidth = chartWidth - margin.left - margin.right;
    var innerHeight = chartHeight - margin.top - margin.bottom;

    var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    var hoursByScenario = {};
    data.forEach(function (d) {
      hoursByScenario[d.scenario] = aggregateVehicleHourly(vehicleByScenario[d.scenario] || []);
    });

    var hourIndexes = d3.range(hourCount);

    var x = d3.scaleBand()
      .domain(hourIndexes)
      .range([0, innerWidth])
      .paddingInner(0)
      .paddingOuter(0.02);

    var xCenter = function (idx) { return x(idx) + x.bandwidth() / 2; };

    var maxQty = d3.max(data, function (d) {
      return d3.max(hoursByScenario[d.scenario] || [], function (h) { return h.total; });
    }) || 1;

    var y = d3.scaleLinear()
      .domain([0, maxQty * 1.18])
      .range([innerHeight, 0])
      .nice();

    var yTicks = y.ticks(5);

    g.selectAll('.ov-gridline')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('class', 'ov-gridline')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', function (d) { return y(d); })
      .attr('y2', function (d) { return y(d); });

    g.selectAll('.ov-axis-label')
      .data(yTicks)
      .enter()
      .append('text')
      .attr('class', 'ov-axis-label')
      .attr('x', -10)
      .attr('y', function (d) { return y(d); })
      .attr('dy', '0.32em')
      .attr('text-anchor', 'end')
      .text(function (d) { return compactNumber(d); });

    g.append('line')
      .attr('class', 'ov-baseline')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', innerHeight)
      .attr('y2', innerHeight);

    // Tick label every 2 hours to avoid clutter. Time labels come from any one
    // scenario's hours array - all scenarios share the same rotated timeLabel
    // sequence since it's derived from the fixed half-hour-period convention.
    var referenceHours = hoursByScenario[data[0].scenario] || [];
    var tickIndexes = hourIndexes.filter(function (i) { return i % 2 === 0; });
    g.selectAll('.ov-hour-label')
      .data(tickIndexes)
      .enter()
      .append('text')
      .attr('class', 'ov-category-label')
      .attr('x', function (i) { return xCenter(i); })
      .attr('y', innerHeight + 20)
      .attr('text-anchor', 'middle')
      .text(function (i) { return referenceHours[i] ? referenceHours[i].timeLabel : ''; });

    var lineGen = d3.line()
      .x(function (h, i) { return xCenter(i); })
      .y(function (h) { return y(h.total); })
      .curve(d3.curveMonotoneX);

    // One line per horizon year - see dataviz-stacked-multiline-misleading:
    // identity across series belongs to line position/color, not to stacking.
    var seriesLines = {};

    data.forEach(function (d) {
      var hours = hoursByScenario[d.scenario] || [];
      var color = colorVar(yearColorVars[d.scenario] || '--ov-total');
      var dashed = !!dashedScenarios[d.scenario];

      var path = g.append('path')
        .datum(hours)
        .attr('class', 'ov-year-line')
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 2)
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round')
        .attr('d', lineGen);

      if (dashed) {
        path.attr('stroke-dasharray', '6 4');
      }

      seriesLines[d.scenario] = path;
    });

    // Label only the single global peak across all years - never one per point.
    var globalPeak = null;
    data.forEach(function (d) {
      (hoursByScenario[d.scenario] || []).forEach(function (h, i) {
        if (!globalPeak || h.total > globalPeak.total) {
          globalPeak = { idx: i, timeLabel: h.timeLabel, total: h.total, scenario: d.scenario };
        }
      });
    });

    if (globalPeak) {
      g.append('text')
        .attr('class', 'ov-total-label')
        .attr('x', xCenter(globalPeak.idx))
        .attr('y', y(globalPeak.total) - 12)
        .text('Peak ' + globalPeak.timeLabel + ' (' + shortAxisLabel(globalPeak.scenario) + '): ' + compactNumber(globalPeak.total));
    }

    var hoverMarkers = g.append('g').attr('class', 'ov-hover-markers');

    // Hover hit target per hour, shared across all series.
    hourIndexes.forEach(function (i) {
      var hit = g.append('rect')
        .attr('class', 'ov-hit-target')
        .attr('x', x(i))
        .attr('y', 0)
        .attr('width', x.bandwidth())
        .attr('height', innerHeight)
        .attr('tabindex', 0);

      hit.on('pointerenter pointermove focus', function () {
        d3.select(this).classed('hovered', true);
        updateHourlyHoverMarkers(hoverMarkers, data, hoursByScenario, i, xCenter, y);
        showHourlyVehicleTooltip(i, data, hoursByScenario, d3.event, opts.tooltipSel);
      });

      hit.on('pointerleave blur', function () {
        d3.select(this).classed('hovered', false);
        hoverMarkers.selectAll('*').remove();
        hideLineTooltip(opts.tooltipSel);
      });
    });

    renderLineLegend(data, seriesLines, opts.legendSel);
  }

  function populateScenarioSelect(data, selectSel) {
    var select = d3.select(selectSel);
    select.selectAll('*').remove();

    select.selectAll('option')
      .data(data)
      .enter()
      .append('option')
      .attr('value', function (d) { return d.scenario; })
      .text(function (d) { return d.header; });
  }

  function renderHourlyModeTable(hourModeByScenario, scenario) {
    var hours = hourModeByScenario[scenario] || [];
    var tbody = d3.select('#overview-hourly-table tbody');
    tbody.selectAll('*').remove();

    var rows = tbody.selectAll('tr')
      .data(hours)
      .enter()
      .append('tr');

    rows.append('td').text(function (h) { return h.timeLabel; });
    modeGroups.forEach(function (modeKey) {
      rows.append('td')
        .attr('class', 'ov-num')
        .text(function (h) { return abmviz_utilities.numberWithCommas(Math.round(h.totals[modeKey])); });
    });
    rows.append('td')
      .attr('class', 'ov-num')
      .style('font-weight', '600')
      .text(function (h) { return abmviz_utilities.numberWithCommas(Math.round(h.total)); });
  }

  function renderVehicleHourTable(vehicleByScenario, scenario) {
    var periods = vehicleByScenario[scenario] || [];
    var hours = aggregateVehicleHourly(periods);
    var tbody = d3.select('#overview-vehicle-table tbody');
    tbody.selectAll('*').remove();

    var rows = tbody.selectAll('tr')
      .data(hours)
      .enter()
      .append('tr');

    rows.append('td').text(function (h) { return h.timeLabel; });
    rows.append('td')
      .attr('class', 'ov-num')
      .style('font-weight', '600')
      .text(function (h) { return abmviz_utilities.numberWithCommas(Math.round(h.total)); });
  }

  function init() {
    loadAll(function (data, hourlyByScenario, hourModeByScenario, vehicleByScenario) {
      if (!data.length) return;

      renderKpis(data);
      renderChart(data);
      renderTable(data);
      renderMultiYearLineChart(hourlyByScenario, data, {
        chartSel: hourlyChartSelector,
        tooltipSel: hourlyTooltipSelector,
        legendSel: hourlyLegendSelector
      });

      populateScenarioSelect(data, hourlyTableScenarioSelectSelector);
      renderHourlyModeTable(hourModeByScenario, data[0].scenario);

      d3.select(hourlyTableScenarioSelectSelector).on('change', function () {
        renderHourlyModeTable(hourModeByScenario, this.value);
      });

      d3.select(hourlyTableToggleSelector).on('change', function () {
        d3.select(hourlyTableContainerSelector).classed('hidden-table', !this.checked);
      });

      renderPeriodChart(hourlyByScenario, data, {
        chartSel: periodChartSelector,
        tooltipSel: periodTooltipSelector,
        legendSel: periodLegendSelector
      });

      renderHourlyVehicleChart(vehicleByScenario, data, {
        chartSel: vehicleChartSelector,
        tooltipSel: vehicleTooltipSelector,
        legendSel: vehicleLegendSelector
      });

      populateScenarioSelect(data, vehicleTableScenarioSelectSelector);
      renderVehicleHourTable(vehicleByScenario, data[0].scenario);

      d3.select(vehicleTableScenarioSelectSelector).on('change', function () {
        renderVehicleHourTable(vehicleByScenario, this.value);
      });

      d3.select(vehicleTableToggleSelector).on('change', function () {
        d3.select(vehicleTableContainerSelector).classed('hidden-table', !this.checked);
      });
    });
  }

  init();

  return {};

})(d3v4, abmviz_utilities);
