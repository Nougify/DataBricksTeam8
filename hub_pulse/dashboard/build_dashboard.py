#!/usr/bin/env python3
"""Build dashboard.json for the Hub Pulse AI/BI dashboard. Usage: build_dashboard.py [genie_space_id]"""
import json
import sys

from datasets import DATASETS

EXTRA = {
    "ds_heat": ("Gap heatmap", """
SELECT hub, CASE day_type WHEN 'MF' THEN 'Weekday' WHEN 'Sat' THEN 'Saturday' ELSE 'Sunday/holiday' END AS day_label,
  lpad(CAST(hour AS STRING), 2, '0') AS hour_label, gap_index
FROM gold_hub_gap_hourly
ORDER BY hub, day_type, hour"""),
    "ds_surge": ("Surge days", """
SELECT hub, visit_date, weekday, pings, surge_index
FROM gold_hub_daily WHERE is_surge
ORDER BY surge_index DESC"""),
}
ALL = {**DATASETS, **EXTRA}

CORAL, BLUE, GREEN, GREY = "#E8590C", "#1C7ED6", "#2B8A3E", "#868E96"
PCT = {"type": "number-percent", "decimalPlaces": {"type": "max", "places": 1}}
COMPACT = {"type": "number", "abbreviation": "compact", "decimalPlaces": {"type": "max", "places": 1}}
ACCESS_COLORS = [{"value": "One-seat ride", "color": GREEN}, {"value": "Transfer required", "color": CORAL},
                 {"value": "Local (same area)", "color": BLUE}, {"value": "Visitor (out of region)", "color": GREY}]


def lines(sql):
    return [l + "\n" for l in sql.strip().splitlines()]


def dataset(name):
    display, sql = ALL[name]
    ds = {"name": name, "displayName": display, "queryLines": lines(sql)}
    if name == "ds_origin":
        ds["columns"] = [{"displayName": "Transfer share", "description": "Share of regional visits (excl. same-area and out-of-region) with no one-seat transit ride",
                          "expression": "SUM(`transfer_pings`) * 1.0 / SUM(`regional_pings`)"}]
    return ds


def text(name, md_lines, x, y, w, h):
    return {"widget": {"name": name, "multilineTextboxSpec": {"lines": md_lines}}, "position": {"x": x, "y": y, "width": w, "height": h}}


def q(ds, fields, disagg=False, filters=None):
    query = {"datasetName": ds, "fields": [{"name": n, "expression": e} for n, e in fields], "disaggregated": disagg}
    if filters:
        query["filters"] = [{"expression": f} for f in filters]
    return [{"name": "main_query", "query": query}]


def widget(name, queries, spec, x, y, w, h):
    return {"widget": {"name": name, "queries": queries, "spec": spec}, "position": {"x": x, "y": y, "width": w, "height": h}}


def frame(title, desc=None):
    f = {"showTitle": True, "title": title}
    if desc:
        f.update({"showDescription": True, "description": desc})
    return f


def filter_widget(name, title, field, datasets, x, y, w, h, default=None):
    queries = [{"name": f"f_{ds}", "query": {"datasetName": ds, "fields": [{"name": field, "expression": f"`{field}`"}], "disaggregated": False}} for ds in datasets]
    spec = {"version": 2, "widgetType": "filter-single-select",
            "encodings": {"fields": [{"fieldName": field, "displayName": title, "queryName": f"f_{ds}"} for ds in datasets]},
            "frame": {"showTitle": True, "title": title}}
    if default:
        spec["selection"] = {"defaultSelection": {"values": {"dataType": "STRING", "values": [{"value": default}]}}}
    return {"widget": {"name": name, "queries": queries, "spec": spec}, "position": {"x": x, "y": y, "width": w, "height": h}}


HUB_DS = ["ds_daily", "ds_gap", "ds_heat", "ds_route", "ds_period", "ds_forecast", "ds_surge", "ds_origin", "ds_recs"]

