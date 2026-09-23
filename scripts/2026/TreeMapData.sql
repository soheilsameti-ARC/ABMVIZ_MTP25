DO $$
DECLARE
    yr  text;
    sch text;
BEGIN
    FOREACH yr IN ARRAY ARRAY['2020','2030','2033','2040','2050','2050nb']
    LOOP
        sch := format('abm_%s', yr);
        RAISE NOTICE 'Building %.TreeMapData', sch;

        -- sanity
        IF to_regclass(format('%I.tripdata', sch)) IS NULL THEN
            RAISE NOTICE 'SKIP %: missing tripdata', sch;
            CONTINUE;
        END IF;

        EXECUTE format($SQL$
            -- 1) SIMPLEMODES lookup (drop/recreate to keep it consistent)
            DROP TABLE IF EXISTS %1$I.simplemodes;
            CREATE TABLE %1$I.simplemodes (
                modename        text,
                nestmodename    text,
                simplemodename  text
            );

            INSERT INTO %1$I.simplemodes (modename, nestmodename, simplemodename) VALUES
              ('DRIVEALONEFREE','DRIVEALONE','AUTO'),
              ('DRIVEALONEPAY','DRIVEALONE','AUTO'),
              ('SHARED2FREE','SHARED2','AUTO'),
              ('SHARED2PAY','SHARED2','AUTO'),
              ('SHARED3FREE','SHARED3','AUTO'),
              ('SHARED3PAY','SHARED3','AUTO'),
              ('WALK','NONMOTORIZED','NONMOTORIZED'),
              ('BIKE','NONMOTORIZED','NONMOTORIZED'),
              ('PNR_ALLTRN','PNR','TRANSIT'),
              ('PNR_PRMTRN','PNR','TRANSIT'),
              ('WALK_PRMTRN','WALK_TRANSIT','TRANSIT'),
              ('WALK_ALLTRN','WALK_TRANSIT','TRANSIT'),
              ('KNR_ALLTRN','KNR','TRANSIT'),
              ('KNR_PRMTRN','KNR','TRANSIT'),
              ('SCHOOL_BUS','SCHOOL_BUS','SCHOOL_BUS');

            CREATE INDEX ON %1$I.simplemodes (modename);

            -- 2) Output table
            DROP TABLE IF EXISTS %1$I."TreeMapData";
            CREATE TABLE %1$I."TreeMapData" AS
            SELECT
                sm.simplemodename                 AS "TRIPS BY MODE",
                sm.nestmodename                   AS "NEST MODE",
                t.trip_mode_name                  AS "SIMPLE MODE",
                COUNT(*)::bigint                  AS "QUANTITY"
            FROM %1$I.tripdata t
            JOIN %1$I.simplemodes sm
              ON t.trip_mode_name = sm.modename
            GROUP BY sm.simplemodename, sm.nestmodename, t.trip_mode_name
            ORDER BY sm.simplemodename, sm.nestmodename, t.trip_mode_name;

            CREATE INDEX ON %1$I."TreeMapData"("TRIPS BY MODE");
            CREATE INDEX ON %1$I."TreeMapData"("NEST MODE");
            CREATE INDEX ON %1$I."TreeMapData"("SIMPLE MODE");
        $SQL$, sch);

        RAISE NOTICE '✓ Finished %.TreeMapData', sch;
    END LOOP;
END $$;
