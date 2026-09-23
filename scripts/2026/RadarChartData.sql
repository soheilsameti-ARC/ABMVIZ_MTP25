DO $$
DECLARE
    yr              text;
    sch             text;

    skim_table      text;   -- detected skim table name (in each abm_YYYY schema)
    use_home_taz    boolean;

    home_cnt        bigint;
    orig_cnt        bigint;
BEGIN
    FOREACH yr IN ARRAY ARRAY['2020','2030','2033','2040','2050','2050nb']
    LOOP
        sch := format('abm_%s', yr);
        RAISE NOTICE '--- Building %.RadarChartData ---', sch;

        /* ------------------------------------------------------------
           1) Detect a skim-like table in this schema:
              Must have columns: orig_taz, dest_taz, travel_time
              Prefer table names with skim/travel/time in them.
           ------------------------------------------------------------ */
        SELECT c.table_name
        INTO skim_table
        FROM information_schema.columns c
        WHERE c.table_schema = sch
          AND c.column_name IN ('orig_taz','dest_taz','travel_time')
        GROUP BY c.table_name
        HAVING COUNT(DISTINCT c.column_name) = 3
        ORDER BY
          CASE
            WHEN c.table_name ILIKE '%skim%'   THEN 0
            WHEN c.table_name ILIKE '%travel%' THEN 1
            WHEN c.table_name ILIKE '%time%'   THEN 2
            ELSE 9
          END,
          c.table_name
        LIMIT 1;

        IF skim_table IS NULL THEN
            RAISE NOTICE 'No skim travel-time table found in %. Falling back to tripdata-derived travel times (will NOT match sample).', sch;
        ELSE
            RAISE NOTICE 'Using skim table %.% for Accessible Employment.', sch, skim_table;
        END IF;

        /* ------------------------------------------------------------
           2) Decide whether HOME_TAZ is usable (otherwise use ORIG_TAZ)
           ------------------------------------------------------------ */
        EXECUTE format('SELECT COUNT(*) FROM %I.tripdata WHERE home_taz IS NOT NULL', sch) INTO home_cnt;
        EXECUTE format('SELECT COUNT(*) FROM %I.tripdata WHERE orig_taz IS NOT NULL', sch) INTO orig_cnt;

        -- If HOME_TAZ is at least 25% as available as ORIG_TAZ, treat it as usable.
        use_home_taz := (orig_cnt > 0 AND home_cnt::numeric / orig_cnt::numeric >= 0.25);

        IF use_home_taz THEN
            RAISE NOTICE 'Transit Mode Share will use HOME_TAZ (home_cnt=%, orig_cnt=%).', home_cnt, orig_cnt;
        ELSE
            RAISE NOTICE 'Transit Mode Share will use ORIG_TAZ (HOME_TAZ too sparse) (home_cnt=%, orig_cnt=%).', home_cnt, orig_cnt;
        END IF;

        /* ------------------------------------------------------------
           3) Build RadarChartData
           ------------------------------------------------------------ */
        EXECUTE format($SQL$
            DROP TABLE IF EXISTS %1$I."RadarChartData";

            CREATE TABLE %1$I."RadarChartData" AS
            WITH
            /* Clean zonedata safely */
            zonedata_clean AS (
                SELECT
                    CASE WHEN trim(zone::text) ~ '^\d+(\.\d+)?$'
                        THEN (trim(zone::text)::numeric)::int
                    END AS zone,

                    CASE WHEN trim(hshld::text) ~ '^\d+(\.\d+)?$'
                        THEN trim(hshld::text)::numeric
                    END AS hshld,

                    CASE WHEN trim(emp::text) ~ '^\d+(\.\d+)?$'
                        THEN trim(emp::text)::numeric
                    END AS emp
                FROM %1$I.zonedata
            ),

            /* Clean tripdata safely */
            trips_clean AS (
                SELECT
                    CASE WHEN trim(orig_taz::text) ~ '^\d+(\.\d+)?$'
                        THEN (trim(orig_taz::text)::numeric)::int
                    END AS orig_taz,

                    CASE WHEN trim(dest_taz::text) ~ '^\d+(\.\d+)?$'
                        THEN (trim(dest_taz::text)::numeric)::int
                    END AS dest_taz,

                    CASE WHEN trim(home_taz::text) ~ '^\d+(\.\d+)?$'
                        THEN (trim(home_taz::text)::numeric)::int
                    END AS home_taz,

                    CASE WHEN trim(travel_time::text) ~ '^\d+(\.\d+)?$'
                        THEN trim(travel_time::text)::numeric
                    END AS travel_time,

                    trip_mode_name,

                    CASE WHEN trim(hh_autos::text) ~ '^\d+$'
                        THEN trim(hh_autos::text)::int
                    END AS hh_autos
                FROM %1$I.tripdata
            ),

            /* 1) Jobs Housing Balance (SAMPLE definition): SUM(HSHLD)/SUM(EMP) */
            jobs_housing AS (
                SELECT
                    'Jobs Housing Balance'::text AS axis,
                    m.actcenter                   AS chart,
                    (
                      SUM(z.hshld)::double precision
                      /
                      NULLIF(SUM(z.emp)::double precision, 0)
                    ) AS quantity
                FROM zonedata_clean z
                JOIN abm_common.actcentertozone m ON z.zone = m.zone
                WHERE z.zone IS NOT NULL
                  AND z.hshld IS NOT NULL
                  AND z.emp IS NOT NULL
                GROUP BY m.actcenter
            ),

            /* 2) Accessible Employment: prefer skim table if found, else trip-derived mins */
            travel_times AS (
                %2$s
            ),
            accessible_emp AS (
                SELECT
                    'Accessible Employment'::text AS axis,
                    ac.actcenter                 AS chart,
                    SUM(z.emp)::double precision AS quantity
                FROM travel_times tt
                JOIN abm_common.actcenter ac ON tt.dest_taz = ac.centerzone
                JOIN zonedata_clean z        ON tt.orig_taz = z.zone
                WHERE tt.traveltime <= 30
                  AND tt.traveltime > 0
                  AND z.emp IS NOT NULL
                GROUP BY ac.actcenter
            ),

            /* 3) Transit Mode Share: HOME_TAZ if usable else ORIG_TAZ (include zero transit via LEFT JOIN) */
            base_taz AS (
                SELECT
                    CASE
                      WHEN %3$s THEN home_taz
                      ELSE orig_taz
                    END AS taz,
                    trip_mode_name
                FROM trips_clean
                WHERE (CASE WHEN %3$s THEN home_taz ELSE orig_taz END) IS NOT NULL
            ),
            totals AS (
                SELECT taz, COUNT(*)::bigint AS total_trips
                FROM base_taz
                GROUP BY taz
            ),
            transit AS (
                SELECT taz, COUNT(*)::bigint AS transit_trips
                FROM base_taz
                WHERE trip_mode_name IN (
                    'WALK_ALLTRN','WALK_PRMTRN',
                    'PNR_ALLTRN','PNR_PRMTRN',
                    'KNR_ALLTRN','KNR_PRMTRN'
                )
                GROUP BY taz
            ),
            transit_share AS (
                SELECT
                    'Transit Mode Share'::text AS axis,
                    m.actcenter               AS chart,
                    (
                      SUM(COALESCE(tr.transit_trips, 0))::double precision
                      /
                      NULLIF(SUM(t.total_trips)::double precision, 0)
                    ) AS quantity
                FROM abm_common.actcentertozone m
                JOIN totals t
                  ON m.zone = t.taz
                LEFT JOIN transit tr
                  ON t.taz = tr.taz
                GROUP BY m.actcenter
            ),

            /* 4) Zero Car Transit Trips per HH */
            zero_car_trips AS (
                SELECT
                    m.actcenter         AS actcenter,
                    COUNT(*)::bigint    AS zero_car_transit_trips
                FROM trips_clean t
                JOIN abm_common.actcentertozone m ON t.orig_taz = m.zone
                WHERE t.orig_taz IS NOT NULL
                  AND t.hh_autos = 0
                  AND t.trip_mode_name IN (
                    'WALK_ALLTRN','WALK_PRMTRN',
                    'PNR_ALLTRN','PNR_PRMTRN',
                    'KNR_ALLTRN','KNR_PRMTRN'
                  )
                GROUP BY m.actcenter
            ),
            hhs_by_center AS (
                SELECT
                    m.actcenter                     AS actcenter,
                    SUM(z.hshld)::double precision  AS hhs
                FROM zonedata_clean z
                JOIN abm_common.actcentertozone m ON z.zone = m.zone
                WHERE z.zone IS NOT NULL
                  AND z.hshld IS NOT NULL
                GROUP BY m.actcenter
            ),
            zero_car_metric AS (
                SELECT
                    'Zero Car Transit Trips Per HH'::text AS axis,
                    zc.actcenter                          AS chart,
                    (
                      zc.zero_car_transit_trips::double precision
                      /
                      NULLIF(h.hhs, 0)
                    ) AS quantity
                FROM zero_car_trips zc
                JOIN hhs_by_center h
                  ON zc.actcenter = h.actcenter
            )

            SELECT
                axis     AS "AXIS",
                quantity AS "QUANTITY",
                chart    AS "CHART"
            FROM (
                SELECT * FROM jobs_housing
                UNION ALL
                SELECT * FROM accessible_emp
                UNION ALL
                SELECT * FROM transit_share
                UNION ALL
                SELECT * FROM zero_car_metric
            ) u
            ORDER BY "CHART", "AXIS";
        $SQL$,
        sch,

        /* %2$s: travel_times CTE injected here */
        CASE
          WHEN skim_table IS NOT NULL THEN
            format(
              $TT$
              SELECT
                  CASE WHEN trim(orig_taz::text) ~ '^\d+(\.\d+)?$' THEN (trim(orig_taz::text)::numeric)::int END AS orig_taz,
                  CASE WHEN trim(dest_taz::text) ~ '^\d+(\.\d+)?$' THEN (trim(dest_taz::text)::numeric)::int END AS dest_taz,
                  CASE WHEN trim(travel_time::text) ~ '^\d+(\.\d+)?$' THEN trim(travel_time::text)::numeric END AS traveltime
              FROM %1$I.%2$I
              WHERE trim(travel_time::text) ~ '^\d+(\.\d+)?$'
              $TT$,
              sch, skim_table
            )
          ELSE
            format(
              $TT$
              SELECT
                  orig_taz,
                  dest_taz,
                  MIN(travel_time) AS traveltime
              FROM trips_clean
              WHERE orig_taz IS NOT NULL
                AND dest_taz IS NOT NULL
                AND travel_time IS NOT NULL
              GROUP BY orig_taz, dest_taz
              $TT$
            )
        END,

        /* %3$s: boolean literal */
        CASE WHEN use_home_taz THEN 'true' ELSE 'false' END
        );

        RAISE NOTICE '✓ Finished %.RadarChartData', sch;
    END LOOP;
END $$;
