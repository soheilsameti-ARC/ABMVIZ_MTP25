DO $$
DECLARE
    yr   text;
    sch  text;
    path text;
BEGIN
    FOREACH yr IN ARRAY ARRAY['2020','2030','2033','2040','2050','2050nb']
    LOOP
        sch  := format('abm_%s', yr);
        path := format('C:/Dashboard/ABMVIZ/Tables/%s/BarChartData.csv', yr);

        RAISE NOTICE 'Exporting %.BarChartData to %', sch, path;

        EXECUTE format($SQL$
            COPY %I."BarChartData"
            TO %L
            WITH (
                FORMAT csv,
                HEADER true,
                DELIMITER ',',
                QUOTE '"',
                ENCODING 'UTF8'
            )
        $SQL$, sch, path);

        RAISE NOTICE '✓ Exported %.BarChartData', sch;
    END LOOP;
END $$;