overview = [
    text("header", [
        "# Hub Pulse — is Vancouver's transit schedule in step with its hubs?\n", "\n",
        "21.5M visit pings at **UBC**, **Waterfront Station** and **Park Royal Mall**, matched against TransLink's fall 2026 schedule (GTFS) and 2025 "
        "performance review (TSPR). The schedule is built around commute peaks, but visits peak **midday** and, at UBC, **overnight** — while the lines "
        "feeding these hubs are already overcrowded. Pick a hub on the right; recommendations are at the bottom.",
    ], 0, 0, 8, 4),
    filter_widget("filter-hub", "Hub", "hub", HUB_DS, 8, 0, 4, 2, default="UBC"),
    filter_widget("filter-daytype", "Day type (hourly chart)", "day_label", ["ds_gap"], 8, 2, 4, 2, default="Weekday"),

    widget("kpi-visits", q("ds_daily", [("sum(pings)", "SUM(`pings`)"), ("weekly(visit_date)", 'DATE_TRUNC("WEEK", `visit_date`)')]),
           {"version": 2, "widgetType": "counter",
            "encodings": {"value": {"fieldName": "sum(pings)", "displayName": "Visits", "format": COMPACT}, "period": {"fieldName": "weekly(visit_date)"}},
            "frame": frame("Visits analysed", "Nov 2025 – Aug 2026, weekly trend")}, 0, 4, 3, 3),
    widget("kpi-underserved", q("ds_gap", [("sum(underserved_flag)", "SUM(`underserved_flag`)")]),
           {"version": 2, "widgetType": "counter",
            "encodings": {"value": {"fieldName": "sum(underserved_flag)", "displayName": "Hours"}},
            "frame": frame("Underserved hours", "Hours where visit share > 1.5× departure share (selected day type)")}, 3, 4, 3, 3),
    widget("kpi-peakload", q("ds_period", [("max(max_peak_load)", "MAX(`max_peak_load`)")]),
           {"version": 2, "widgetType": "counter",
            "encodings": {"value": {"fieldName": "max(max_peak_load)", "displayName": "Peak load", "format": PCT}},
            "frame": frame("Worst bus peak load", "Busiest line at this hub, weekdays (TSPR 2025). 100% = full")}, 6, 4, 3, 3),
    widget("kpi-transfer", q("ds_origin", [("measure(Transfer share)", "MEASURE(`Transfer share`)")]),
           {"version": 2, "widgetType": "counter",
            "encodings": {"value": {"fieldName": "measure(Transfer share)", "displayName": "Must transfer", "format": PCT}},
            "frame": frame("Regional visitors with no direct ride", "Share of Metro Vancouver visitors who need a transfer")}, 9, 4, 3, 3),

    widget("gap-line", q("ds_gap", [("hour_label", "`hour_label`"), ("sum(demand_share)", "SUM(`demand_share`)"), ("sum(supply_share)", "SUM(`supply_share`)")]),
           {"version": 3, "widgetType": "line",
            "encodings": {"x": {"fieldName": "hour_label", "scale": {"type": "categorical"}, "axis": {"hideTitle": True}},
                          "y": {"scale": {"type": "quantitative"}, "format": PCT,
                                "fields": [{"fieldName": "sum(demand_share)", "displayName": "Share of daily visits"},
                                           {"fieldName": "sum(supply_share)", "displayName": "Share of daily departures"}]}},
            "frame": frame("Visits vs. scheduled departures by hour", "Where the orange line is above the blue one, demand outruns service")}, 0, 7, 7, 6),
    widget("gap-heatmap", q("ds_heat", [("hour_label", "`hour_label`"), ("day_label", "`day_label`"), ("avg(gap_index)", "AVG(`gap_index`)")]),
           {"version": 3, "widgetType": "heatmap",
            "encodings": {"x": {"fieldName": "hour_label", "scale": {"type": "categorical"}, "axis": {"hideTitle": True}},
                          "y": {"fieldName": "day_label", "scale": {"type": "categorical"}, "axis": {"hideTitle": True}},
                          "color": {"fieldName": "avg(gap_index)", "displayName": "Gap index",
                                    "scale": {"type": "quantitative", "colorRamp": {"mode": "custom-sequential", "colors": {"start": "#E7F5FF", "end": CORAL}}}}},
            "frame": frame("Gap index by hour", "Visit share ÷ departure share. > 1.5 = underserved")}, 7, 7, 5, 6),

    widget("route-crowding", q("ds_route", [("line_label", "`line_label`"), ("sum(overcrowded_share)", "SUM(`overcrowded_share`)")]),
           {"version": 3, "widgetType": "bar",
            "encodings": {"x": {"fieldName": "sum(overcrowded_share)", "scale": {"type": "quantitative"}, "format": PCT, "displayName": "Trips overcrowded"},
                          "y": {"fieldName": "line_label", "scale": {"type": "categorical", "sort": {"by": "value"}}, "axis": {"hideTitle": True}}},
            "frame": frame("Bus lines serving this hub: % of trips overcrowded", "TransLink Transit Service Performance Review 2025")}, 0, 13, 6, 7),
    widget("period-load", q("ds_period", [("time_period", "`time_period`"), ("season", "`season`"), ("max(max_peak_load)", "MAX(`max_peak_load`)")]),
           {"version": 3, "widgetType": "bar", "mark": {"layout": "group"},
            "encodings": {"x": {"fieldName": "time_period", "scale": {"type": "categorical", "sort": {"by": "custom-order", "orderedValues": [
                                    "00-04 Night", "04-06 Early", "06-09 AM peak", "09-15 Midday", "15-18 PM peak", "18-21 Evening", "21-24 Late evening"]}},
                                "axis": {"hideTitle": True}},
                          "y": {"fieldName": "max(max_peak_load)", "scale": {"type": "quantitative"}, "format": PCT, "displayName": "Busiest line load"},
                          "color": {"fieldName": "season", "scale": {"type": "categorical", "mappings": [{"value": "Fall", "color": CORAL}, {"value": "Summer", "color": "#FAB005"}]}}},
            "frame": frame("How full is the busiest line? Weekdays by time period", "Peak load factor of the most crowded line; 100% = vehicle at capacity")}, 6, 13, 6, 7),

    widget("forecast", q("ds_forecast", [("ds", "`ds`"), ("visits", "`visits`"), ("visits_forecast", "`visits_forecast`"),
                                         ("visits_upper", "`visits_upper`"), ("visits_lower", "`visits_lower`")], disagg=True),
           {"version": 1, "widgetType": "forecast-line",
            "encodings": {"x": {"fieldName": "ds", "scale": {"type": "temporal"}},
                          "y": {"scale": {"type": "quantitative", "domainMin": 0},
                                "original": {"fieldName": "visits", "displayName": "Daily visits"},
                                "prediction": {"fieldName": "visits_forecast", "displayName": "ai_forecast"},
                                "predictionUpper": {"fieldName": "visits_upper"}, "predictionLower": {"fieldName": "visits_lower"}}},
            "annotations": [
                {"type": "vertical-line", "encodings": {"x": {"dataValue": "2025-12-06T00:00:00.000", "dataType": "DATETIME"}, "label": {"value": "UBC exam weekend"}, "color": {"value": {"hex": CORAL}}}},
                {"type": "vertical-line", "encodings": {"x": {"dataValue": "2026-07-25T00:00:00.000", "dataType": "DATETIME"}, "label": {"value": "Waterfront peak"}, "color": {"value": {"hex": GREY}}}},
            ],
            "frame": frame("Daily visits and forecast to Oct 2026", "Databricks ai_forecast(); shaded band = 80% interval")}, 0, 20, 8, 7),
    widget("surge-table", q("ds_surge", [("visit_date", "`visit_date`"), ("weekday", "`weekday`"), ("pings", "`pings`"), ("surge_index", "`surge_index`")], disagg=True),
           {"version": 2, "widgetType": "table",
            "encodings": {"columns": [
                {"fieldName": "visit_date", "displayName": "Date"},
                {"fieldName": "weekday", "displayName": "Day"},
                {"fieldName": "pings", "displayName": "Visits", "format": COMPACT},
                {"fieldName": "surge_index", "displayName": "× normal", "format": {"type": "number", "decimalPlaces": {"type": "exact", "places": 2}},
                 "style": {"type": "basic", "rules": [{"condition": {"operand": {"type": "data-value", "value": "1.5"}, "operator": ">="}, "backgroundColor": {"hex": "#FFD8C2"}}]}}]},
            "frame": frame("Surge days", "Visits ≥ 1.25× the same weekday nearby")}, 8, 20, 4, 7),

    widget("origin-map", q("ds_origin", [("lat", "`lat`"), ("lon", "`lon`"), ("access_type", "`access_type`"), ("sum(pings)", "SUM(`pings`)")],
                           filters=["`regional_pings` > 0"]),
           {"version": 2, "widgetType": "symbol-map", "mark": {"opacity": 0.75},
            "encodings": {"coordinates": {"latitude": {"fieldName": "lat"}, "longitude": {"fieldName": "lon"}},
                          "color": {"fieldName": "access_type", "scale": {"type": "categorical", "mappings": ACCESS_COLORS}},
                          "size": {"fieldName": "sum(pings)", "scale": {"type": "quantitative"}}},
            "frame": frame("Where regional visitors come from", "Bubble = visits. Orange = no one-seat transit ride to the hub")}, 0, 27, 7, 8),
    widget("origin-bar", q("ds_origin", [("origin", "`origin`"), ("access_type", "`access_type`"), ("sum(regional_pings)", "SUM(`regional_pings`)")],
                           filters=["`regional_pings` > 0"]),
           {"version": 3, "widgetType": "bar",
            "encodings": {"x": {"fieldName": "sum(regional_pings)", "scale": {"type": "quantitative"}, "format": COMPACT, "displayName": "Visits"},
                          "y": {"fieldName": "origin", "scale": {"type": "categorical", "sort": {"by": "value"}}, "axis": {"hideTitle": True}},
                          "color": {"fieldName": "access_type", "scale": {"type": "categorical", "mappings": ACCESS_COLORS}}},
            "frame": frame("Visits by origin and transit access")}, 7, 27, 5, 8),

    widget("recs", q("ds_recs", [("hub", "`hub`"), ("priority_label", "`priority_label`"), ("category", "`category`"),
                                 ("recommendation", "`recommendation`"), ("evidence", "`evidence`")], disagg=True),
           {"version": 2, "widgetType": "table",
            "encodings": {"columns": [
                {"fieldName": "priority_label", "displayName": "Priority"},
                {"fieldName": "category", "displayName": "Issue"},
                {"fieldName": "recommendation", "displayName": "Recommended action (ai_query)"},
                {"fieldName": "evidence", "displayName": "Evidence"},
                {"fieldName": "hub", "displayName": "Hub"}]},
            "frame": frame("Recommended service actions", "Evidence computed in SQL; action sentence written by an LLM via ai_query(), limited to facts in the evidence")}, 0, 35, 12, 9),
    text("footer", [
        "**Sources:** hackathon synthetic visit pings (`ubc_rogersxdatabricks_hackathon.synthetic_data_ubc`) · TransLink GTFS static feed (fall 2026) · "
        "TransLink 2025 Transit Service Performance Review open data · TransLink Transit Service Guidelines. "
        "All tables: `rgersxdatabricks_hackathon.hub_pulse`. See the *Method & validation* page.",
    ], 0, 44, 12, 2),
]

