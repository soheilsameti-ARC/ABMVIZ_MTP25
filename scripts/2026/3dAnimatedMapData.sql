DO $$
DECLARE
  yr text;
  sql text;
BEGIN
  FOREACH yr IN ARRAY ARRAY['2020','2030','2033','2040','2050','2050nb']
  LOOP
    RAISE NOTICE 'Building AnimatedMapData for abm_%', yr;

    sql := format($Q$
      DROP TABLE IF EXISTS abm_%1$s.AnimatedMapData;

      CREATE TABLE abm_%1$s.AnimatedMapData AS
      WITH periods AS (
        SELECT gs AS per_num, 'PER' || to_char(gs,'FM00') AS per
        FROM generate_series(1,48) gs
      ),
      trips AS (
        SELECT
          person_id,
          NULLIF(regexp_replace(home_taz::text,'[^0-9]','','g'),'')::int AS home_taz,
          NULLIF(regexp_replace(orig_taz::text,'[^0-9]','','g'),'')::int AS orig_taz,
          NULLIF(regexp_replace(orig_purpose_start_period::text,'[^0-9]','','g'),'')::int AS opsp,
          NULLIF(regexp_replace(depart_period::text,'[^0-9]','','g'),'')::int AS dper,
          orig_purpose
        FROM abm_%1$s.tripdata
      ),
      remainder AS (
        SELECT MIN(home_taz) AS taz, MAX(dper) AS per, COUNT(*)::int AS quantity
        FROM trips
        GROUP BY person_id
      ),
      trip_loc AS (
        SELECT t.orig_taz AS zone, p.per, COUNT(*)::int AS persons
        FROM trips t
        JOIN periods p ON t.opsp < p.per_num + 1 AND t.dper > p.per_num - 1
        GROUP BY t.orig_taz, p.per
      ),
      remainder_expanded AS (
        SELECT r.taz AS zone, p.per, r.quantity::int AS persons
        FROM remainder r
        JOIN periods p ON r.per < p.per_num
      ),
      stay_home AS (
        SELECT
          NULLIF(regexp_replace(h.taz::text,'[^0-9]','','g'),'')::int AS zone,
          p.per,
          COUNT(*)::int AS persons
        FROM abm_%1$s.persondata pd
        JOIN abm_%1$s.hhdata     h  ON pd.hh_id::text = h.hh_id::text
        CROSS JOIN periods p
        WHERE pd.activity_pattern = 'H'
        GROUP BY zone, p.per
      ),
      not_home AS (
        SELECT t.orig_taz AS zone, p.per, COUNT(*)::int AS personsnotathome
        FROM trips t
        JOIN periods p ON t.opsp < p.per_num + 1 AND t.dper > p.per_num - 1
        WHERE t.orig_purpose <> 'Home'
        GROUP BY t.orig_taz, p.per
      ),
      persons_agg AS (
        SELECT zone, per, SUM(persons)::int AS persons
        FROM (
          SELECT * FROM trip_loc
          UNION ALL SELECT * FROM remainder_expanded
          UNION ALL SELECT * FROM stay_home
        ) u
        GROUP BY zone, per
      )
      SELECT
        zone AS taz,
        per,
        persons,
        COALESCE(nh.personsnotathome, 0) AS personsnotathome
      FROM persons_agg pa
      LEFT JOIN not_home nh USING (zone, per)
      ORDER BY zone, to_number(substr(per,4),'99');

      CREATE INDEX ON abm_%1$s.AnimatedMapData (taz, per);
    $Q$, yr);

    EXECUTE sql;
    RAISE NOTICE '✓ Finished abm_%', yr;
  END LOOP;
END $$;
