# Project Setup

## 1. Create Readme and validate the wrangler.jsonc based on the plan.md
Action: Created Readme and validated and updated wrangler.jsonc based on the plan.md


## 2. Using provided columns, populate types, Durable Object stubs, and SQLite-backed DOs (RecallSessionObject, RateLimiterObject) with backend recall scoring
Action: Created types in src/types.ts, moved runtime helpers to src/lib/recall.ts and src/do/stubs.ts, and implemented RecallSessionObject and RateLimiterObject with UUID generation and SQLite storage.
Note: Done in several steps with corrections on the way

# Building Workflow and Backend

## 3. Prompted with flow, steps, models, params, fallbacks, validation rules, error handling and steps.
Action: Implemented the workflow, prompt variables and validation rules.
Note: I've update the prompts.
