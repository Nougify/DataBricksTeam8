-- Rule-based evidence + ai_query-written action for one hub
-- @param hub STRING
SELECT CAST(priority AS INT) AS priority, category, recommendation, evidence
FROM rgersxdatabricks_hackathon.hub_pulse.gold_recommendations
WHERE hub = :hub
ORDER BY priority, category
