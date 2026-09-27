// The ECharts build this app uses: core plus only the charts and components we draw with, on the SVG
// renderer (crisp on a projector, and SVG text inherits tabular figures from body; DESIGN.md §9).
// Loaded lazily by EChart.tsx, so ECharts ships in its own chunk and never runs on the server.
// Add a module here (e.g. DataZoomComponent) only when a chart needs it.
import * as echarts from "echarts/core";
import { BarChart, CustomChart, LineChart } from "echarts/charts";
import { GridComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  BarChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  MarkAreaComponent,
  SVGRenderer,
]);

export { echarts };
