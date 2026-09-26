#!/usr/bin/env python3
"""Build the serialized_space for the Hub Pulse Genie space. Usage: build_genie.py [--validate]"""
import json
import subprocess
import sys
import uuid

S = "rgersxdatabricks_hackathon.hub_pulse"


def nid(seed):
    return uuid.uuid5(uuid.NAMESPACE_URL, "hub_pulse/" + seed).hex


HUB_COL = {"column_name": "hub", "description": ["Study hub: 'UBC', 'Waterfront Station' or 'Park Royal Mall'."],
           "synonyms": ["station", "location", "exchange", "Waterfront", "Park Royal", "UBC Exchange"],
           "enable_format_assistance": True, "enable_entity_matching": True}
DAYTYPE_COL = {"column_name": "day_type", "description": ["TransLink day type: 'MF' = weekday (Mon-Fri), 'Sat' = Saturday, 'Sun/Hol' = Sunday or statutory holiday."],
               "synonyms": ["weekday", "weekend", "day of week type"], "enable_format_assistance": True, "enable_entity_matching": True}

TABLES = [
    {"identifier": f"{S}.gold_hub_daily", "column_configs": [
        HUB_COL, DAYTYPE_COL,
        {"column_name": "pings", "description": ["Visits (device pings) recorded at the hub that day."], "synonyms": ["visits", "visitors", "foot traffic", "demand"]},
        {"column_name": "surge_index", "description": ["Visits divided by the average of the same weekday in the surrounding 9 weeks. 1.0 = normal; >= 1.25 = surge day."], "synonyms": ["surge", "spike"]},
        {"column_name": "is_surge", "description": ["True when surge_index >= 1.25."]},
        {"column_name": "visitor_share", "description": ["Fraction (0-1) of visits from outside Metro Vancouver (other provinces, rest of BC, international)."], "synonyms": ["tourist share"]},
        {"column_name": "dow", "exclude": True},
    ]},
    {"identifier": f"{S}.gold_hub_gap_hourly", "column_configs": [
        HUB_COL, DAYTYPE_COL,
        {"column_name": "hour", "description": ["Hour of day 0-23, local time."]},
        {"column_name": "avg_pings", "description": ["Average visits in this hour on a typical fall day of this day type."], "synonyms": ["demand", "visits per hour"]},
        {"column_name": "departures", "description": ["Scheduled transit departures from the hub in this hour (TransLink GTFS, fall 2026)."], "synonyms": ["service", "trips", "buses", "supply"]},
        {"column_name": "demand_pct", "description": ["Share (0-100) of the day's visits that fall in this hour."]},
        {"column_name": "supply_pct", "description": ["Share (0-100) of the day's departures that fall in this hour."]},
        {"column_name": "gap_index", "description": ["demand_pct / supply_pct. > 1.5 underserved, < 0.67 overserved."], "synonyms": ["gap", "mismatch", "service gap"]},
        {"column_name": "departures_short", "description": ["Departures that would need to be added in this hour for its share of service to equal its share of demand."]},
        {"column_name": "status", "description": ["'Underserved', 'Overserved', 'Balanced' or 'No service'."], "enable_format_assistance": True, "enable_entity_matching": True},
    ]},
    {"identifier": f"{S}.gold_hub_timerange_stress", "column_configs": [
        HUB_COL, DAYTYPE_COL,
        {"column_name": "season", "description": ["'Fall' (Sep-May, term service) or 'Summer' (Jun-Aug)."], "enable_format_assistance": True, "enable_entity_matching": True},
        {"column_name": "time_period", "description": ["TransLink TSPR time period, e.g. '06-09 AM peak', '09-15 Midday', '15-18 PM peak'."], "enable_format_assistance": True, "enable_entity_matching": True},
        {"column_name": "max_peak_load_factor", "description": ["Highest 2025 peak load factor (percent of vehicle capacity, 0-100+) among bus lines serving the hub in this period. 100 = full."], "synonyms": ["crowding", "how full", "capacity"]},
        {"column_name": "most_crowded_line", "description": ["Line and direction with the highest peak load factor in this period."]},
        {"column_name": "demand_pct", "description": ["Share (0-100) of the hub's daily visits in this time period."]},
    ]},
    {"identifier": f"{S}.gold_origin_access", "column_configs": [
        HUB_COL,
        {"column_name": "origin", "description": ["Home area of the visitor: a Vancouver neighbourhood, Metro Vancouver city, province or 'International'."], "synonyms": ["neighbourhood", "home area", "where from"],
         "enable_format_assistance": True, "enable_entity_matching": True},
        {"column_name": "access_type", "description": ["'One-seat ride' (a line serving the hub also serves the origin), 'Transfer required', 'Local (same area)', or 'Visitor (out of region)'."],
         "synonyms": ["direct ride", "transfer"], "enable_format_assistance": True, "enable_entity_matching": True},
        {"column_name": "share_of_local_pct", "description": ["Share (0-100) of the hub's regional visitors (excluding same-area and out-of-region) from this origin. NULL for out-of-region and same-area rows."]},
        {"column_name": "share_pct", "description": ["Share (0-100) of all visits to the hub from this origin."]},
        {"column_name": "direct_lines", "description": ["Comma-separated lines giving a one-seat ride from the origin to the hub."]},
        {"column_name": "lat", "exclude": True}, {"column_name": "lon", "exclude": True},
    ]},
    {"identifier": f"{S}.gold_recommendations", "column_configs": [
        HUB_COL,
        {"column_name": "category", "description": ["Type of issue, e.g. 'Relieve overcrowded line', 'Close a transfer gap', 'Late-night service gap'."], "enable_format_assistance": True, "enable_entity_matching": True},
        {"column_name": "priority", "description": ["1 = act now, 2 = plan, 3 = prepare."]},
        {"column_name": "recommendation", "description": ["One-sentence action written by an LLM (ai_query) from the evidence column."], "synonyms": ["action", "suggestion", "what to do"]},
        {"column_name": "evidence", "description": ["Numbers and facts behind the recommendation, computed in SQL."]},
    ]},
    {"identifier": f"{S}.gold_route_stress", "column_configs": [
        HUB_COL,
        {"column_name": "line", "description": ["TransLink bus line number, e.g. '99' (B-Line), 'R4', '49', '257'."], "synonyms": ["route", "bus", "route number"],
         "enable_format_assistance": True, "enable_entity_matching": True},
        {"column_name": "pct_trips_overcrowded", "description": ["Percent (0-100) of the line's 2025 trips that were overcrowded (TransLink TSPR)."], "synonyms": ["overcrowding", "crowding"]},
        {"column_name": "avg_peak_load_factor", "description": ["Average 2025 peak load factor, percent of capacity."]},
        {"column_name": "pct_bunching", "description": ["Percent of 2025 trips that were bunched."], "synonyms": ["bus bunching"]},
        {"column_name": "pct_on_time", "description": ["Percent of 2025 trips on time."], "synonyms": ["on-time performance", "OTP", "reliability"]},
        {"column_name": "avg_weekday_boardings", "description": ["Average weekday boardings on the whole line in 2025."], "synonyms": ["ridership", "boardings"]},
    ]},
]

