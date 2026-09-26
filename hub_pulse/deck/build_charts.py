import json
ubc = [(1.6,1.47),(1.11,0.67),(0.9,0.49),(0.73,0.18),(0.66,0.13),(0.79,0.67),(1.45,3.04),(2.69,7.46),(4.47,8.08),(5.98,7.41),(6.7,6.83),(6.94,4.91),(8.28,4.6),(8.3,5.0),(7.23,5.94),(7.48,7.1),(6.89,7.73),(6.05,7.77),(5.27,5.81),(4.49,4.11),(3.86,3.35),(3.38,2.86),(2.64,2.32),(2.1,2.05)]
wf = [(1.0,0.81),(0.53,0.14),(0.39,0),(0.35,0),(0.36,0.02),(0.69,0.72),(1.96,3.06),(4.07,5.73),(6.61,9.06),(5.53,5.36),(5.28,3.81),(5.98,3.95),(6.94,4.51),(6.84,4.9),(6.76,5.66),(7.88,8.32),(9.28,11.44),(8.68,11.26),(5.5,6.7),(3.95,4.19),(3.35,3.34),(3.29,3.24),(2.78,2.3),(2.01,1.5)]

def chart(series, colors, ymax, yticks, W=1664, H=500, label=""):
    L, R, T, B = 90, W-30, 20, H-60
    x = lambda i: L + i*(R-L)/23
    y = lambda v: B - v/ymax*(B-T)
    out = [f'<svg aria-label="{label}" width="{W}" height="{H}" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg">']
    for t in yticks:
        out.append(f'<line x1="{L}" y1="{y(t):.1f}" x2="{R}" y2="{y(t):.1f}" stroke="#D9D4C7" stroke-width="2"/>')
        out.append(f'<text x="{L-16}" y="{y(t)+9:.1f}" text-anchor="end" font-family="Arial, sans-serif" font-size="26" fill="#5A6475">{t}%</text>')
    for h in (0,6,12,18,23):
        lbl = {0:"00:00",6:"06:00",12:"12:00",18:"18:00",23:"23:00"}[h]
        out.append(f'<text x="{x(h):.1f}" y="{H-18}" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" fill="#5A6475">{lbl}</text>')
    for k,(col,w,dash) in enumerate(colors):
        pts = " ".join(f"{x(i):.1f},{y(v[k]):.1f}" for i,v in enumerate(series))
        d = f' stroke-dasharray="{dash}"' if dash else ''
        out.append(f'<polyline points="{pts}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linejoin="round" stroke-linecap="round"{d}/>')
    out.append('</svg>')
    return "".join(out)

json.dump({
  "ubc": chart(ubc, [("#E8590C",7,None),("#2B6CB0",7,None)], 9, [0,3,6,9], H=450, label="UBC weekday share of visits and departures by hour"),
  "wf": chart(wf, [("#E8590C",7,None),("#5A6475",5,"14 10")], 12, [0,4,8,12], H=380, label="Waterfront weekday pings versus SkyTrain riders by hour"),
}, open("charts.json","w"))
print("ok")
