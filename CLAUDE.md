# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

Team 13's entry for the Rogers × Databricks "Data Intelligence for Smarter Communities" hackathon (UBC, Sept 25–27 2026). The full brief, schedule and scoring rubric are in `Onboarding_Guide.md`.

- **Goal:** build a smart-community solution focused on **Transit and/or Security**, driven by a provided table of **synthetic cell tower traffic data** across points of interest in Vancouver. Open-source external datasets may be added.
- **Deliverable:** a 5-minute presentation (+3 min Q&A) on Sunday Sept 27 at 11:30 AM, backed by analysis in Databricks and an interactive front end.
- **Scoring (55 +5):**
  - Data analysis in Databricks: 15, plus 5 bonus for well-structured pipelines or reproducible analysis.
  - Actionable insights in a separate interactive tool (a Databricks App, web page, etc.): 25. This is the biggest category. Insights must be traceable to the data.
  - Originality & impact: 10. Go beyond a basic dashboard.
  - Presentation: 5.

  When choosing between approaches, favor reproducible pipelines and a demoable interactive tool over one-off notebook exploration.

## Repository state

The repo holds only a README and the onboarding guide. There is no source code, build system or tests yet, so add build/test commands to this file once they exist. `.claude/`, `.databricks/` and `.ai-dev-kit/` hold Databricks AI dev-kit tooling and skills, not project code.

## Databricks

- The team shares one Databricks Free Edition workspace. Notebooks, data and hackathon files live there, not in this repo.
- CLI profiles in `~/.databrickscfg`: `DEFAULT` and `hackathon` (the configured default). Always pass `--profile <name>` explicitly, and ask which one to use rather than picking one.
- Free Edition means serverless compute only. Write code that works on serverless.
- Teammates edit shared notebooks at the same time, so **never "Run All"** on a shared notebook and don't overwrite shared notebooks or tables without checking first.
- Use the Databricks plugin skills (`databricks-core` first, then the product skill: pipelines, apps, aibi-dashboards, etc.) for Databricks work.