SAMPLE_QUESTIONS = [
    "When is UBC most underserved on weekdays?",
    "Which bus lines serving UBC are the most overcrowded?",
    "Which origins have no direct transit ride to Park Royal Mall?",
    "What were the 5 biggest surge days at Waterfront Station?",
    "What should TransLink do first at UBC?",
    "Compare overnight demand at the three hubs on Saturdays",
]

EXAMPLES = [
    ("Which hours are underserved at UBC on weekdays?",
     f"SELECT gold_hub_gap_hourly.hour, gold_hub_gap_hourly.avg_pings, gold_hub_gap_hourly.departures, gold_hub_gap_hourly.demand_pct, gold_hub_gap_hourly.supply_pct, gold_hub_gap_hourly.gap_index "
     f"FROM {S}.gold_hub_gap_hourly WHERE gold_hub_gap_hourly.hub = 'UBC' AND gold_hub_gap_hourly.day_type = 'MF' AND gold_hub_gap_hourly.status IN ('Underserved', 'No service') "
     f"ORDER BY gold_hub_gap_hourly.gap_index DESC"),
    ("Rank the bus lines serving Waterfront Station by overcrowding",
     f"SELECT gold_route_stress.line, gold_route_stress.route_name, gold_route_stress.pct_trips_overcrowded, gold_route_stress.avg_peak_load_factor, gold_route_stress.pct_bunching "
     f"FROM {S}.gold_route_stress WHERE gold_route_stress.hub = 'Waterfront Station' ORDER BY gold_route_stress.pct_trips_overcrowded DESC"),
    ("What share of each hub's regional visitors need a transfer?",
     f"SELECT gold_origin_access.hub, ROUND(SUM(CASE WHEN gold_origin_access.access_type = 'Transfer required' THEN gold_origin_access.share_of_local_pct ELSE 0 END), 1) AS transfer_required_pct "
     f"FROM {S}.gold_origin_access WHERE gold_origin_access.share_of_local_pct IS NOT NULL GROUP BY gold_origin_access.hub ORDER BY transfer_required_pct DESC"),
    ("Top surge days at Park Royal Mall",
     f"SELECT gold_hub_daily.visit_date, gold_hub_daily.weekday, gold_hub_daily.pings, gold_hub_daily.surge_index "
     f"FROM {S}.gold_hub_daily WHERE gold_hub_daily.hub = 'Park Royal Mall' AND gold_hub_daily.is_surge ORDER BY gold_hub_daily.surge_index DESC LIMIT 10"),
    ("When are buses at capacity at UBC on fall weekdays?",
     f"SELECT gold_hub_timerange_stress.time_period, gold_hub_timerange_stress.max_peak_load_factor, gold_hub_timerange_stress.most_crowded_line, gold_hub_timerange_stress.demand_pct "
     f"FROM {S}.gold_hub_timerange_stress WHERE gold_hub_timerange_stress.hub = 'UBC' AND gold_hub_timerange_stress.day_type = 'MF' AND gold_hub_timerange_stress.season = 'Fall' "
     f"ORDER BY gold_hub_timerange_stress.tspr_hour_range"),
]

