DO $$
DECLARE
    yr   text;
    sch  text;
    path text;
BEGIN
    FOREACH yr IN ARRAY ARRAY['2020','2030','2033','2040','2050','2050nb']
    LOOP
        sch  := format('abm_%s', yr);
        path := format('C:/Dashboard/ABMVIZ/Tables/%s/BarChartAndMapData.csv', yr);

        RAISE NOTICE 'Exporting %.BarChartAndMapData to %', sch, path;

        EXECUTE format($SQL$
            COPY %I."BarChartAndMapData"
            TO %L
            WITH (
                FORMAT csv,
                HEADER true,
                DELIMITER ',',
                QUOTE '"',
                ENCODING 'UTF8'
            )
        $SQL$, sch, path);

        RAISE NOTICE '✓ Exported %.BarChartAndMapData', sch;
    END LOOP;
END $$;
