DO $$
DECLARE
    yr  text;
    sch text;
BEGIN
    FOREACH yr IN ARRAY ARRAY['2020','2030','2033','2040','2050','2050nb']
    LOOP
        sch := format('abm_%s', yr);
        RAISE NOTICE 'Building %.BarChartAndMapData', sch;

        EXECUTE format($SQL$
            DROP TABLE IF EXISTS %1$I."BarChartAndMapData";

            CREATE TABLE %1$I."BarChartAndMapData" AS
            WITH base AS (
                SELECT
                    -- orig_taz -> int zone (handles ' 1.00' etc)
                    (trim(t.orig_taz::text)::numeric)::int AS zone,
                    x."county"                              AS county,
                    t.trip_mode_name                         AS trip_mode
                FROM %1$I.tripdata t
                JOIN %1$I.tazcrosswalk x
                  ON (trim(t.orig_taz::text)::numeric)::int =
                     (trim(x."mtaz10"::text)::numeric)::int
                -- keep only rows that can be cast safely
                WHERE trim(t.orig_taz::text) ~ '^[0-9.]+$'
                  AND trim(x."mtaz10"::text) ~ '^[0-9.]+$'
                  AND x."county" IS NOT NULL
            )

            -- 1) Trips by zone, county, mode
            SELECT
                zone                                     AS "ZONE",
                MIN(county)                              AS "COUNTY",
                trip_mode                                AS "TRIP MODE",
                COUNT(*)::bigint                         AS "QUANTITY"
            FROM base
            GROUP BY zone, trip_mode

            UNION ALL

            -- 2) Total trips by zone, county
            SELECT
                zone                                     AS "ZONE",
                MIN(county)                              AS "COUNTY",
                'TOTAL'                                  AS "TRIP MODE",
                COUNT(*)::bigint                         AS "QUANTITY"
            FROM base
            GROUP BY zone

            ORDER BY "ZONE", "TRIP MODE";

            CREATE INDEX ON %1$I."BarChartAndMapData"("ZONE");
            CREATE INDEX ON %1$I."BarChartAndMapData"("COUNTY");
        $SQL$, sch);

        RAISE NOTICE '✓ Finished %.BarChartAndMapData', sch;
    END LOOP;
END $$;
