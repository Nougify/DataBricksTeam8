import json, os, datetime, re
C = json.load(open("charts.json"))
LIGHT, LIGHT2, DARK = "#F6F4EE", "#ECE7DC", "#13203A"
INK, SOFT = "#13203A", "#4A5568"
OR_T, OR, BL_T, BL = "#C2410C", "#E8590C", "#1D5FAF", "#2B6CB0"
ON_D, ON_D_SOFT, OR_D, BL_D = "#F6F4EE", "#B9C4D6", "#FF8A4C", "#7DB8FF"
HEAD = "'Oswald', 'Arial Narrow', Arial, sans-serif"
BODY = "'Public Sans', Arial, sans-serif"
TOTAL = 11

def eyebrow(t, color=OR_T):
    return f'<p style="font-size:24px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:{color}">{t}</p>'
def title(t, color=INK):
    return f'<h2 style="font-family:{HEAD}; font-size:72px; font-weight:500; line-height:1.1; color:{color}">{t}</h2>'
def footer(n, color=SOFT):
    return f'<p style="position:absolute; left:128px; bottom:64px; width:1664px; font-size:24px; color:{color}">Hub Pulse · Rogers × Databricks Hackathon · Vancouver · {n} / {TOTAL}</p>'
def section(sid, body, bg=LIGHT, color=INK, notes="", extra=""):
    return (f'<section id="{sid}" data-transition="fade" style="background:{bg}; color:{color}; font-family:{BODY}; '
            f'padding:128px 128px 160px; display:flex; flex-direction:column; gap:32px{extra}">\n{body}\n<aside>{notes}</aside>\n</section>\n')
def swatch(color):
    return f'<div style="width:40px; height:12px; background:{color}; border-radius:6px"></div>'
def bar_rows(rows, maxv, color, label_color, value_color, width=900):
    out = []
    for label, v, suffix in rows:
        w = max(8, round(v / maxv * width))
        out.append(f'<div style="display:flex; flex-direction:row; align-items:center; gap:24px">'
                   f'<p style="width:360px; font-size:30px; color:{label_color}">{label}</p>'
                   f'<div style="width:{w}px; height:44px; background:{color}; border-radius:6px"></div>'
                   f'<p style="font-size:30px; font-weight:700; color:{value_color}">{v}{suffix}</p></div>')
    return "\n".join(out)

S = {}

S["cover"] = f'''<section id="cover" data-transition="fade" style="background:{DARK}; color:{ON_D}; font-family:{BODY}; padding:128px; display:flex; flex-direction:column; justify-content:center; gap:40px">
{eyebrow("Rogers × Databricks Hackathon · Vancouver transit", OR_D)}
<h1 style="font-family:{HEAD}; font-size:200px; font-weight:600; line-height:1; color:{ON_D}">Hub Pulse</h1>
<h2 style="font-family:{HEAD}; font-size:72px; font-weight:400; line-height:1.15; color:{ON_D}">Vancouver’s buses run on a commuter clock.<br>Its busiest hubs don’t.</h2>
<p style="font-size:32px; line-height:1.4; color:{ON_D_SOFT}; width:1300px">A Databricks what-if planner that matches TransLink service to when people are actually at UBC, Waterfront Station and Park Royal Mall.</p>
<p style="position:absolute; left:128px; bottom:64px; width:1664px; font-size:24px; color:{ON_D_SOFT}">Youssef Ahmed · University of British Columbia · September 2026</p>
<aside>Hub Pulse asks one question: is TransLink’s schedule in step with the people actually using its busiest hubs? We used the hackathon’s 21.5 million visit pings, TransLink’s own schedule and its 2025 performance review, and built the whole thing on Databricks.</aside>
</section>
'''

S["problem"] = section("problem", f'''{eyebrow("The problem")}
{title("At UBC, visits peak at 1 p.m. The buses peak at 8 a.m.")}
{C["ubc"]}
<div style="display:flex; flex-direction:row; gap:64px">
<div style="flex:1; display:flex; flex-direction:row; gap:16px; align-items:center">{swatch(OR)}<p style="font-size:28px; line-height:1.3; color:{SOFT}"><b style="color:{OR_T}">Visits:</b> 12–2 p.m. holds 17% of the day’s visits but only 10% of departures.</p></div>
<div style="flex:1; display:flex; flex-direction:row; gap:16px; align-items:center">{swatch(BL)}<p style="font-size:28px; line-height:1.3; color:{SOFT}"><b style="color:{BL_T}">Departures:</b> 7–9 a.m. gets 16% of the day’s buses for 7% of visits.</p></div>
</div>
{footer(2)}''', notes="Weekday share of each hour’s visits (orange) versus share of scheduled departures (blue) at UBC. The schedule is built around the commute; the campus peaks at midday. The same shape shows up at Park Royal and Waterfront.")

