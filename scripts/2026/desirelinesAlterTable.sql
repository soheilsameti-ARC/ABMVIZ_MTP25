DO $$
DECLARE
    
    sch  text;
    
BEGIN
    FOREACH sch IN ARRAY ARRAY['abm_2020','abm_2030','abm_2033','abm_2040','abm_2050','abm_2050nb']
    LOOP

        RAISE NOTICE 'Altering %.desirelines....', sch;

        EXECUTE format($f$
			ALTER Table %1$I.desirelines
			ALTER COLUMN "ORIG" TYPE text USING "ORIG"::text,
			ALTER COLUMN "DEST" TYPE text USING "DEST"::text;
		$f$,sch);



    END LOOP;
END $$;
