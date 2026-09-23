DO $$
DECLARE
    yr  text;
    sch text;
BEGIN
    -- all scenarios / schemas
    FOREACH yr IN ARRAY ARRAY['2020','2030','2033','2040','2050','2050nb']
    LOOP
        sch := format('abm_%s', yr);
        RAISE NOTICE 'Building %.BarChartData', sch;

        EXECUTE format($SQL$
            DROP TABLE IF EXISTS %1$I."BarChartData";

            CREATE TABLE %1$I."BarChartData" AS
            WITH base AS (
                SELECT
                    type AS person_group,
                    CASE activity_pattern
                        WHEN 'M' THEN 'Mandatory'
                        WHEN 'H' THEN 'Home'
                        WHEN 'N' THEN 'Non-mandatory'
                        ELSE activity_pattern
                    END AS day_pattern
                FROM %1$I.persondata
            )
            SELECT
                person_group     AS "PERSON GROUP",
                day_pattern      AS "DAY PATTERN",
                COUNT(*)::bigint AS "Count"
            FROM base
            GROUP BY person_group, day_pattern
            ORDER BY person_group, day_pattern;

            CREATE INDEX ON %1$I."BarChartData"("PERSON GROUP");
            CREATE INDEX ON %1$I."BarChartData"("DAY PATTERN");
        $SQL$, sch);

        RAISE NOTICE '✓ Finished %.BarChartData', sch;
    END LOOP;
END $$;