S["data"] = section("data", f'''{eyebrow("The data")}
{title("Three sources, one lakehouse")}
<div style="display:flex; flex-direction:row; gap:32px; flex:1">
<div style="flex:1; display:flex; flex-direction:column; gap:16px; background:#FFFFFF; padding:40px; border:1px solid #D9D4C7; border-radius:16px">
<p style="font-family:{HEAD}; font-size:72px; font-weight:500; line-height:1; color:{OR_T}">21.5M</p>
<h3 style="font-size:32px; font-weight:700; color:{INK}">visit pings</h3>
<p style="font-size:26px; line-height:1.4; color:{SOFT}">Hackathon data: origin area, dwell time and timestamp at UBC, Waterfront Station and Park Royal Mall. Nov 2025 – Aug 2026, 304 days, 36 origin areas.</p>
</div>
<div style="flex:1; display:flex; flex-direction:column; gap:16px; background:#FFFFFF; padding:40px; border:1px solid #D9D4C7; border-radius:16px">
<p style="font-family:{HEAD}; font-size:72px; font-weight:500; line-height:1; color:{BL_T}">Every trip</p>
<h3 style="font-size:32px; font-weight:700; color:{INK}">TransLink GTFS schedule</h3>
<p style="font-size:26px; line-height:1.4; color:{SOFT}">Fall 2026 feed: 12 bus lines at UBC Exchange, 10 at Park Royal, 26 plus SkyTrain, SeaBus and West Coast Express at Waterfront.</p>
</div>
<div style="flex:1; display:flex; flex-direction:column; gap:16px; background:#FFFFFF; padding:40px; border:1px solid #D9D4C7; border-radius:16px">
<p style="font-family:{HEAD}; font-size:72px; font-weight:500; line-height:1; color:{INK}">Real crowding</p>
<h3 style="font-size:32px; font-weight:700; color:{INK}">TransLink 2025 review (TSPR)</h3>
<p style="font-size:26px; line-height:1.4; color:{SOFT}">Open data on overcrowding, peak load and bunching per route and time period, plus hourly SkyTrain and SeaBus volumes.</p>
</div>
</div>
<p style="font-size:26px; color:{SOFT}">All in Unity Catalog: <b style="color:{INK}">rgersxdatabricks_hackathon.hub_pulse</b>, 25 Delta tables, bronze → silver → gold.</p>
{footer(3)}''', bg=LIGHT2, notes="Hackathon pings give us demand. GTFS gives us supply: every scheduled trip calling at each hub. TSPR, which TransLink publishes on its Managing the Transit Network page, tells us how full those buses already are.")

S["validation"] = section("validation", f'''{eyebrow("Can we trust synthetic pings?")}
{title("They move like real riders: r = 0.92")}
{C["wf"]}
<div style="display:flex; flex-direction:row; gap:64px">
<div style="flex:1; display:flex; flex-direction:row; gap:16px; align-items:center">{swatch(OR)}<p style="font-size:28px; line-height:1.3; color:{SOFT}">Waterfront visit pings, weekdays, share by hour</p></div>
<div style="flex:1; display:flex; flex-direction:row; gap:16px; align-items:center">{swatch("#5A6475")}<p style="font-size:28px; line-height:1.3; color:{SOFT}">Real SkyTrain boardings + alightings at Waterfront (TSPR 2025)</p></div>
</div>
<p style="font-size:26px; line-height:1.4; color:{SOFT}">Shift the pings by 3 hours and r falls to 0.38 — which is also how we proved the timestamps are local time despite their “Z” (UTC) suffix.</p>
{footer(4)}''', notes="Before trusting any conclusion we checked the synthetic data against reality. Waterfront’s hourly ping profile matches TransLink’s published SkyTrain activity at Waterfront almost exactly. Read as UTC, the pings would peak at 5 a.m.; read as local time they match real riders.")