TEXT = """## PURPOSE
- Answer questions about where and when TransLink service does not match demand at three Vancouver hubs: UBC, Waterfront Station and Park Royal Mall.
- Users are hackathon judges and transit planners; explain results in plain language.

## DISAMBIGUATION
- "Waterfront" means hub 'Waterfront Station'; "Park Royal" means 'Park Royal Mall'; "UBC Exchange" means 'UBC'.
- "Weekday" means day_type 'MF'; "weekend" means day_type 'Sat' and 'Sun/Hol'.
- "Visits", "visitors", "foot traffic" and "demand" all refer to pings.

## DATA QUALITY NOTES
- Visit pings are synthetic and measure people at a hub, not transit boardings; compare demand to service using shares (demand_pct vs supply_pct, gap_index), never raw pings vs departures.
- Crowding, bunching and on-time columns come from TransLink's 2025 Transit Service Performance Review and are percentages on a 0-100 scale.

## Instructions you must follow when providing summaries
- State which hub and day type the answer covers.
- Round percentages to one decimal place.
"""


def build():
    payload = {
        "version": 2,
        "config": {"sample_questions": sorted([{"id": nid("sq" + q), "question": [q]} for q in SAMPLE_QUESTIONS], key=lambda x: x["id"])},
        "data_sources": {"tables": sorted([{"identifier": t["identifier"], "column_configs": sorted(t["column_configs"], key=lambda c: c["column_name"])} for t in TABLES],
                                          key=lambda t: t["identifier"])},
        "instructions": {
            "text_instructions": [{"id": nid("text"), "content": [l + "\n" for l in TEXT.strip().splitlines()]}],
            "example_question_sqls": sorted([{"id": nid("ex" + q), "question": [q], "sql": [s]} for q, s in EXAMPLES], key=lambda x: x["id"]),
        },
    }
    return payload


if __name__ == "__main__":
    if "--validate" in sys.argv:
        r = subprocess.run(["databricks", "experimental", "aitools", "tools", "query", "--output", "json", "--profile", "DEFAULT"]
                           + [f"SELECT count(*) FROM ({s})" for _, s in EXAMPLES], capture_output=True, text=True)
        for (q, _), o in zip(EXAMPLES, json.loads(r.stdout)):
            print(o["state"], o.get("rows") or o.get("error"), "|", q)
    else:
        print(json.dumps(build()))
