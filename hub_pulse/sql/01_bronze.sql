-- SETUP: schema and volumes (raw files are uploaded to the raw volume with `databricks fs cp`; see HANDOFF.md)
CREATE SCHEMA IF NOT EXISTS rgersxdatabricks_hackathon.hub_pulse
COMMENT 'Hub Pulse: transit demand vs service gaps at Vancouver hubs';

CREATE VOLUME IF NOT EXISTS rgersxdatabricks_hackathon.hub_pulse.raw
COMMENT 'Hub Pulse landing zone: TransLink GTFS static feed (fall 2026, .txt files + original zip) and TransLink 2025 Transit Service Performance Review open-data CSVs + Transit Service Guidelines PDF';

CREATE VOLUME IF NOT EXISTS rgersxdatabricks_hackathon.hub_pulse.code
COMMENT 'Hub Pulse source code snapshot: SQL pipeline, notebooks, dashboard/Genie builders, AppKit app, pitch deck, analysis scripts, HANDOFF.md';

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gtfs_stops
COMMENT 'TransLink GTFS static feed (fall 2026): stops and stations with coordinates. Source: gtfs-static.translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/gtfs/stops.txt', format => 'csv', header => true, inferSchema => true);

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gtfs_routes
COMMENT 'TransLink GTFS static feed (fall 2026): routes (bus, SkyTrain, SeaBus, West Coast Express). Source: gtfs-static.translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/gtfs/routes.txt', format => 'csv', header => true, inferSchema => true);

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gtfs_trips
COMMENT 'TransLink GTFS static feed (fall 2026): scheduled trips with route and service_id. Source: gtfs-static.translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/gtfs/trips.txt', format => 'csv', header => true, inferSchema => true);

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gtfs_calendar
COMMENT 'TransLink GTFS static feed (fall 2026): weekly service calendars. Source: gtfs-static.translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/gtfs/calendar.txt', format => 'csv', header => true, inferSchema => true);

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gtfs_stop_times
COMMENT 'TransLink GTFS static feed (fall 2026): arrival/departure time of every trip at every stop (stop_id is STRING). Source: gtfs-static.translink.ca' AS
SELECT trip_id, trim(arrival_time) AS arrival_time, trim(departure_time) AS departure_time, stop_id, stop_sequence
FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/gtfs/stop_times.txt', format => 'csv', header => true, schema => 'trip_id BIGINT, arrival_time STRING, departure_time STRING, stop_id STRING, stop_sequence INT, stop_headsign STRING, pickup_type INT, drop_off_type INT, shape_dist_traveled DOUBLE, timepoint INT');

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_bus_route_year
COMMENT 'TransLink 2025 Transit Service Performance Review: annual bus metrics per line (boardings, overcrowding, peak load, bunching, on-time). Source: translink.ca Managing the Transit Network' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/tspr/tspr2025_bus_yearline.csv', format => 'csv', header => true, inferSchema => true, encoding => 'UTF-8');

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_bus_route_timerange
COMMENT 'TransLink 2025 TSPR: bus service and productivity per line, day type, season and time range. Source: translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/tspr/tspr2025_bus_yearlinedaytypeseasontimerange.csv', format => 'csv', header => true, inferSchema => true);

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_bus_peakload
COMMENT 'TransLink 2025 TSPR: average peak passenger load and load factor per line, day type, season, time range and direction. Numeric columns may hold the string NULL; use try_cast. Source: translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/tspr/tspr2025_bus_peakload_yearlinedaytypeseasontimerangedirection.csv', format => 'csv', header => true, inferSchema => true);

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_seabus_hourly
COMMENT 'TransLink 2025 TSPR: SeaBus hourly capacity, volume and peak load by day type, season and direction. Source: translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/tspr/tspr2025_seabus_capvolpkload_yeardaytypeseasonhourlydirection.csv', format => 'csv', header => true, inferSchema => true);

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_skytrain_station_hourly
COMMENT 'TransLink 2025 TSPR: average daily boardings and alightings per SkyTrain station, day type and hour. Source: translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/tspr/tspr2025_skytrainavgalightsbrdgs_yearstationdaytypehourly.csv', format => 'csv', header => true, inferSchema => true);

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_wce_station_hourly
COMMENT 'TransLink 2025 TSPR: West Coast Express average daily boardings and alightings per station, day type and hour. Source: translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/tspr/tspr2025_wce_yearstationdaytypehourly.csv', format => 'csv', header => true, inferSchema => true);

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_skytrain_station_year
COMMENT 'TransLink 2025 TSPR: annual and average daily boardings per SkyTrain station. Source: translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/tspr/tspr2025_skytrain_yearstation.csv', format => 'csv', header => true, inferSchema => true);

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gtfs_calendar_dates
COMMENT 'TransLink GTFS static feed (fall 2026): service added (1) or removed (2) on specific dates, e.g. West Coast Express. Source: gtfs-static.translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/gtfs/calendar_dates.txt', format => 'csv', header => true, inferSchema => true);