tbl_style = f"width:1664px; font-size:30px; color:{INK}"
S["gap"] = section("gap", f'''{eyebrow("Finding 1 · the gap")}
{title("Every hub has hours where demand outruns service")}
<table style="{tbl_style}">
<tr style="background:{LIGHT2}"><th style="width:22%; text-align:left">Hub, weekdays</th><th style="width:19%; text-align:right">Mismatch</th><th style="width:22%; text-align:right">Visits in underserved hours</th><th style="width:15%; text-align:right">Underserved hours</th><th style="width:22%; text-align:right">Busiest line at peak</th></tr>
<tr><td>UBC</td><td style="text-align:right">14.6%</td><td style="text-align:right; color:{OR_T}"><b>20.0%</b></td><td style="text-align:right">6</td><td style="text-align:right; color:{OR_T}"><b>104% full</b></td></tr>
<tr><td>Park Royal Mall</td><td style="text-align:right">19.4%</td><td style="text-align:right; color:{OR_T}"><b>16.0%</b></td><td style="text-align:right">3</td><td style="text-align:right">80% full</td></tr>
<tr><td>Waterfront Station</td><td style="text-align:right">14.9%</td><td style="text-align:right">7.1%</td><td style="text-align:right">1</td><td style="text-align:right">89% full</td></tr>
</table>
<div style="flex:1"></div>
<p style="font-size:26px; line-height:1.4; color:{SOFT}"><b style="color:{INK}">Mismatch</b> = share of departures running at the wrong hour for demand. <b style="color:{INK}">Underserved</b> = an hour’s share of visits is more than 1.5× its share of departures. Busiest line = peak load factor from TSPR 2025.</p>
{footer(5)}''', notes="We compare shares, not raw counts, so synthetic volumes are never compared to real ones. One in five UBC visits and one in six Park Royal visits happen in hours with too little service.")

S["crowding"] = f'''<section id="crowding" data-transition="fade" style="background:{DARK}; color:{ON_D}; font-family:{BODY}; padding:128px 128px 160px; display:flex; flex-direction:column; gap:32px">
{eyebrow("Finding 2 · crowding", OR_D)}
{title("UBC’s buses are already full", ON_D)}
<div style="display:flex; flex-direction:row; gap:64px; align-items:center; flex:1">
<div style="width:420px; display:flex; flex-direction:column; gap:16px">
<p style="font-family:{HEAD}; font-size:200px; font-weight:600; line-height:1; color:{OR_D}">104%</p>
<p style="font-size:30px; line-height:1.35; color:{ON_D_SOFT}">peak load on the westbound 99 B-Line, 6–9 a.m. (TSPR 2025)</p>
</div>
<div style="flex:1; display:flex; flex-direction:column; gap:20px">
<p style="font-size:28px; color:{ON_D_SOFT}">% of 2025 trips overcrowded, lines serving UBC</p>
{bar_rows([("99 B-Line", 20.3, "%"), ("R4 41st Ave", 15.2, "%"), ("49 49th Ave", 14.3, "%"), ("33 16th/33rd", 10.7, "%"), ("9 Broadway", 8.6, "%")], 20.3, OR_D, ON_D, ON_D, width=640)}
</div>
</div>
{footer(6, ON_D_SOFT)}
<aside>These are TransLink’s own numbers. UBC’s trunk lines are the most overcrowded of all 40 lines serving our three hubs. That matters for the fix: you can’t move buses out of the morning peak at UBC, because they’re already over capacity.</aside>
</section>
'''

S["access"] = section("access", f'''{eyebrow("Finding 3 · access")}
{title("Half of UBC’s regional visitors can’t get there without a transfer")}
<div style="display:flex; flex-direction:row; gap:64px; align-items:center; flex:1">
<div style="width:420px; display:flex; flex-direction:column; gap:16px">
<p style="font-family:{HEAD}; font-size:200px; font-weight:600; line-height:1; color:{OR_T}">48%</p>
<p style="font-size:30px; line-height:1.35; color:{SOFT}">of visitors from elsewhere in Metro Vancouver have no one-seat transit ride to UBC</p>
</div>
<div style="flex:1; display:flex; flex-direction:column; gap:20px">
<p style="font-size:28px; color:{SOFT}">Share of UBC’s regional visitors, origins with no direct line</p>
{bar_rows([("Surrey", 14.5, "%"), ("Richmond", 11.6, "%"), ("New Westminster", 6.3, "%"), ("North Vancouver", 5.6, "%"), ("Delta", 2.6, "%")], 14.5, OR, INK, INK, width=640)}
</div>
</div>
{footer(7)}''', notes="An origin has a one-seat ride if a line serving the hub also stops within 1 km of it by bus, or 2 km of a SkyTrain, SeaBus or West Coast Express station. Surrey, Richmond, New Westminster and North Vancouver alone are 38% of UBC’s regional visitors, and every one of those trips needs a transfer onto UBC’s already crowded lines.")