validation = [
    text("val-header", [
        "## Can synthetic pings stand in for real riders?\n", "\n",
        "Waterfront's weekday ping profile tracks TransLink's **real 2025 SkyTrain boardings + alightings at Waterfront Station** with a correlation of **r ≈ 0.92**. "
        "Shifting the pings by 3 hours drops it to 0.38 — which is also how we confirmed the source timestamps are local time, despite their `Z` suffix.",
    ], 0, 0, 12, 3),
    widget("val-line", q("ds_validation", [("hour_label", "`hour_label`"), ("sum(pings_share)", "SUM(`pings_share`)"), ("sum(skytrain_share)", "SUM(`skytrain_share`)")]),
           {"version": 3, "widgetType": "line",
            "encodings": {"x": {"fieldName": "hour_label", "scale": {"type": "categorical"}, "axis": {"hideTitle": True}},
                          "y": {"scale": {"type": "quantitative"}, "format": PCT,
                                "fields": [{"fieldName": "sum(pings_share)", "displayName": "Visit pings (hackathon)"},
                                           {"fieldName": "sum(skytrain_share)", "displayName": "SkyTrain riders (TransLink 2025)"}]}},
            "frame": frame("Waterfront weekday: share of daily activity by hour")}, 0, 3, 6, 6),
    widget("seabus", q("ds_seabus", [("hour", "`hour`"), ("direction", "`direction`"), ("avg(utilization)", "AVG(`utilization`)")],
                       filters=["`day_type` = 'MF'", "`season` = 'Fall'"]),
           {"version": 3, "widgetType": "line",
            "encodings": {"x": {"fieldName": "hour", "scale": {"type": "quantitative"}, "displayName": "Hour"},
                          "y": {"fieldName": "avg(utilization)", "scale": {"type": "quantitative"}, "format": PCT, "displayName": "Volume ÷ capacity"},
                          "color": {"fieldName": "direction", "scale": {"type": "categorical"}}},
            "frame": frame("SeaBus (Waterfront ↔ Lonsdale): hourly volume vs capacity", "Fall weekdays, TSPR 2025")}, 6, 3, 6, 6),
    text("method", [
        "### Method\n", "\n",
        "1. **Demand** – visit pings per hub, hour and day type (weekday / Saturday / Sunday-holiday), averaged over days.\n",
        "2. **Supply** – TransLink GTFS trips calling at stops within 800 m (UBC Exchange) or 300 m (Waterfront, Park Royal), resolved on representative fall 2026 dates.\n",
        "3. **Gap index** – an hour's share of daily visits ÷ its share of daily departures. Scale-free, so synthetic volumes are never compared to real counts. > 1.5 underserved, < 0.67 overserved.\n",
        "4. **Crowding** – each hub's bus lines joined to TSPR 2025 overcrowding, peak load factor and bunching. Spare service is only proposed where the busiest line is under 85% full.\n",
        "5. **Access** – an origin has a one-seat ride if a line serving the hub stops within 1 km (bus) or 2 km (rail/SeaBus station) of its centroid.\n",
        "6. **Surges & forecast** – visits vs the same weekday ±4 weeks; `ai_forecast()` projects Sep–Oct 2026.\n",
        "7. **Recommendations** – rules assemble evidence; `ai_query()` writes a one-line action restricted to that evidence.\n", "\n",
        "**Limitations:** pings measure people at a hub, not boardings; origin centroids are approximate; 10 months of history limits seasonal forecasting.",
    ], 0, 9, 12, 7),
]

