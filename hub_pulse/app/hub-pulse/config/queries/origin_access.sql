-- Regional origins of visitors to one hub and whether a one-seat transit ride exists
-- @param hub STRING
SELECT
  origin,
  CAST(share_of_local_pct AS DOUBLE) AS share_pct,
  access_type,
  coalesce(direct_lines, '') AS direct_lines
FROM rgersxdatabricks_hackathon.hub_pulse.gold_origin_access
WHERE hub = :hub AND share_of_local_pct IS NOT NULL
ORDER BY share_of_local_pct DESC
LIMIT 12