def arch_card(head, lines, color):
    items = "".join(f'<p style="font-size:24px; line-height:1.35; color:{SOFT}">{l}</p>' for l in lines)
    return (f'<div style="flex:1; display:flex; flex-direction:column; gap:12px; background:#FFFFFF; padding:32px; border:1px solid #D9D4C7; border-top:8px solid {color}; border-radius:16px">'
            f'<h3 style="font-family:{HEAD}; font-size:44px; font-weight:500; color:{INK}">{head}</h3>{items}</div>')
conn = f'<x-connector head="end" style="width:56px; color:{SOFT}; border-width:4px"></x-connector>'
S["solution"] = section("solution", f'''{eyebrow("What we built")}
{title("Hub Pulse runs end to end on Databricks")}
<div style="display:flex; flex-direction:row; align-items:center; gap:16px; flex:1">
{arch_card("Ingest", ["Unity Catalog volume", "read_files() on CSV, GTFS and TSPR", "21.5M pings + open data"], BL)}
{conn}
{arch_card("Lakehouse", ["25 Delta tables", "bronze → silver → gold", "Serverless SQL warehouse"], INK)}
{conn}
{arch_card("AI", ["ai_forecast(): demand to Oct 2026", "ai_query(): written actions", "Genie space: questions → SQL"], OR)}
{conn}
{arch_card("Surfaces", ["AI/BI dashboard", "Databricks App: what-if planner", "Reproducible notebooks"], BL)}
</div>
<p style="font-size:26px; line-height:1.4; color:{SOFT}">The <b style="color:{INK}">what-if planner</b> lets a planner add buses, or move them at zero cost, hour by hour, and see the gap close live. It never moves a bus if that would push the busiest line past 85% full.</p>
{footer(8)}''', bg=LIGHT2, notes="Everything is Databricks-native: files in a Unity Catalog volume, SQL pipelines into Delta, AI functions for the forecast and the written recommendations, a Genie space for plain-English questions, an AI/BI dashboard, and an AppKit Databricks App for the what-if planner. The planner’s capacity rule: an hour can only give up buses while its busiest line stays at or under 85% full, assuming its riders spread over the buses that remain.")

S["results"] = section("results", f'''{eyebrow("Results")}
{title("One fix per hub")}
<table style="width:1664px; font-size:26px; color:{INK}">
<tr style="background:{LIGHT2}"><th style="width:16%; text-align:left">Weekdays</th><th style="width:38%; text-align:left">Rebalance at zero cost</th><th style="width:28%; text-align:left">Add 5% more service</th><th style="width:18%; text-align:left">Verdict</th></tr>
<tr><td><b>Park Royal</b></td><td>Move 71 of 900 departures: underserved visits <b style="color:{BL_T}">16.0% → 0.6%</b></td><td>16.0% → 0.6%</td><td><b style="color:{BL_T}">Reschedule</b></td></tr>
<tr><td><b>Waterfront</b></td><td>Move 8% of departures: mismatch <b style="color:{BL_T}">14.9% → 6.7%</b>; hours over 85% full 3 → 0</td><td>Mismatch 14.9% → 12.7%</td><td><b style="color:{BL_T}">Reschedule</b></td></tr>
<tr><td><b>UBC</b></td><td>Only 16 buses can move safely: <b style="color:{OR_T}">still 20.0%</b></td><td>+112 departures at 11:00–14:00: <b style="color:{BL_T}">20.0% → 3.4%</b></td><td><b style="color:{OR_T}">Invest</b></td></tr>
</table>
<div style="flex:1"></div>
<p style="font-size:26px; line-height:1.4; color:{SOFT}">Computed by the app’s planner engine (unit-tested) over the fall 2026 schedule. Rebalancing never takes a bus from an hour if that would push its busiest line past 85% of capacity.</p>
{footer(9)}''', notes="The insight is that each hub needs a different fix. Park Royal and Waterfront have spare capacity in the early morning and late evening, so simply retiming trips closes most of the gap at no cost. UBC’s peak buses are over capacity, so rescheduling can’t help; about 112 more weekday departures at midday, about 5% more service, cuts underserved visits from 20% to 3.4%.")

def act_card(hub, action, impact, color):
    return (f'<div style="flex:1; display:flex; flex-direction:column; gap:20px; background:#FFFFFF; padding:40px; border:1px solid #D9D4C7; border-top:8px solid {color}; border-radius:16px">'
            f'<h3 style="font-family:{HEAD}; font-size:44px; font-weight:500; color:{INK}">{hub}</h3>'
            f'<p style="font-size:28px; line-height:1.4; color:{INK}">{action}</p>'
            f'<div style="flex:1"></div>'
            f'<p style="font-size:26px; line-height:1.35; font-weight:700; color:{color}">{impact}</p></div>')