genie_id = sys.argv[1] if len(sys.argv) > 1 else None
ui = {"theme": {
    "canvasBackgroundColor": {"light": "#F8F9FA", "dark": "#1A1D21"},
    "widgetBackgroundColor": {"light": "#FFFFFF", "dark": "#101316"},
    "widgetBorderColor": {"light": "#FFFFFF", "dark": "#101316"},
    "fontColor": {"light": "#1B1F24", "dark": "#E9ECEF"},
    "selectionColor": {"light": "#1C7ED6", "dark": "#74C0FC"},
    "visualizationColors": [CORAL, BLUE, GREEN, "#AE3EC9", "#FAB005", "#15AABF", GREY],
    "widgetHeaderAlignment": "LEFT", "widgetCornerRadius": 10,
}}
if genie_id:
    ui["genieSpace"] = {"isEnabled": True, "overrideId": genie_id, "enablementMode": "ENABLED"}

dashboard = {
    "datasets": [dataset(n) for n in ALL],
    "pages": [
        {"name": "overview", "displayName": "Hub overview", "pageType": "PAGE_TYPE_CANVAS", "layoutVersion": "GRID_V1", "layout": overview},
        {"name": "method", "displayName": "Method & validation", "pageType": "PAGE_TYPE_CANVAS", "layoutVersion": "GRID_V1", "layout": validation},
    ],
    "uiSettings": ui,
}
json.dump(dashboard, open("dashboard.json", "w"), indent=1)
print("widgets:", len(overview) + len(validation), "datasets:", len(ALL))
