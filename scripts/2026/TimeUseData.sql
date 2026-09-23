DO $$
DECLARE
    yr      text;
    sch     text;
BEGIN
    FOREACH yr IN ARRAY ARRAY['2020','2030','2033','2040','2050','2050nb']
    LOOP
        sch := format('abm_%s', yr);
        RAISE NOTICE 'Building %.timeuse', sch;

        -- sanity checks
        IF to_regclass(format('%I.tripdata', sch)) IS NULL THEN
            RAISE NOTICE 'SKIP %: missing tripdata', sch;
            CONTINUE;
        END IF;
        IF to_regclass(format('%I.persondata', sch)) IS NULL THEN
            RAISE NOTICE 'SKIP %: missing persondata', sch;
            CONTINUE;
        END IF;
        IF to_regclass(format('%I.hhdata', sch)) IS NULL THEN
            RAISE NOTICE 'SKIP %: missing hhdata', sch;
            CONTINUE;
        END IF;

        EXECUTE format($SQL$
            DROP TABLE IF EXISTS %1$I.timeuse;

            CREATE TABLE %1$I.timeuse AS
            WITH periods AS (
                SELECT gs AS per
                FROM generate_series(1,48) gs
            ),
            trips AS (
                SELECT
                    person_id::text AS person_id,
                    -- person type comes from tripdata if present; if not, we join later via persondata
                    NULLIF(trim(orig_purpose::text), '') AS orig_purpose,
                    NULLIF(regexp_replace(depart_period::text, '[^0-9]', '', 'g'), '')::int AS depart_per,
                    NULLIF(regexp_replace(orig_purpose_start_period::text, '[^0-9]', '', 'g'), '')::int AS opsp,
                    NULLIF(trim(person_type::text), '') AS person_type_in_trip
                FROM %1$I.tripdata
            ),
            -- person type from persondata (your schema uses column name "type")
            persons AS (
                SELECT
                    person_id::text AS person_id,
                    "type"::text    AS person_type,
                    activity_pattern::text AS activity_pattern
                FROM %1$I.persondata
            ),
            -- remainder: last depart period per person_type (based on trips)
            remainder AS (
                SELECT
                    COALESCE(t.person_type_in_trip, p.person_type) AS person_type,
                    MAX(t.depart_per) AS last_per,
                    COUNT(*)::bigint AS qty
                FROM trips t
                LEFT JOIN persons p USING (person_id)
                WHERE t.depart_per IS NOT NULL
                GROUP BY COALESCE(t.person_type_in_trip, p.person_type), t.person_id
            ),
            remainder_by_type AS (
                SELECT person_type, last_per AS per, COUNT(*)::bigint AS qty
                FROM remainder
                GROUP BY person_type, last_per
            ),
            -- trip-based time use: for each period, count active persons by person_type and orig_purpose
            trip_timeuse AS (
                SELECT
                    COALESCE(t.person_type_in_trip, p.person_type) AS person_type,
                    per.per AS per,
                    UPPER(t.orig_purpose) AS orig_purpose,
                    COUNT(*)::bigint AS quantity
                FROM trips t
                JOIN periods per
                  ON t.opsp < per.per + 1
                 AND t.depart_per > per.per - 1
                LEFT JOIN persons p USING (person_id)
                WHERE t.opsp IS NOT NULL AND t.depart_per IS NOT NULL
                GROUP BY COALESCE(t.person_type_in_trip, p.person_type), per.per, UPPER(t.orig_purpose)
            ),
            -- remainder expanded: after last trip, the person is at Home for later periods
            remainder_home AS (
                SELECT
                    r.person_type,
                    p.per,
                    'HOME'::text AS orig_purpose,
                    SUM(r.qty)::bigint AS quantity
                FROM remainder_by_type r
                JOIN periods p ON r.per < p.per
                GROUP BY r.person_type, p.per
            ),
            -- all-day home people (activity_pattern='H') show up as Home in every period
            stay_home_all_day AS (
                SELECT
                    UPPER(p.person_type) AS person_type,
                    per.per AS per,
                    'HOME'::text AS orig_purpose,
                    COUNT(*)::bigint AS quantity
                FROM persons p
                CROSS JOIN periods per
                WHERE p.activity_pattern = 'H'
                GROUP BY UPPER(p.person_type), per.per
            ),
            combined AS (
                SELECT UPPER(person_type) AS person_type, per, orig_purpose, quantity FROM trip_timeuse
                UNION ALL
                SELECT UPPER(person_type) AS person_type, per, orig_purpose, quantity FROM remainder_home
                UNION ALL
                SELECT person_type, per, orig_purpose, quantity FROM stay_home_all_day
            )
            SELECT
                person_type AS person_type,
                per AS per,
                -- relabel like the original script
                UPPER(
                    REPLACE(
                      REPLACE(
                        REPLACE(orig_purpose, 'ATWORK', 'WORK SUB-TOUR'),
                      'OTHMAINT', 'OTHER MAINTENANCE'),
                    'OTHDISCR', 'OTHER DISCRETIONARY')
                ) AS orig_purpose,
                SUM(quantity)::bigint AS quantity
            FROM combined
            GROUP BY person_type, per, orig_purpose

            UNION ALL

            -- ALL persons rollup
            SELECT
                'ALL'::text AS person_type,
                per,
                UPPER(
                    REPLACE(
                      REPLACE(
                        REPLACE(orig_purpose, 'ATWORK', 'WORK SUB-TOUR'),
                      'OTHMAINT', 'OTHER MAINTENANCE'),
                    'OTHDISCR', 'OTHER DISCRETIONARY')
                ) AS orig_purpose,
                SUM(quantity)::bigint AS quantity
            FROM combined
            GROUP BY per, orig_purpose

            ORDER BY person_type, per, orig_purpose;

            CREATE INDEX ON %1$I.timeuse(person_type, per);
        $SQL$, sch);

        RAISE NOTICE '✓ Finished %.timeuse', sch;
    END LOOP;
END $$;