S["actions"] = section("actions", f'''{eyebrow("Recommendations")}
{title("What TransLink could do next service change")}
<div style="display:flex; flex-direction:row; gap:32px; flex:1">
{act_card("Park Royal Mall", "Retime about 70 weekday trips from before 10 a.m. and after 8 p.m. into 11 a.m. – 6 p.m., when the mall is busiest.", "Cost: $0 · underserved visits 16% → 1%", BL_T)}
{act_card("Waterfront Station", "Shift about 8% of departures from late night and early morning toward midday, and add trips on the R5 Hastings (8.7% of trips overcrowded).", "Cost: $0 · no hour over 85% full", BL_T)}
{act_card("UBC", "Fund about 112 more weekday departures at 11 a.m. – 2 p.m., plan extra weekend service for exam season (Dec 6–7 ran 1.7× normal), and weigh the 48% transfer rate in the rapid-transit case for UBC.", "Invest: +5% service · underserved 20% → 3%", OR_T)}
</div>
{footer(10)}''', notes="These are the planner’s outputs turned into service-change language. The Databricks App lets TransLink staff reproduce every number, change the assumptions and ask Genie follow-up questions.")

S["demo"] = f'''<section id="demo" data-transition="fade" style="background:{DARK}; color:{ON_D}; font-family:{BODY}; padding:128px 128px 160px; display:flex; flex-direction:column; gap:40px">
{eyebrow("Try it", OR_D)}
{title("Drag a slider and watch the gap close", ON_D)}
<div style="display:flex; flex-direction:column; gap:28px">
<p style="font-size:32px; line-height:1.4; color:{ON_D}"><b>Databricks App</b>, the what-if planner: <a href="https://hub-pulse-7474647815578778.aws.databricksapps.com" style="color:{BL_D}">hub-pulse-7474647815578778.aws.databricksapps.com</a></p>
<p style="font-size:32px; line-height:1.4; color:{ON_D}"><b>AI/BI dashboard</b> with Ask Genie: <a href="https://dbc-4e20a0bf-b569.cloud.databricks.com/sql/dashboardsv3/01f1b9ba38eb19b380359bc436db086f/published?o=7474647815578778" style="color:{BL_D}">Hub Pulse — Transit Demand vs Service</a></p>
<p style="font-size:32px; line-height:1.4; color:{ON_D}"><b>Genie space</b>: <a href="https://dbc-4e20a0bf-b569.cloud.databricks.com/genie/rooms/01f1b9ba76251c4684f359bee3795d70?o=7474647815578778" style="color:{BL_D}">Hub Pulse — Ask about Vancouver transit hubs</a></p>
</div>
<div style="flex:1"></div>
<p style="font-size:28px; line-height:1.4; color:{ON_D_SOFT}">Built: 25 Delta tables · 2 notebooks · AI/BI dashboard · Genie space · AppKit app with 9 unit tests. Limits: pings count people at a hub, not boardings; origin centroids are approximate; 10 months of history.</p>
{footer(11, ON_D_SOFT)}
<aside>Live demo: open the app on UBC weekdays, drag “Add service” to 100, then switch to Park Royal and drag “Rebalance”. Then ask Genie: which bus lines serving UBC are the most overcrowded? Workspace links require access to the hackathon workspace.</aside>
</section>
'''

order = ["cover","problem","data","validation","gap","crowding","access","solution","results","actions","demo"]
assert len(order) == TOTAL
def clean(h):
    h = re.sub(r'<b style="color:([^"]+)">(.*?)</b>', r'<b><span style="color:\1">\2</span></b>', h)
    h = re.sub(r'<a href="([^"]+)" style="color:([^"]+)">(.*?)</a>', r'<a href="\1"><span style="color:\2">\3</span></a>', h)
    return h
for sid in order:
    open(f"project/slides/{sid}.html","w").write(clean(S[sid]))
deck = {"v":4, "createdOnFiles":{"v":1,"at":datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")},
  "title":"Hub Pulse — Hackathon Pitch", "order":order,
  "sections":{
    "problem":{"description":"The schedule and the hubs are out of step","start":"cover"},
    "evidence":{"description":"Three sources, validated, and what they show","start":"data"},
    "solution":{"description":"What we built on Databricks and what it finds","start":"solution"},
    "next":{"description":"Recommendations and live demo","start":"actions"}},
  "faces":{"oswald":{"family":"Oswald","href":"https://fonts.googleapis.com/css2?family=Oswald:wght@400..700&display=swap"},
           "public-sans":{"family":"Public Sans","href":"https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap"}},
  "designSystems":[]}
json.dump(deck, open("project/deck.json","w"), indent=1)
print("wrote", len(order), "slides")
