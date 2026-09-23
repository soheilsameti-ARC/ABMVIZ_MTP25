DO $$
DECLARE
  sch text;
BEGIN
  FOREACH sch IN ARRAY ARRAY['abm_2020','abm_2030','abm_2033','abm_2040','abm_2050','abm_2050nb']
  LOOP
    RAISE NOTICE 'Building %.desirelines ...', sch;

    EXECUTE format($SQL$
      DROP TABLE IF EXISTS %1$I.desirelines;

      CREATE TABLE %1$I.desirelines AS
      WITH base AS (
        SELECT
          -- Normalize orig/dest superdistrict to INT safely (handles int OR text OR blanks)
          NULLIF(trim(coalesce(t.orig_sd::text,'')), '')::int AS "ORIG",
          NULLIF(trim(coalesce(t.dest_sd::text,'')), '')::int AS "DEST",

          CASE
            WHEN coalesce(t.tour_purpose,'') ILIKE 'work%%'
              OR coalesce(t.dest_purpose,'') ILIKE 'work%%'
              OR coalesce(t.orig_purpose,'') ILIKE 'work%%'
              OR coalesce(t.dest_purpose,'') ILIKE 'atwork%%'
              OR coalesce(t.orig_purpose,'') ILIKE 'atwork%%'
            THEN 1 ELSE 0
          END AS is_work,

          CASE
            WHEN coalesce(t.trip_mode_name,'') ILIKE 'DRIVEALONE%%' THEN 'SOV'
            WHEN coalesce(t.trip_mode_name,'') ILIKE 'SHARED%%'    THEN 'HOV'
            WHEN coalesce(t.trip_mode_name,'') ILIKE '%%TRN%%'
              OR coalesce(t.trip_mode_name,'') ILIKE '%%TRANSIT%%'
            THEN 'TRN'
            ELSE NULL
          END AS mode3

        FROM %1$I.tripdata t
      )
      SELECT
        "ORIG",
        "DEST",

        COUNT(*) FILTER (WHERE is_work = 1 AND mode3 = 'SOV')::int AS "WRKSOV",
        COUNT(*) FILTER (WHERE is_work = 1 AND mode3 = 'HOV')::int AS "WRKHOV",
        COUNT(*) FILTER (WHERE is_work = 1 AND mode3 = 'TRN')::int AS "WRKTRN",

        COUNT(*) FILTER (WHERE is_work = 0 AND mode3 = 'SOV')::int AS "NWKSOV",
        COUNT(*) FILTER (WHERE is_work = 0 AND mode3 = 'HOV')::int AS "NWKHOV",
        COUNT(*) FILTER (WHERE is_work = 0 AND mode3 = 'TRN')::int AS "NWKTRN",

        COUNT(*) FILTER (WHERE mode3 = 'SOV')::int AS "ALLSOV",
        COUNT(*) FILTER (WHERE mode3 = 'HOV')::int AS "ALLHOV",
        COUNT(*) FILTER (WHERE mode3 = 'TRN')::int AS "ALLTRN",

        COUNT(*) FILTER (WHERE is_work = 1 AND mode3 IN ('SOV','HOV','TRN'))::int AS "WRKALL",
        COUNT(*) FILTER (WHERE is_work = 0 AND mode3 IN ('SOV','HOV','TRN'))::int AS "NWKALL",
        COUNT(*) FILTER (WHERE mode3 IN ('SOV','HOV','TRN'))::int                 AS "ALLALL"

      FROM base
      WHERE "ORIG" IS NOT NULL
        AND "DEST" IS NOT NULL
        AND mode3 IS NOT NULL
      GROUP BY "ORIG","DEST"
      ORDER BY "ORIG","DEST";
    $SQL$, sch);

  END LOOP;
END $$;
