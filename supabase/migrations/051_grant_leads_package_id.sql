-- 051_grant_leads_package_id.sql — GRANT SELECT faltante en leads.package_id.
--
-- La 041 protege leads.raw_payload con GRANT por COLUMNA: revoca el SELECT de
-- la tabla y lo devuelve columna por columna, salvo raw_payload. Consecuencia
-- documentada: toda columna NUEVA en `leads` nace sin SELECT y falla en
-- cerrado. La 049 agregó package_id y no la sumó al GRANT, así que el panel de
-- contabilidad (que lee package_id para contar entregados) tiraba
-- "42501: permission denied for table leads" y la página daba 500.
--
-- MANTENIMIENTO: al agregar una columna a `leads`, sumarla acá o quedará
-- ilegible para authenticated.

GRANT SELECT (package_id) ON leads TO authenticated;
