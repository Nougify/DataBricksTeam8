WITH hubs AS (SELECT * FROM VALUES ('UBC',49.2606D,-123.246D),('Waterfront Station',49.2857D,-123.1115D),('Park Royal Mall',49.3265D,-123.138D) AS h(hub,lat,lon)),
d AS (SELECT h.hub, s.stop_id, s.stop_name, 
  6371000*2*asin(sqrt(pow(sin(radians(s.stop_lat-h.lat)/2),2)+cos(radians(h.lat))*cos(radians(s.stop_lat))*pow(sin(radians(s.stop_lon-h.lon)/2),2))) m
  FROM rgersxdatabricks_hackathon.hub_pulse.gtfs_stops s CROSS JOIN hubs h)
SELECT hub, stop_name, round(m) m FROM d WHERE (hub<>'Waterfront Station' AND m<700) OR (hub='UBC' AND stop_name ILIKE '%UBC Exchange%') ORDER BY hub, m LIMIT 80
